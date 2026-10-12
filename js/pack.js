/* パックページ（締め切ったテーマのパックを開ける） */
import { $, esc, cardHTML, pull, CW, CH, PW, PH, packURL, cardBackURL } from './cards.js';
import { S, toast, boot, monthLabel, loadPack, packsLeft, usePack, chargeText, saveOwned } from './core.js';

function renderCharge() {
  const left = packsLeft();
  $('#packCharge').innerHTML = chargeText() + '<br><small>ほかの人の作品に投票すると1回ふえます</small>';
  document.querySelectorAll('[data-open]').forEach(b => b.disabled = !left);
  $('#again').disabled = !left;
}
setInterval(renderCharge, 30000);

/* ---------- パック ---------- */
function renderPacks() {
  if (!S.loaded) return;
  $('#packList').innerHTML = S.packIndex.map(p => {
    const cover = p.cover ? { id: 'cover' + p.no, tid: p.tid, ...p.cover } : null;
    return `<div class="pack">
    <img class="pimg" src="${packURL(p, cover)}" width="${PW * 2}" height="${PH * 2}" alt="${esc(p.name)}">
    <div class="pm">${monthLabel(p.month)}のテーマ</div>
    <div class="pc">${ownedCountIdx(p)} / ${p.count}種</div>
    <button class="btn small" data-open="${p.no}">開ける</button></div>`
  }).join('') || '<p class="empty">まだ開けられるパックがありません。月末の締め切りのあと、ここに並びます。</p>';
  $('#packCharge').hidden = !S.packIndex.length; renderCharge();
}
function ownedCountIdx(p) { const pk = S.packs.get(p.no); return pk ? pk.cards.filter(c => S.owned[c.id]).length : (p.ids || []).filter(id => S.owned[id]).length }
$('#packList').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openPack(+b.dataset.open) });
let opening = null;
async function openPack(no) {
  if (!packsLeft()) { toast('開けられる回数がありません'); renderCharge(); return }
  let p; try { p = await loadPack(no) } catch (e) { toast('パックを読み込めませんでした'); return }
  opening = p; const idx = S.packIndex.find(x => x.no === no);
  const cover = idx && idx.cover ? { id: 'cover' + no, tid: p.tid, ...idx.cover } : null;
  $('#ovPack').className = '';
  $('#ovPack').innerHTML = `<img class="pimg" src="${packURL({ ...p, name: idx ? idx.name : p.name }, cover)}" width="${PW * 3}" height="${PH * 3}" alt="${esc(p.name)}のパック">`;
  $('#ovPack').hidden = false; $('#ovHint').hidden = false; $('#ovCards').hidden = true; $('#ovActions').hidden = true;
  $('#ov').hidden = false; document.body.style.overflow = 'hidden';
}
$('#ovPack').onclick = () => {
  const p = $('#ovPack'); if (p.classList.contains('shake')) return;
  if (!usePack()) { toast('開けられる回数がありません'); return }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  p.classList.add('shake');
  setTimeout(() => { p.classList.add('tear'); setTimeout(() => { p.hidden = true; $('#ovHint').hidden = true; showCards() }, reduce ? 0 : 450) }, reduce ? 0 : 450);
};
function showCards() {
  const got = pull(opening.cards);
  $('#ovCards').innerHTML = got.map(c => {
    const isNew = !S.owned[c.id]; S.owned[c.id] = (S.owned[c.id] || 0) + 1;
    return `<div class="flip ${c.star >= 4 ? 'hint-top' : ''}"><div class="inner"><div class="face back"><img class="cimg" src="${cardBackURL()}" width="${CW * 2}" height="${CH * 2}" alt="カードの裏"></div><div class="face front">${cardHTML(c, 'full')}</div></div>${isNew ? '<span class="badge-new new">NEW</span>' : ''}</div>`
  }).join('');
  saveOwned();
  $('#ovCards').hidden = false; $('#ovActions').hidden = false; renderCharge();
}
$('#ovCards').addEventListener('click', e => { const f = e.target.closest('.flip'); if (f) f.classList.add('open') });
$('#flipAll').onclick = () => document.querySelectorAll('#ovCards .flip').forEach((f, i) => setTimeout(() => f.classList.add('open'), i * 120));
$('#again').onclick = () => openPack(opening.no);
$('#closeOv').onclick = () => { $('#ov').hidden = true; document.body.style.overflow = ''; renderPacks() };

boot({ render: renderPacks });
