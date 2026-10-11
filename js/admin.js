/* ドットパック 管理画面（管理者のGoogleアカウントだけが操作できる。守りは firestore.rules） */
import {
  auth, db, CONFIGURED, MOCK, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit, serverTimestamp, writeBatch
} from './fb.js';
import { ADMIN_UID } from './config.js';
import { $, esc, ATTRS, ATTR_L, N, fmtNo, parseNo, PALETTES, artURL, cardHTML, clearCardCache, loadCardFont, assignStars } from './cards.js';

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600) }
const TYPE_L = { del: '作品の削除', hide: '作者名の非表示', ad: '広告のご依頼' };
const REASON_L = {
  own: '自分の作品を消したい（本人）', rights: '無断で使われている', copy: 'トレース・転載に見える', nsfw: '性的・暴力的・差別的', abuse: '誹謗中傷・個人情報', spam: 'テーマと関係ない・荒らし',
  quit: '名前を出したくなくなった', trouble: 'トラブルを避けたい', other: 'その他'
};
const fmtDate = t => { if (!t) return ''; const d = t.toDate ? t.toDate() : new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };

const A = { tab: 'req', themes: [], cardsByTheme: new Map(), reqCards: new Map(), requests: [], gw: 3, arm: null, onlyOpen: true, cardTheme: null, q: '' };
/* 'closing' は締め切りの集計中（投稿・投票はもう止まっている）。途中で失敗したときはやり直せる */
const openTheme = () => A.themes.find(t => t.status === 'open' || t.status === 'closing') || null;

/* ---------- ログイン ---------- */
$('#login').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => toast('ログインできませんでした'));
$('#logout').onclick = () => signOut(auth);
function start() {
  if (!CONFIGURED) { $('#who').textContent = 'js/config.js に Firebase の設定を書いてください。'; return }
  onAuthStateChanged(auth, async u => {
    $('#login').hidden = !!u && !u.isAnonymous; $('#logout').hidden = !u || u.isAnonymous;
    if (!u || u.isAnonymous) { $('#who').textContent = '管理者のGoogleアカウントでログインしてください。'; $('#main').hidden = true; return }
    const ok = u.uid === ADMIN_UID;
    $('#who').innerHTML = `${esc(u.email || '')}　UID：<code>${esc(u.uid)}</code>${ok ? '' : '<br>このアカウントは管理者として登録されていません。js/config.js と firestore.rules の ADMIN_UID に、上の UID を書いてください。'}`;
    $('#main').hidden = !ok;
    if (ok) { await loadAll(); render() }
  });
  loadCardFont().then(() => { clearCardCache(); if (!$('#main').hidden) render() });
}

/* ---------- 読み込み ---------- */
async function loadAll() {
  const ts = await getDocs(query(collection(db, 'themes'), orderBy('no')));
  A.themes = ts.docs.map(d => ({ id: d.id, ...d.data() }));
  for (const t of A.themes) PALETTES[t.id] = t.palettes;
  try { const c = await getDoc(doc(db, 'config', 'admin')); A.gw = c.exists() ? (c.data().gw || 3) : 3 } catch (e) { }
  await loadRequests();
}
async function loadRequests() {
  const rs = await getDocs(query(collection(db, 'requests'), orderBy('at', 'desc'), limit(200)));
  A.requests = rs.docs.map(d => ({ id: d.id, ...d.data() }));
  A.reqCards.clear();
}
/* 削除・非表示・作者名非表示にした作品は、公開のカードから中身を消して、元の内容を vault（管理者だけが読める）に移す。
   管理画面では元の内容を重ねて表示する。 */
const SECRET = ['uid', 'by', 'name', 'text', 'px'];
const EMPTY = '0'.repeat(N * N);
const vaultRef = c => doc(db, 'vault', c.tid + '_' + c.id);
async function loadCards(tid, force) {
  if (!force && A.cardsByTheme.has(tid)) return A.cardsByTheme.get(tid);
  const [cs, vs] = await Promise.all([getDocs(collection(db, 'themes', tid, 'cards')), getDocs(query(collection(db, 'vault'), where('tid', '==', tid)))]);
  const vault = new Map(vs.docs.map(d => [d.data().cid, d.data().data]));
  const list = cs.docs.map(d => ({ id: d.id, ...d.data(), ...(vault.get(d.id) || {}) })).sort((a, b) => a.no - b.no);
  A.cardsByTheme.set(tid, list); return list;
}
async function reqCard(r) {
  if (!r.tid || !r.cid) return null;
  const list = A.cardsByTheme.get(r.tid);
  if (list) return list.find(c => c.id === r.cid) || null;
  const key = r.tid + '/' + r.cid;
  if (A.reqCards.has(key)) return A.reqCards.get(key);
  const [d, v] = await Promise.all([getDoc(doc(db, 'themes', r.tid, 'cards', r.cid)), getDoc(doc(db, 'vault', r.tid + '_' + r.cid))]);
  const c = d.exists() ? { id: d.id, ...d.data(), ...(v.exists() ? v.data().data : {}) } : null;
  A.reqCards.set(key, c); return c;
}
/* c はいつも元の内容を持っている（vault を重ねてある） */
async function patchCard(c, data) {
  const next = { ...c, ...data }, gone = next.deleted || next.hidden;
  if (gone || next.anon) await setDoc(vaultRef(c), { tid: c.tid, cid: c.id, data: Object.fromEntries(SECRET.map(k => [k, c[k] ?? ''])) });
  const pub = gone ? { uid: '', by: '', name: '', text: '', px: EMPTY } : next.anon ? { uid: '', by: '', name: c.name, text: c.text || '', px: c.px } : Object.fromEntries(SECRET.map(k => [k, c[k] ?? '']));
  await updateDoc(doc(db, 'themes', c.tid, 'cards', c.id), { ...data, ...pub, updatedAt: serverTimestamp() });
  Object.assign(c, data);
}

/* ---------- 画面 ---------- */
document.querySelectorAll('[data-adm]').forEach(b => b.onclick = () => { A.tab = b.dataset.adm; A.arm = null; render() });
function render() {
  const open = A.requests.filter(r => !r.done).length;
  $('#admReqCnt').textContent = open || '';
  document.querySelectorAll('[data-adm]').forEach(b => b.setAttribute('aria-pressed', b.dataset.adm === A.tab));
  for (const k of ['req', 'cards', 'close', 'theme', 'export']) $('#adm-' + k).hidden = k !== A.tab;
  ({ req: renderReq, cards: renderCards, close: renderClose, theme: renderTheme, export: renderExport })[A.tab]();
}

/* お問い合わせ */
async function renderReq() {
  const list = A.requests.filter(r => !A.onlyOpen || !r.done);
  const items = await Promise.all(list.map(async r => {
    let body = '', acts = '';
    if (r.type === 'ad') body = `<p class="req-txt"><span>お名前</span> ${esc(r.name)}\n<span>メール</span> ${esc(r.mail)}\n${esc(r.body)}</p>`;
    else {
      const c = await reqCard(r);
      body = `<div class="req-b">${c ? `<img src="${artURL(c)}" alt="">` : ''}<div><b>${c ? esc(c.name) : '（見つからない作品）'}</b><span>${esc(r.no)}${c ? ` ・ by ${esc(c.by)}` : ''}${c && c.hidden ? ' ・ 非表示中' : ''}${c && c.deleted ? ' ・ 削除済み' : ''}</span><span>理由：${esc(REASON_L[r.reason] || r.reason)}</span></div></div>`;
      if (c && !r.done) {
        if (r.type === 'del') acts += `<button class="btn" data-ra="hide" data-id="${esc(r.id)}">非表示にする</button><button class="btn" data-ra="delete" data-id="${esc(r.id)}">${A.arm === 'r' + r.id ? 'もう一度押すと削除' : '作品を削除'}</button>`;
        if (r.type === 'hide') acts += `<button class="btn" data-ra="anon" data-id="${esc(r.id)}">作者名を非表示にする</button>`;
      }
    }
    acts += `<button class="btn" data-ra="done" data-id="${esc(r.id)}">${r.done ? '未対応にもどす' : '対応済みにする'}</button>`;
    return `<div class="req ${r.done ? 'done' : ''}"><div class="req-h"><span class="badge ${r.type}">${TYPE_L[r.type]}</span><span>${fmtDate(r.at)}</span>${r.done ? '<span>対応済み</span>' : ''}</div>${body}<div class="acts">${acts}</div></div>`;
  }));
  $('#adm-req').innerHTML = `<div class="adm-bar"><label class="chk" style="margin:0"><input type="checkbox" id="onlyOpen" ${A.onlyOpen ? 'checked' : ''}><span>未対応だけ表示</span></label><button class="btn small" id="reloadReq">再読み込み</button></div><div class="reqs">${items.join('') || '<p class="empty">お問い合わせはありません。</p>'}</div>`;
}
$('#adm-req').addEventListener('change', e => { if (e.target.id === 'onlyOpen') { A.onlyOpen = e.target.checked; renderReq() } });
$('#adm-req').addEventListener('click', async e => {
  if (e.target.id === 'reloadReq') { await loadRequests(); render(); return }
  const b = e.target.closest('[data-ra]'); if (!b) return;
  const r = A.requests.find(x => x.id === b.dataset.id); const a = b.dataset.ra;
  try {
    const c = a === 'done' ? null : await reqCard(r);
    if (a === 'delete') { if (A.arm !== 'r' + r.id) { A.arm = 'r' + r.id; renderReq(); return } await patchCard(c, { deleted: true }); toast('削除しました') }
    if (a === 'hide') { await patchCard(c, { hidden: true }); toast('非表示にしました') }
    if (a === 'anon') { await patchCard(c, { anon: true }); toast('作者名を非表示にしました') }
    const done = a === 'done' ? !r.done : true;
    await updateDoc(doc(db, 'requests', r.id), { done }); r.done = done;
    if (a !== 'done' && c && c.star) toast('締め切り済みのパックの作品です。「パック書き出し」でJSONを作り直してください');
  } catch (err) { console.warn(err); toast('更新できませんでした') }
  A.arm = null; render();
});

/* 作品 */
async function renderCards() {
  if (!A.themes.length) { $('#adm-cards').innerHTML = '<p class="empty">まだテーマがありません。「テーマ」から作ってください。</p>'; return }
  if (!A.cardTheme) A.cardTheme = (openTheme() || A.themes[A.themes.length - 1]).id;
  const th = A.themes.find(t => t.id === A.cardTheme);
  const list = await loadCards(th.id);
  const q = A.q.trim(), n = parseNo(q);
  const cards = n ? list.filter(c => c.no === n.no && c.tno === n.tno) : list;
  const chips = A.themes.slice().reverse().map(t => `<button class="chip" data-ath="${esc(t.id)}" aria-pressed="${t.id === th.id}">${t.no}. ${esc(t.name)}${t.status === 'open' ? '（受付中）' : ''}</button>`).join('');
  const cells = cards.map(c => {
    const tags = [c.deleted && '削除済み', c.hidden && '非表示', c.fan && 'パック対象外', c.anon && '作者名非表示'].filter(Boolean).map(t => `<span class="stag on">${t}</span>`).join('');
    return `<div class="adm-cell ${c.hidden || c.deleted ? 'off' : ''}">${cardHTML(c, c.star ? 'full' : 'pending')}<div class="cap"><span>by ${esc(c.by)}</span></div><div class="stags">${tags}</div><div class="acts">
      <button class="btn" data-ca="hidden" data-id="${esc(c.id)}">${c.hidden ? '表示する' : '非表示'}</button>
      <button class="btn" data-ca="fan" data-id="${esc(c.id)}">${c.fan ? 'パックに入れる' : 'パック対象外'}</button>
      <button class="btn" data-ca="anon" data-id="${esc(c.id)}">${c.anon ? '作者名を出す' : '作者名を隠す'}</button>
      <button class="btn" data-ca="deleted" data-id="${esc(c.id)}">${c.deleted ? '削除を取り消す' : A.arm === 'c' + c.id ? 'もう一度押すと削除' : '削除'}</button></div></div>`
  }).join('');
  $('#adm-cards').innerHTML = `<div class="adm-bar"><input type="text" id="admQ" placeholder="作品番号 0003-2" value="${esc(q)}" autocomplete="off"><button class="btn small" id="reloadCards">再読み込み</button></div><div class="chips">${chips}</div>
    ${th.status === 'closed' ? '<p class="hint">締め切り済みのパックを変えたときは、「パック書き出し」でJSONを作り直してGitHubに上げてください。</p>' : ''}
    <div class="grid">${cells || '<p class="empty">作品がありません。</p>'}</div>`;
}
$('#adm-cards').addEventListener('change', e => { if (e.target.id === 'admQ') { A.q = e.target.value; renderCards() } });
$('#adm-cards').addEventListener('click', async e => {
  if (e.target.id === 'reloadCards') { await loadCards(A.cardTheme, true); renderCards(); return }
  const t = e.target.closest('[data-ath]'); if (t) { A.cardTheme = t.dataset.ath; A.q = ''; renderCards(); return }
  const b = e.target.closest('[data-ca]'); if (!b) return;
  const c = A.cardsByTheme.get(A.cardTheme).find(x => x.id === b.dataset.id), k = b.dataset.ca;
  if (k === 'deleted' && !c.deleted && A.arm !== 'c' + c.id) { A.arm = 'c' + c.id; renderCards(); return }
  A.arm = null;
  try { await patchCard(c, { [k]: !c[k] }) } catch (err) { toast('更新できませんでした') }
  renderCards();
});

/* 締め切り */
function renderClose() {
  const th = openTheme();
  $('#adm-close').innerHTML = `<div class="adm-form">
    <div><h3><label for="gw">Google連携ユーザーの票の重み</label></h3>
      <select id="gw">${[1, 2, 3].map(n => `<option value="${n}" ${A.gw === n ? 'selected' : ''}>1票を ${n} 票として数える</option>`).join('')}</select>
      <p class="hint">この設定はサイトには表示されません。</p></div>
    ${th && th.status === 'closing' ? '<p class="err">前回の締め切りが途中で止まっています。投稿と投票は止まっています。「集計して締め切る」でやり直してください。</p>' : ''}
    ${th ? `<div><h3>受付中のテーマ</h3><dl class="kv"><dt>パック</dt><dd>${th.no}. ${esc(th.name)}</dd><dt>月</dt><dd>${esc(th.month)}</dd><dt>投稿番号</dt><dd>${th.seq || 0} まで</dd></dl></div>
    <p class="hint">締め切ると、票を集計して星と系統を決め、パックのJSONを書き出します。締め切ったあとは投稿と投票ができなくなります。</p>
    <div><button class="btn primary" id="doClose">${A.arm === 'close' ? 'もう一度押すと締め切ります' : '集計して締め切る'}</button></div>
    <p class="hint" id="closeLog"></p>` : '<p class="empty">受付中のテーマはありません。「テーマ」から次のテーマを始めてください。</p>'}
  </div>`;
}
$('#adm-close').addEventListener('change', async e => { if (e.target.id === 'gw') { A.gw = +e.target.value; try { await setDoc(doc(db, 'config', 'admin'), { gw: A.gw }, { merge: true }); toast('保存しました') } catch (err) { toast('保存できませんでした') } } });
$('#adm-close').addEventListener('click', async e => {
  if (e.target.id !== 'doClose') return;
  if (A.arm !== 'close') { A.arm = 'close'; e.target.textContent = 'もう一度押すと締め切ります'; return }
  A.arm = null; e.target.disabled = true;
  const log = m => { $('#closeLog').textContent = m };
  const th = openTheme();
  try {
    /* 先に投稿と投票を止めてから集計する（集計中に入った投稿や票が抜け落ちないように） */
    if (th.status === 'open') { log('投稿と投票を止めています…'); await updateDoc(doc(db, 'themes', th.id), { status: 'closing' }); th.status = 'closing' }
    log('作品と票を読み込んでいます…');
    const cards = await loadCards(th.id, true);
    const byId = new Map(cards.map(c => [c.id, c]));
    const vs = await getDocs(query(collection(db, 'votes'), where('tid', '==', th.id)));
    const totals = {}; const valid = new Set(ATTRS.map(a => a.k));
    vs.forEach(d => {
      const v = d.data(), w = v.google ? A.gw : 1;
      for (const [cid, attr] of Object.entries(v.v || {})) {
        const c = byId.get(cid); if (!c || !valid.has(attr) || c.uid === v.uid) continue;   // 自分の作品への票は数えない
        (totals[cid] = totals[cid] || {})[attr] = (totals[cid][attr] || 0) + w;
      }
    });
    const eligible = cards.filter(c => !c.deleted && !c.hidden && !c.fan);
    assignStars(eligible, totals);
    log(`集計しました（票 ${vs.size} 件・パック収録 ${eligible.length} 枚）。保存しています…`);
    for (let i = 0; i < eligible.length; i += 400) {
      const b = writeBatch(db);
      eligible.slice(i, i + 400).forEach(c => b.update(doc(db, 'themes', th.id, 'cards', c.id), { star: c.star, attr: c.attr, score: c.score, updatedAt: serverTimestamp() }));
      await b.commit();
    }
    await updateDoc(doc(db, 'themes', th.id), { status: 'closed', closedAt: serverTimestamp() });
    th.status = 'closed';
    await exportPack(th);
    log('締め切りました。ダウンロードした2つのファイルを GitHub の packs フォルダに上げてください。');
    toast('締め切りました');
  } catch (err) {
    console.warn(err); e.target.disabled = false;
    log('途中で失敗しました：' + (err.message || err) + (th.status === 'closing' ? '（投稿と投票は止まったままです。もう一度押すと続きからやり直せます）' : ''));
  }
});

/* パックのJSONを作ってダウンロード（packs/0001.json と packs/index.json） */
function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportPack(th) {
  const cards = (await loadCards(th.id, true)).filter(c => !c.deleted && !c.hidden && !c.fan && c.star);
  const pack = {
    no: th.no, tid: th.id, name: th.name, month: th.month, palettes: th.palettes,
    cards: cards.map(c => ({ id: c.id, no: c.no, name: c.name, text: c.text || '', by: c.anon ? '' : c.by, anon: !!c.anon, p: c.p, px: c.px, star: c.star, attr: c.attr || null, base: c.base || null, baseNo: c.baseNo || null }))
  };
  const cover = cards.slice().sort((a, b) => b.star - a.star || (b.score || 0) - (a.score || 0))[0];
  let index = [];
  const mp = MOCK ? JSON.parse(localStorage.getItem('mock-packs') || 'null') : null;
  if (mp) index = mp.index;
  else try { const r = await fetch('packs/index.json', { cache: 'no-cache' }); if (r.ok) index = await r.json() } catch (e) { }
  index = index.filter(p => p.no !== th.no);
  index.push({ no: th.no, tid: th.id, name: th.name, month: th.month, count: cards.length, palettes: th.palettes, cover: cover ? { px: cover.px, p: cover.p } : null, ids: cards.map(c => c.id) });
  index.sort((a, b) => a.no - b.no);
  if (MOCK) { const m2 = mp || { index: [], packs: {} }; m2.index = index; m2.packs[th.no] = pack; localStorage.setItem('mock-packs', JSON.stringify(m2)) }
  download(String(th.no).padStart(4, '0') + '.json', pack);
  setTimeout(() => download('index.json', index), 600);
}
function renderExport() {
  const closed = A.themes.filter(t => t.status === 'closed');
  $('#adm-export').innerHTML = `<div class="adm-form"><p class="hint">締め切ったパックの作品を非表示にしたり作者名を隠したりしたときは、ここでJSONを作り直して、GitHub の packs フォルダのファイルを置き換えてください。</p>
    ${closed.map(t => `<div><button class="btn" data-exp="${esc(t.id)}">${t.no}. ${esc(t.name)} を書き出す</button></div>`).join('') || '<p class="empty">締め切ったパックはまだありません。</p>'}</div>`;
}
$('#adm-export').addEventListener('click', async e => { const b = e.target.closest('[data-exp]'); if (!b) return; try { await exportPack(A.themes.find(t => t.id === b.dataset.exp)); toast('書き出しました') } catch (err) { toast('書き出せませんでした') } });

/* テーマ（次のテーマとパレット） */
const DEFAULT_PALS = [
  { name: 'げんき', colors: '#1c1c28 #ffffff #e8383d #ff8c42 #ffd23f #6cc551 #2a9d5c #3b82f6 #1e4fa8 #9b5de5 #ff7eb6 #f6c9a0 #d9925b #8a5a3b #9aa3b1'.split(' ') },
  { name: 'ふんわり', colors: '#3b2f3a #fffaf3 #ffb5c2 #ffd6a5 #fdffb6 #caffbf #9bf6ff #a0c4ff #bdb2ff #ffc6ff #f5d7c3 #e8b98a #c08b6a #8c6a5d #b8b8c8'.split(' ') },
  { name: 'よふかし', colors: '#0d0b1e #f2f0ff #1f1b4a #3a2f80 #6a4bc4 #ff4fa3 #ff8a3d #ffe066 #3dffb5 #34c6ff #2b6fff #c7a17a #7d5a44 #5c5f7a #a9acc9'.split(' ') },
];
let pals = null;
function renderTheme() {
  const th = openTheme(), last = A.themes[A.themes.length - 1];
  if (!pals) pals = JSON.parse(JSON.stringify(last ? last.palettes : DEFAULT_PALS));
  const nextNo = (last ? last.no : 0) + 1;
  const d = new Date(); const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  $('#adm-theme').innerHTML = `<div class="adm-form">
    ${th ? `<p class="hint">いまは「${esc(th.name)}」を受付中です。新しいテーマは、締め切ってから始められます。</p>` : ''}
    <div><h3><label for="tName">次のテーマ名（パック番号 ${nextNo}）</label></h3><input type="text" id="tName" maxlength="24" placeholder="天空の使者パック"></div>
    <div><h3><label for="tMonth">月</label></h3><input type="month" id="tMonth" value="${month}"></div>
    ${pals.map((p, i) => `<div class="paled"><h3><input type="text" class="pname" data-i="${i}" value="${esc(p.name)}" maxlength="12" aria-label="パレット${i + 1}の名前"></h3>
      <div class="pcols">${p.colors.map((c, j) => `<input type="color" data-i="${i}" data-j="${j}" value="${c}" aria-label="パレット${i + 1}の${j + 1}色目">`).join('')}</div></div>`).join('')}
    <p class="hint">各パレットは15色です（透明は自動で付きます）。1色目は一番暗い色にしておくと描きやすくなります。</p>
    <div><button class="btn primary" id="makeTheme" ${th ? 'disabled' : ''}>このテーマを始める</button></div>
  </div>`;
}
$('#adm-theme').addEventListener('input', e => {
  const i = +e.target.dataset.i;
  if (e.target.classList.contains('pname')) pals[i].name = e.target.value;
  if (e.target.type === 'color') pals[i].colors[+e.target.dataset.j] = e.target.value;
});
$('#adm-theme').addEventListener('click', async e => {
  if (e.target.id !== 'makeTheme') return;
  const name = $('#tName').value.trim(), month = $('#tMonth').value;
  if (!name) { toast('テーマ名を入れてください'); return }
  if (openTheme()) { toast('受付中のテーマがあります'); return }
  const last = A.themes[A.themes.length - 1];
  try {
    const ref = await addDoc(collection(db, 'themes'), { no: (last ? last.no : 0) + 1, name, month, status: 'open', palettes: pals, seq: 0, createdAt: serverTimestamp() });
    await loadAll(); pals = null; toast('テーマを始めました'); A.tab = 'close'; render();
  } catch (err) { console.warn(err); toast('作れませんでした') }
});

start();
