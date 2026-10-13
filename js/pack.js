/* パックページ（締め切ったテーマのパックを開ける） */
import { $, esc, cardHTML, ATTR_L, pull, CW, CH, PW, PH, packURL } from './cards.js';
import { SPARKLE } from './sparkle.js';
import { S, toast, boot, monthLabel, loadPack, packsLeft, usePack, chargeText, saveOwned } from './core.js';

function renderCharge() {
  const left = packsLeft();
  $('#packCharge').innerHTML = chargeText() + '<br><small>ほかの人の作品に投票すると1回ふえます</small>';
  document.querySelectorAll('button[data-open]').forEach(b => b.disabled = !left);
  document.querySelectorAll('[data-ten]').forEach(b => b.hidden = left < 10);
  $('#again').disabled = !left; $('#again10').hidden = left < 10;
}
setInterval(renderCharge, 30000);

/* ---------- パック ---------- */
function renderPacks() {
  if (!S.loaded) return;
  $('#packList').innerHTML = S.packIndex.map(p => {
    const cover = p.cover ? { id: 'cover' + p.no, tid: p.tid, ...p.cover } : null;
    return `<div class="pack">
    <img class="pimg" data-open="${p.no}" src="${packURL(p, cover)}" width="${PW * 2}" height="${PH * 2}" alt="${esc(p.name)}">
    <div class="pm">${monthLabel(p.month)}のテーマ</div>
    <div class="pc">${ownedCountIdx(p)} / ${p.count}種</div>
    <div><button class="btn small" data-open="${p.no}">開ける</button> <button class="btn small" data-open="${p.no}" data-ten hidden>10連</button></div></div>`
  }).join('') || '<p class="empty">まだ開けられるパックがありません。月末の締め切りのあと、ここに並びます。</p>';
  $('#packCharge').hidden = !S.packIndex.length; renderCharge();
}
function ownedCountIdx(p) { const pk = S.packs.get(p.no); return pk ? pk.cards.filter(c => S.owned[c.id]).length : (p.ids || []).filter(id => S.owned[id]).length }
$('#packList').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openPack(+b.dataset.open, 'ten' in b.dataset) });
/* ---------- 開封 ----------
   画面のどこを押しても次へ進む（ボタンは除く）。同じ場所を押し続ければ、どんどん開いていく。
   袋（押すと破る）→ 5枚の束（押すたびに上の1枚がどく）→ まとめ（押すと次の袋）
   10連：袋→束 を10回くり返してから、まとめに50枚 */
let opening = null;   // 開けているパック
let ten = 0;          // 10連で、まだ破っていない袋の数（10連でなければ 0）
let got = [];         // まとめに出すカード [{ c, isNew }]
let els = [], k = 0;  // 束のカード（上から順）と、いま一番上の番号
let step = 'pack';    // 'pack' | 'tear' | 'cards' | 'sum'
let tearT, lockUntil = 0;   // lockUntil：★4 の演出のあいだは押しても進まない
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const newBadge = g => g.isNew ? '<span class="badge-new new">NEW</span>' : '';

async function openPack(no, isTen) {
  if (packsLeft() < (isTen ? 10 : 1)) { toast('開けられる回数がありません'); renderCharge(); return }
  let p; try { p = await loadPack(no) } catch (e) { toast('パックを読み込めませんでした'); return }
  opening = p; ten = isTen ? 10 : 0; got = [];
  $('#ov').hidden = false; document.body.style.overflow = 'hidden';
  showPack();
}
function showPack() {
  step = 'pack';
  const p = opening, idx = S.packIndex.find(x => x.no === p.no);
  const cover = idx && idx.cover ? { id: 'cover' + p.no, tid: p.tid, ...idx.cover } : null;
  $('#ovStage').innerHTML = `<div id="ovPack"><img class="pimg" src="${packURL({ ...p, name: idx ? idx.name : p.name }, cover)}" width="${PW * 3}" height="${PH * 3}" alt="${esc(p.name)}のパック"></div>`;
  $('#ovStage').hidden = false; $('#ovCards').hidden = true; $('#ovActions').hidden = true;
  $('#ovHint').textContent = 'タップして開ける'; $('#ovHint').hidden = false;
  $('#ovCount').textContent = ten ? `${11 - ten} / 10パック` : '';
}
function tear() {
  if (!usePack()) { toast('開けられる回数がありません'); return }
  if (ten) ten--;
  const pulled = pull(opening.cards).map(c => { const isNew = !S.owned[c.id]; S.owned[c.id] = (S.owned[c.id] || 0) + 1; return { c, isNew } });
  got.push(...pulled); saveOwned(); renderCharge();
  step = 'tear'; $('#ovHint').hidden = true;
  const p = $('#ovPack'); p.classList.add('shake');
  if (reduce()) return showStack();
  tearT = setTimeout(() => { p.classList.add('tear'); tearT = setTimeout(showStack, 450) }, 450);
}
/* 束：DOM は下のカードが先（あとのものが上に重なる） */
function showStack() {
  clearTimeout(tearT); if (step === 'cards') return; step = 'cards';
  const cards = got.slice(-5);
  $('#ovStage').innerHTML = '<div class="stack">' + cards.map(g => `<div class="sc">${cardHTML(g.c, 'full')}${newBadge(g)}</div>`).reverse().join('') + '</div>';
  els = [...$('#ovStage').querySelectorAll('.sc')].reverse(); k = 0; countCard(); topCard();
}
/* キラキラ：js/sparkle.js のコマを横に並べた1枚の絵にして、コマ数で区切って動かす（1ドット＝2px） */
const SPK_POS = [[-6, 6], [104, -2], [106, 42], [-6, 62], [102, 88], [-2, 100]];   // カードに対する％
const SPK_GAP = 4;   // 1回光ったあと、次に光るまでに休むコマ数（1コマ＝SPARKLE.ms）
let spkURL;
function sparkles() {
  const K = SPARKLE, n = K.frames.length + SPK_GAP, S = +$('#ov').style.getPropertyValue('--cs') || 2, dur = n * K.ms;   // 休みのぶんは何も描かないコマ
  if (!spkURL) {
    const cv = document.createElement('canvas'); cv.width = K.w * n; cv.height = K.h; const x = cv.getContext('2d');
    K.frames.forEach((fr, i) => { for (let k = 0; k < K.w * K.h; k++) { const v = +fr[k]; if (v) { x.fillStyle = K.colors[v]; x.fillRect(i * K.w + k % K.w, k / K.w | 0, 1, 1) } } });
    spkURL = cv.toDataURL();
  }
  return SPK_POS.map(([x, y], i) => `<i class="spk" style="left:${x}%;top:${y}%;width:${K.w * S}px;height:${K.h * S}px;background-image:url(${spkURL});background-size:${K.w * n * S}px 100%;--sheetw:${K.w * n * S}px;animation:spk ${dur}ms steps(${n}) ${-i * dur / SPK_POS.length}ms infinite"></i>`).join('');
}
/* ★4の光の粒の位置（カードに対する％）と出はじめ（秒） */
const PT_POS = [[-4, 90, 0], [103, 70, .3], [10, 101, .6], [98, 100, .9], [-3, 40, 1.2], [102, 25, .45], [50, 102, 1.05], [30, -1, 1.5]];
const PT_COL = ['#ffdc48', '#ffb3e0', '#9fe7ff', '#ff9a3c'];   // 光の粒の色（順番に使う）
/* いちばん上に来たカードの演出。★3：キラキラだけ。★4：画面が光る → カードがはねる＋光の輪が1回広がる → 弱い光・光の粒・キラキラ */
function topCard() {
  const g = got[got.length - els.length + k]; if (!g || g.c.star < 3) return;
  const el = els[k];
  el.insertAdjacentHTML('beforeend', sparkles());
  if (g.c.star < 4) return;
  el.classList.add('rare');
  el.insertAdjacentHTML('beforeend', '<div class="burst"></div><div class="glow4"></div>' + PT_POS.map(([x, y, d], i) => `<i class="pt" style="left:${x}%;top:${y}%;animation-delay:${d}s;--c:${PT_COL[i % PT_COL.length]}"></i>`).join(''));
  if (reduce()) return;
  lockUntil = Date.now() + 700;
  const f = document.createElement('div'); f.className = 'flash'; document.body.append(f); f.addEventListener('animationend', () => f.remove());
}
function countCard() { $('#ovCount').textContent = (ten || got.length > 5 ? `${got.length / 5} / 10パック　` : '') + `${k + 1} / ${els.length}` }
function nextCard() {
  const el = els[k++];
  if (reduce()) el.remove(); else { el.classList.add('out'); el.addEventListener('animationend', () => el.remove()) }
  if (k < els.length) { countCard(); topCard(); return }
  if (ten) showPack(); else showSum();
}
function showSum() {
  step = 'sum';
  const many = got.length > 5;
  $('#ovCards').className = many ? 'many' : '';
  $('#ovCards').innerHTML = got.map(g => `<div class="sum-c">${cardHTML(g.c, 'full', '', many ? 1 : 2)}${newBadge(g)}</div>`).join('');
  $('#ovStage').hidden = true; $('#ovCards').hidden = false; $('#ovActions').hidden = false;
  $('#ovCount').textContent = '';
  $('#ovHint').textContent = 'タップでもう1パック'; $('#ovHint').hidden = !packsLeft();
  renderCharge();
}
$('#ov').addEventListener('click', e => {
  if (e.target.closest('button') || Date.now() < lockUntil) return;
  const sc = step === 'sum' && e.target.closest('.sum-c');
  if (sc) return zoom(got[[...$('#ovCards').children].indexOf(sc)].c);   // カードを押したら拡大、ほかの場所なら次の袋
  if (step === 'pack') tear();
  else if (step === 'tear') showStack();          // 破っている途中に押したら、すぐ束へ
  else if (step === 'cards') nextCard();
  else if (step === 'sum' && packsLeft()) openPack(opening.no);
});
/* カードの拡大：押すと閉じる */
function zoom(c) {
  $('#zoomIn').innerHTML = `<div class="dt-card">${cardHTML(c, 'full', '', 3)}</div>
    <dl class="dt-info"><dt>系統</dt><dd>${esc(ATTR_L[c.attr] || '')}</dd><dt>作者</dt><dd>${esc(c.by || '')}</dd></dl>`;
  $('#zoom').hidden = false;
}
$('#zoom').onclick = () => $('#zoom').hidden = true;
/* 束と袋の大きさ：高さが画面の6割くらいに収まる整数倍（ドットがにじまないように）。最小2倍。FIT で割合を変えられる */
const FIT = .6;
function fit() {
  const h = innerHeight * FIT, w = document.documentElement.clientWidth - 32;
  $('#ov').style.setProperty('--cs', Math.max(2, Math.min(Math.floor(h / CH), Math.floor((w - 16) / CW))));
  $('#ov').style.setProperty('--ps', Math.max(2, Math.min(Math.floor(h / PH), Math.floor(w / PW))));
}
addEventListener('resize', fit); fit();
$('#again').onclick = () => openPack(opening.no);
$('#again10').onclick = () => openPack(opening.no, true);
$('#closeOv').onclick = () => { $('#ov').hidden = true; document.body.style.overflow = ''; renderPacks() };



boot({ render: renderPacks });
