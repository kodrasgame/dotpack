/* ドットパック 公開ページ */
import {
  auth, db, CONFIGURED, MOCK, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, linkWithPopup, signInWithCredential, signOut,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit, runTransaction, serverTimestamp,
  writeBatch, startAfter, increment, getCountFromServer
} from './fb.js';
import {
  $, esc, ATTRS, ATTR_L, N, NAME_MAX, TEXT_MAX, fmtNo, parseNo, nameW, clipW, PALETTES,
  artURL, cardHTML, clearCardCache, loadCardFont, pull, CW, CH, PW, PH, packURL, cardBackURL
} from './cards.js';
import { PACK_CHARGE_HOURS, PACK_MAX, PACK_PER_VOTE } from './config.js';

/* ---------- 小さな道具 ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } },
};
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200) }
const ms = v => v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0);

/* ---------- 状態 ---------- */
const S = {
  tab: store.get('dp-tab', 'vote'),
  user: null,
  theme: null,          // 受付中のテーマ { id, no, name, month, palettes, seq }
  cards: new Map(),     // 読み込んだ受付中のカード id -> card
  sort: store.get('dp-sort', 'new'),   // 投票の並び順 new（新着順）/ pop（人気順）
  feeds: {},            // 並び順ごとの読み込み状況 { ids, cursor, done, loading, failed }
  count: null,             // 受付中のカードの枚数（削除・非表示を除く）
  myVotes: {},          // cardId -> 系統
  packIndex: [],        // 締め切ったパックの一覧（packs/index.json）
  packs: new Map(),     // パック番号 -> パックの中身
  owned: store.get('dp-owned', {}),
};
const isGoogle = () => !!(S.user && S.user.providerData.some(p => p.providerId === 'google.com'));
const authorName = () => store.get('dp-name', '') || 'ななしさん';
const voteKey = () => 'dp-votes-' + S.theme.id + '-' + S.user.uid;   // 端末に保存する票はアカウントごと
const visible = c => !!c && !c.deleted && !c.hidden;

/* ---------- タブ・ページ ---------- */
const MAIN = ['make', 'vote', 'packs', 'dex'];
let backTab = 'vote';
function setTab(t) {
  S.tab = t; if (MAIN.includes(t)) store.set('dp-tab', t);
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $('#plusBtn').setAttribute('aria-pressed', t === 'make');
  for (const k of ['make', 'vote', 'packs', 'dex', 'terms', 'contact', 'account']) $('#tab-' + k).hidden = k !== t;
  $('#adSlot').hidden = ['terms', 'contact', 'account'].includes(t);
  if (t === 'make') openMake();
  if (t === 'vote') renderVote();
  if (t === 'packs') renderPacks();
  if (t === 'dex') renderDex();
  if (t === 'account') renderAccount();
}
function openPage(p) { if (MAIN.includes(S.tab)) backTab = S.tab; setTab(p); window.scrollTo(0, 0) }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#plusBtn').onclick = () => { setTab('make'); window.scrollTo(0, 0) };
$('#termsLink').onclick = () => openPage('terms');
$('#accountLink').onclick = () => openPage('account');
document.querySelectorAll('[data-terms]').forEach(b => b.onclick = () => openPage('terms'));
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => setTab(backTab));
document.querySelectorAll('[data-contact]').forEach(b => b.onclick = () => openContact(b.dataset.contact));

/* ---------- ヘッダー ---------- */
function monthLabel(m) { return m ? Number(m.split('-')[1]) + '月' : '' }
function renderHeader() {
  const th = S.theme;
  if (!th) { $('#thLbl').textContent = ''; $('#thName').textContent = 'ドットパック'; $('#thMeta').textContent = '次のテーマを準備中です'; return }
  $('#thLbl').textContent = monthLabel(th.month) + 'のテーマ';
  $('#thName').textContent = th.name;
  const [y, m] = th.month.split('-').map(Number);
  const left = Math.max(0, Math.ceil((new Date(y, m, 1) - new Date()) / 864e5));
  $('#thMeta').innerHTML = `投稿・投票 受付中<br>のこり <b>${left}</b> 日 ・ <b>${S.count ?? '…'}</b> 枚`;
}

/* ---------- 読み込み ---------- */
async function loadTheme() {
  const snap = await getDocs(query(collection(db, 'themes'), where('status', '==', 'open'), limit(1)));
  if (snap.empty) { S.theme = null; cleanCache(); return }
  const d = snap.docs[0];
  S.theme = { id: d.id, ...d.data() };
  PALETTES[S.theme.id] = S.theme.palettes;
  cleanCache();
}
/* 締め切ったテーマの票の控えと、前の版のカードの控え（dp-cards-*）を端末から消す */
function cleanCache() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('dp-cards-') || (k.startsWith('dp-votes-') && !(S.theme && k.startsWith('dp-votes-' + S.theme.id + '-')))) localStorage.removeItem(k);
    }
  } catch (e) { }
}
/* 受付中のカード：並び順ごとに PAGE 枚ずつ読む（「もっと見る」で続きを読む） */
const PAGE = 20;
const SORTS = { new: ['no', 'desc'], pop: ['vc', 'desc'] };
const cardsCol = () => collection(db, 'themes', S.theme.id, 'cards');
const toCard = d => { const v = d.data(); return { ...v, id: d.id, createdAt: ms(v.createdAt), updatedAt: ms(v.updatedAt) } };
const feed = () => S.feeds[S.sort] || (S.feeds[S.sort] = { ids: [], cursor: null, done: false, loading: null, failed: false });
function resetCards() { S.cards = new Map(); S.feeds = {} }
function loadMore() {
  const f = feed();
  if (!S.theme || f.done) return Promise.resolve();
  if (f.loading) return f.loading;
  const cons = [orderBy(...SORTS[S.sort])]; if (f.cursor) cons.push(startAfter(f.cursor)); cons.push(limit(PAGE));
  return f.loading = getDocs(query(cardsCol(), ...cons)).then(snap => {
    snap.forEach(d => { S.cards.set(d.id, toCard(d)); if (!f.ids.includes(d.id)) f.ids.push(d.id) });
    if (snap.docs.length) f.cursor = snap.docs[snap.docs.length - 1];
    f.done = snap.docs.length < PAGE;
  }).finally(() => { f.loading = null });
}
async function more() {
  const f = feed();
  try { await loadMore() } catch (e) { console.warn(e); f.failed = true; toast('読み込めませんでした') }
  if (S.tab === 'vote') renderVote();
}
/* 枚数だけを数える（1000枚ごとに読み取り1回ぶん） */
async function countCards() {
  if (!S.theme) return;
  try { const r = await getCountFromServer(query(cardsCol(), where('deleted', '==', false), where('hidden', '==', false))); S.count = r.data().count }
  catch (e) { console.warn(e); S.count = S.theme.seq || 0 }
}

/* 票：画面の票（S.myVotes）と、サーバーに保存済みの票（savedVotes）の差だけ書く */
let carryVotes = null;   // 別のアカウントに切り替えたときに持っていく票
let savedVotes = {}, savedFor = '';
async function readSavedVotes(tid, uid) {
  const d = await getDoc(doc(db, 'votes', tid + '_' + uid));
  savedVotes = d.exists() ? (d.data().v || {}) : {}; savedFor = tid + '_' + uid;
}
const saveLocalVotes = dirty => store.set(voteKey(), { v: S.myVotes, dirty });
async function loadMyVotes() {
  if (!S.theme || !S.user) { carryVotes = null; return }
  try { await readSavedVotes(S.theme.id, S.user.uid) } catch (e) { savedVotes = {}; savedFor = '' }
  const local = store.get(voteKey(), null);
  // 保存しきれなかった票が端末に残っていれば、それを使って保存し直す
  if (local && local.dirty && local.v) { S.myVotes = local.v; voteDirty = true } else S.myVotes = { ...savedVotes };
  if (carryVotes) {
    // 切り替え先ですでに入れていた票はそのまま、まだ入れていない作品の分だけ足す
    S.myVotes = { ...carryVotes, ...S.myVotes }; carryVotes = null; voteDirty = true;
  }
  if (voteDirty) { saveLocalVotes(true); await flushVotes() }
}
async function loadPackIndex() {
  const mp = MOCK ? store.get('mock-packs', null) : null;
  if (mp) S.packIndex = mp.index.slice();
  else try { const r = await fetch('packs/index.json', { cache: 'no-cache' }); S.packIndex = r.ok ? await r.json() : [] } catch (e) { S.packIndex = [] }
  S.packIndex.sort((a, b) => b.no - a.no);
  for (const p of S.packIndex) PALETTES[p.tid] = p.palettes;
}
async function loadPack(no) {
  if (S.packs.has(no)) return S.packs.get(no);
  const mp = MOCK ? store.get('mock-packs', null) : null;
  let p;
  if (mp && mp.packs[no]) p = mp.packs[no];
  else { const r = await fetch(`packs/${String(no).padStart(4, '0')}.json`, { cache: 'no-cache' }); if (!r.ok) throw new Error('pack'); p = await r.json() }
  PALETTES[p.tid] = p.palettes;
  p.cards.forEach(c => { c.tid = p.tid; c.tno = p.no });
  S.packs.set(no, p); return p;
}
function cardById(id) {
  if (S.cards.has(id)) return S.cards.get(id);
  for (const p of S.packs.values()) { const c = p.cards.find(c => c.id === id); if (c) return c }
  return null;
}

/* ---------- 投票（まとめて保存） ---------- */
let voteTimer = null, voteDirty = false;
function renderVote() {
  document.querySelectorAll('[data-sort]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === S.sort));
  $('#voteSort').hidden = !S.theme;
  if (!S.theme) { $('#voteNote').textContent = ''; $('#voteGrid').innerHTML = '<p class="empty">いまは投稿・投票を受け付けていません。</p>'; $('#voteMore').hidden = true; return }
  const f = feed(), uid = S.user && S.user.uid;
  if (!f.ids.length && !f.done && !f.loading && !f.failed) more();   // 最初の1ページ
  const list = f.ids.map(id => S.cards.get(id)).filter(visible);
  $('#voteMore').hidden = f.done; $('#voteMore').disabled = !!f.loading; $('#voteMore').textContent = f.loading ? '読み込み中…' : 'もっと見る';
  $('#voteNote').innerHTML = `1枚につき1つ選べます。いちばん票が集まった項目がそのカードの系統になります。（投票済み ${Object.keys(S.myVotes).length} 枚）<br>はじめて投票した作品ごとにパックを開ける回数が <b>+${PACK_PER_VOTE}</b>（いま あと <b>${packsLeft()}</b> 回）`;
  $('#voteGrid').innerHTML = list.map(c => `<div class="vcell">${cardHTML(c, 'pending', c.uid !== uid && !rew[c.id] ? `<span class="cnt plus1">+${PACK_PER_VOTE}</span>` : '')}${capHTML(c)}${c.uid === uid ?
    `<div class="mine">あなたの作品<button class="linkbtn" data-del="${esc(c.id)}">${delArm === c.id ? 'もう一度押すと削除' : '削除'}</button></div>` :
    `<div class="vbtns">${ATTRS.map(a => `<button class="vb a-${a.k}" data-id="${esc(c.id)}" data-k="${a.k}" aria-pressed="${S.myVotes[c.id] === a.k}">${a.l}</button>`).join('')}</div>`}</div>`).join('')
    || (f.done ? '<p class="empty">まだ投稿がありません。右上の「＋つくる」から最初の1枚をどうぞ。</p>' : f.loading && !f.ids.length ? '<p class="empty">読み込み中…</p>' : '');
}
/* 並び順。選んでいる方をもう一度押すと、最新の状態で読み直す */
$('#voteSort').addEventListener('click', e => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  if (b.dataset.sort === S.sort) { if (!feed().loading) delete S.feeds[S.sort] }
  else { S.sort = b.dataset.sort; store.set('dp-sort', S.sort) }
  renderVote();
});
$('#voteMore').onclick = () => { feed().failed = false; more(); renderVote() };
function capHTML(c) {
  return `<div class="cap"><span>by ${c.anon ? '―' : esc(c.by)}</span></div>${c.baseNo ? `<div class="cap-base">元ネタ ${esc(c.baseNo)}</div>` : ''}`;
}
let delArm = null;
$('#voteGrid').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (d) {
    const id = d.dataset.del; if (delArm !== id) { delArm = id; renderVote(); return }
    delArm = null;
    try {
      await updateDoc(doc(db, 'themes', S.theme.id, 'cards', id), { deleted: true, px: EMPTY, name: '', text: '', by: '', updatedAt: serverTimestamp() });
      const c = S.cards.get(id); if (c) c.deleted = true; S.count = Math.max(0, S.count - 1);
      renderHeader(); renderVote(); toast('削除しました');
    }
    catch (err) { toast('削除できませんでした') }
    return;
  }
  const b = e.target.closest('.vb');
  if (b) {
    if (!S.user) return;
    const id = b.dataset.id, k = b.dataset.k;
    if (S.myVotes[id] === k) delete S.myVotes[id]; else S.myVotes[id] = k;
    saveLocalVotes(true);
    if (S.myVotes[id] && voteReward(id)) toast(`パック +${PACK_PER_VOTE}（あと ${packsLeft()} 回）`);
    voteDirty = true; clearTimeout(voteTimer); voteTimer = setTimeout(flushVotes, 3000);
    renderVote(); return;
  }
  if (e.target.closest('button')) return;
  const card = e.target.closest('.card[data-cid]'); if (card) openDetail(card.dataset.cid);
});
let flushing = null;
async function flushVotes() {
  while (flushing) await flushing;
  if (!voteDirty || !S.theme || !S.user) return;
  voteDirty = false; clearTimeout(voteTimer);
  const target = { ...S.myVotes }, tid = S.theme.id, uid = S.user.uid, google = isGoogle();
  flushing = (async () => {
    try {
      if (savedFor !== tid + '_' + uid) await readSavedVotes(tid, uid);
      try { await saveVotes(target, tid, uid, google) }
      catch (e) { await readSavedVotes(tid, uid); await saveVotes(target, tid, uid, google) }   // ほかの端末で票が変わっていたら、読み直してもう一度
      if (!voteDirty && S.user && S.user.uid === uid) saveLocalVotes(false);
    } catch (e) { voteDirty = true; console.warn('vote save failed', e) }
  })();
  try { await flushing } finally { flushing = null }
}
/* 入れた・取り消した作品は、票と同じまとめ書きでカードの票数（vc）を ±1 する。ルールが票と数の食い違いを止める */
async function saveVotes(target, tid, uid, google) {
  const cur = { ...savedVotes }, flips = [];
  for (const id of new Set([...Object.keys(cur), ...Object.keys(target)])) {
    if (!!cur[id] !== !!target[id]) flips.push(id);
    else if (target[id]) cur[id] = target[id];   // 系統を変えただけ（票数は動かない）
  }
  do {
    const chunk = flips.splice(0, 400), b = writeBatch(db);
    for (const id of chunk) {
      if (target[id]) cur[id] = target[id]; else delete cur[id];
      b.update(doc(db, 'themes', tid, 'cards', id), { vc: increment(target[id] ? 1 : -1) });
    }
    b.set(doc(db, 'votes', tid + '_' + uid), { uid, tid, google, v: { ...cur }, updatedAt: serverTimestamp() });
    await b.commit(); savedVotes = { ...cur }; savedFor = tid + '_' + uid;
  } while (flips.length);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushVotes() });
window.addEventListener('pagehide', flushVotes);

/* ---------- つくる（エディタ） ---------- */
const EMPTY = '0'.repeat(N * N);
const draft = store.get('dp-draft', null);
const ed = { px: EMPTY, p: 0, color: 1, tool: 'pen', hist: [], base: null };
const cv = $('#cv'), cx = cv.getContext('2d'), view = $('#cvView');
let CELL = cv.width / N, zoom = 1, cssSize = 0;
const ZOOMS = [1, 2, 3, 4];
const edColors = () => S.theme.palettes[ed.p].colors;
function saveDraft() { if (S.theme) store.set('dp-draft', { t: S.theme.id, px: ed.px, p: ed.p, base: ed.base, name: $('#fName').value, text: $('#fText').value }) }
let draftLoaded = false;
function openMake() {
  if (!S.theme) { $('#makeBody').hidden = true; $('#makeClosed').hidden = false; return }
  $('#makeBody').hidden = false; $('#makeClosed').hidden = true;
  if (!draftLoaded) {
    draftLoaded = true;
    if (draft && draft.t === S.theme.id) { ed.px = draft.px; ed.p = draft.p || 0; ed.base = draft.base || null; $('#fName').value = draft.name || ''; $('#fText').value = draft.text || '' }
    $('#fBy').value = store.get('dp-name', '');
  }
  renderBase(); renderPals(); renderPal(); renderTools(); layoutCanvas(); renderPreview();
}
function layoutCanvas() {
  const base = view.getBoundingClientRect().width - 4; if (base <= 0) return;
  const fx = cssSize ? (view.scrollLeft + view.clientWidth / 2) / cssSize : .5, fy = cssSize ? (view.scrollTop + view.clientHeight / 2) / cssSize : .5;
  cssSize = Math.floor(base * zoom);
  cv.style.width = cv.style.height = cssSize + 'px';
  const dpr = window.devicePixelRatio || 1;
  const px = Math.max(N, Math.min(4096, Math.round(cssSize * dpr / N) * N));
  cv.width = cv.height = px; CELL = px / N;
  view.scrollLeft = fx * cssSize - view.clientWidth / 2; view.scrollTop = fy * cssSize - view.clientHeight / 2;
  $('#zLbl').textContent = '×' + zoom;
  drawEditor();
}
function setZoom(d) { const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + d)); zoom = ZOOMS[i]; layoutCanvas() }
$('#zIn').onclick = () => setZoom(1); $('#zOut').onclick = () => setZoom(-1);
window.addEventListener('resize', () => { if (S.tab === 'make' && S.theme) layoutCanvas() });
function drawEditor() {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--art-bg').trim(), ck = cs.getPropertyValue('--check').trim(), cols = edColors();
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = i / N | 0, v = parseInt(ed.px[i], 16);
    cx.fillStyle = v ? cols[v - 1] : (((x >> 1) + (y >> 1)) % 2 ? ck : bg); cx.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  const lw = Math.max(1, Math.round(window.devicePixelRatio || 1));
  for (let k = 1; k < N; k++) {
    cx.fillStyle = k === N / 2 ? 'rgba(128,128,128,.55)' : k % 8 === 0 ? 'rgba(128,128,128,.35)' : 'rgba(128,128,128,.16)';
    const p = k * CELL; cx.fillRect(p, 0, lw, cv.height); cx.fillRect(0, p, cv.width, lw);
  }
}
function setPx(i, v) { ed.px = ed.px.slice(0, i) + v.toString(16) + ed.px.slice(i + 1) }
function flood(i, v) {
  const arr = ed.px.split(''), from = arr[i], to = v.toString(16); if (from === to) return;
  const st = [i]; while (st.length) {
    const p = st.pop(); if (arr[p] !== from) continue; arr[p] = to; const x = p % N, y = p / N | 0;
    if (x > 0) st.push(p - 1); if (x < N - 1) st.push(p + 1); if (y > 0) st.push(p - N); if (y < N - 1) st.push(p + N)
  }
  ed.px = arr.join('');
}
function cellAt(e) { const r = cv.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * N), y = Math.floor((e.clientY - r.top) / r.height * N); return (x < 0 || y < 0 || x >= N || y >= N) ? -1 : y * N + x }
const ptrs = new Map(); let mode = null, stroke = false, lastCell = -1, shiftFrom = null;
function rawCell(e) { const r = cv.getBoundingClientRect(); return { x: Math.floor((e.clientX - r.left) / r.width * N), y: Math.floor((e.clientY - r.top) / r.height * N) } }
function shifted(px, dx, dy) {
  if (!dx && !dy) return px; let o = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const sx = x - dx, sy = y - dy; o += (sx < 0 || sy < 0 || sx >= N || sy >= N) ? '0' : px[sy * N + sx] }
  return o;
}
function line(a, b, v) {
  let x0 = a % N, y0 = a / N | 0; const x1 = b % N, y1 = b / N | 0, dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (; ;) { setPx(y0 * N + x0, v); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx } if (e2 <= dx) { err += dx; y0 += sy } }
}
function paint(e) {
  const i = cellAt(e); if (i < 0) return; const v = ed.tool === 'erase' ? 0 : ed.color;
  if (ed.tool === 'fill') flood(i, v); else if (lastCell >= 0) line(lastCell, i, v); else setPx(i, v);
  lastCell = i; drawEditor();
}
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { if (stroke) { ed.px = ed.hist.pop(); stroke = false; drawEditor() } mode = 'pan'; return }
  if (ptrs.size > 2) return;
  if (ed.tool === 'move') { ed.hist.push(ed.px); if (ed.hist.length > 50) ed.hist.shift(); stroke = true; mode = 'shift'; shiftFrom = { px: ed.px, ...rawCell(e) }; return }
  ed.hist.push(ed.px); if (ed.hist.length > 50) ed.hist.shift(); stroke = true; lastCell = -1;
  mode = ed.tool === 'fill' ? null : 'draw'; paint(e);
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  if (mode === 'pan') { view.scrollLeft -= (e.clientX - p.x) / ptrs.size; view.scrollTop -= (e.clientY - p.y) / ptrs.size }
  else if (mode === 'draw') paint(e);
  else if (mode === 'shift') { const c = rawCell(e), px = shifted(shiftFrom.px, c.x - shiftFrom.x, c.y - shiftFrom.y); if (px !== ed.px) { ed.px = px; drawEditor() } }
  p.x = e.clientX; p.y = e.clientY;
});
const endDraw = e => {
  ptrs.delete(e.pointerId); if (ptrs.size) return;
  if (stroke) { if (ed.px === ed.hist[ed.hist.length - 1]) ed.hist.pop(); else { saveDraft(); renderPreview() } }
  mode = null; stroke = false; lastCell = -1;
};
cv.addEventListener('pointerup', endDraw); cv.addEventListener('pointercancel', endDraw);
function renderTools() { document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === ed.tool)); view.classList.toggle('moving', ed.tool === 'move') }
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { ed.tool = b.dataset.tool; renderTools() });
$('#undo').onclick = () => { if (ed.hist.length) { ed.px = ed.hist.pop(); drawEditor(); saveDraft(); renderPreview() } };
$('#clear').onclick = () => { ed.hist.push(ed.px); ed.px = EMPTY; drawEditor(); saveDraft(); renderPreview() };
function renderPals() {
  $('#pals').innerHTML = S.theme.palettes.map((p, i) => `<button class="palbtn" data-p="${i}" aria-pressed="${i === ed.p}">${esc(p.name)}<span class="strip">${p.colors.map(c => `<i style="background:${c}"></i>`).join('')}</span></button>`).join('');
}
$('#pals').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; ed.p = +b.dataset.p; renderPals(); renderPal(); drawEditor(); saveDraft(); renderPreview() });
const pal = $('#pal');
function renderPal() { pal.innerHTML = edColors().map((c, k) => `<button class="sw" data-c="${k + 1}" style="background:${c}" aria-label="色${k + 1}" aria-pressed="${k + 1 === ed.color}"></button>`).join('') }
pal.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; ed.color = +b.dataset.c; if (ed.tool === 'erase' || ed.tool === 'move') ed.tool = 'pen'; renderPal(); renderTools() });
function renderBase() {
  const c = ed.base; $('#baseBox').hidden = !c; if (!c) return;
  $('#baseImg').src = artURL(c); $('#baseName').textContent = c.name; $('#baseNo').textContent = fmtNo(c) + '　by ' + c.by;
}
$('#baseClear').onclick = () => { ed.base = null; saveDraft(); renderBase(); renderPreview() };
function renderPreview() {
  $('#nameCnt').textContent = `${nameW($('#fName').value)}/${NAME_MAX}`;
  const pc = { id: '_p', name: $('#fName').value, text: $('#fText').value, px: ed.px, _colors: edColors(), fan: $('#fFan').checked };
  $('#preview').innerHTML = cardHTML(pc, 'pending');
}
{
  const el = $('#fName');
  const clip = () => { const v = el.value, c = clipW(v, NAME_MAX); if (c !== v) el.value = c };
  el.addEventListener('input', e => { if (!e.isComposing) clip(); saveDraft(); renderPreview() });
  el.addEventListener('compositionend', () => { clip(); saveDraft(); renderPreview() });
}
$('#fText').oninput = () => { saveDraft(); renderPreview() };
$('#fFan').onchange = renderPreview;
$('#fBy').oninput = () => store.set('dp-name', $('#fBy').value.trim().slice(0, 12));

let posting = false;
$('#submit').onclick = async () => {
  if (posting || !S.theme || !S.user) return;
  const name = clipW($('#fName').value.trim(), NAME_MAX), text = $('#fText').value.trim().slice(0, TEXT_MAX);
  const filled = [...ed.px].filter(c => c !== '0').length;
  const err = m => { $('#mkErr').textContent = m };
  if (filled < 30) return err('もう少し描いてから投稿してください（30マス以上）');
  if (!name) return err('名前を入れてください');
  err(''); posting = true; $('#submit').disabled = true;
  const by = authorName().slice(0, 12);
  try {
    const tRef = doc(db, 'themes', S.theme.id), cRef = doc(collection(db, 'themes', S.theme.id, 'cards'));
    await runTransaction(db, async tx => {
      const t = await tx.get(tRef);
      if (!t.exists() || t.data().status !== 'open') throw new Error('closed');
      const seq = (t.data().seq || 0) + 1;
      tx.update(tRef, { seq });
      tx.set(cRef, {
        uid: S.user.uid, tid: S.theme.id, tno: t.data().no, no: seq, by, name, text, p: ed.p, px: ed.px,
        fan: $('#fFan').checked, base: ed.base ? ed.base.id : null, baseNo: ed.base ? fmtNo(ed.base) : null,
        hidden: false, deleted: false, anon: false, vc: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    });
    ed.px = EMPTY; ed.hist = []; ed.base = null; $('#fName').value = ''; $('#fText').value = ''; $('#fFan').checked = false; saveDraft();
    /* 投稿した1枚だけ読んで、新着順の先頭に足す */
    try { const nd = await getDoc(cRef); if (nd.exists()) { S.cards.set(nd.id, toCard(nd)); const fn = S.feeds.new; if (fn && !fn.ids.includes(nd.id)) fn.ids.unshift(nd.id) } } catch (e2) { }
    S.count++; S.sort = 'new'; store.set('dp-sort', 'new');
    renderHeader(); setTab('vote'); window.scrollTo(0, 0); toast('投稿しました');
  } catch (e) {
    console.warn(e); err(e.message === 'closed' ? 'いまは投稿を受け付けていません' : '投稿できませんでした。時間をおいてもう一度お試しください');
  } finally { posting = false; $('#submit').disabled = false }
};

/* ---------- パックを開ける回数 ----------
   時間でたまる分（n：PACK_MAX まで、t：最後に数えた時刻）と、投票でもらった分（b：上限なし）。端末に保存 */
const HOUR = 36e5, CHARGE = PACK_CHARGE_HOURS * HOUR;
const charge = store.get('dp-charge', { n: PACK_MAX, t: Date.now(), b: 0 });
const rew = store.get('dp-rew', {});   // 投票で回数をもらった作品 id -> 1
function saveCharge() { store.set('dp-charge', charge); store.set('dp-rew', rew); saveOwned() }
function tick() {
  const now = Date.now();
  if (charge.n >= PACK_MAX) { charge.t = now; return }
  const k = Math.floor((now - charge.t) / CHARGE); if (k <= 0) return;
  charge.n = Math.min(PACK_MAX, charge.n + k); charge.t = charge.n >= PACK_MAX ? now : charge.t + k * CHARGE;
  store.set('dp-charge', charge);   // 時間で戻った分はサーバーに送らなくても、どの端末でも同じ計算になる
}
const packsLeft = () => { tick(); return charge.n + charge.b };
function usePack() {
  tick(); if (charge.n > 0) charge.n--; else if (charge.b > 0) charge.b--; else return false;
  saveCharge(); return true;
}
/* 同じ作品への投票でもらえるのは1回だけ（取り消して入れ直してもふえない） */
function voteReward(id) {
  if (rew[id]) return false;
  rew[id] = 1; charge.b += PACK_PER_VOTE; saveCharge(); return true;
}
function chargeText() {
  const left = packsLeft();
  if (charge.n >= PACK_MAX) return `あと <b>${left}</b> 回開けられます`;
  const m = Math.max(1, Math.ceil((charge.t + CHARGE - Date.now()) / 6e4));
  return `あと <b>${left}</b> 回開けられます ・ 次の1回まで ${m >= 60 ? Math.floor(m / 60) + '時間' : ''}${m % 60 ? m % 60 + '分' : ''}`;
}
function renderCharge() {
  const left = packsLeft();
  $('#packCharge').innerHTML = chargeText() + '<br><small>ほかの人の作品に投票すると1回ふえます</small>';
  document.querySelectorAll('[data-open]').forEach(b => b.disabled = !left);
  $('#again').disabled = !left;
}
setInterval(() => { if (S.tab === 'packs' || !$('#ov').hidden) renderCharge() }, 30000);

/* ---------- パック ---------- */
function renderPacks() {
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
$('#closeOv').onclick = () => { $('#ov').hidden = true; document.body.style.overflow = ''; renderPacks(); if (S.tab === 'dex') renderDex() };

/* 集めたカードと開ける回数：端末に保存。Google連携していればサーバーにも（まとめて保存） */
let ownedTimer = null;
function saveOwned() {
  store.set('dp-owned', S.owned);
  if (!isGoogle()) return;
  clearTimeout(ownedTimer); ownedTimer = setTimeout(pushUser, 2000);
}
function pushUser() {
  clearTimeout(ownedTimer); ownedTimer = null;
  if (!isGoogle()) return Promise.resolve();
  return setDoc(doc(db, 'users', S.user.uid), { name: store.get('dp-name', ''), owned: S.owned, charge: { n: charge.n, t: charge.t, b: charge.b }, rew, updatedAt: serverTimestamp() }).catch(e => console.warn(e));
}
addEventListener('pagehide', () => { if (ownedTimer) pushUser() });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ownedTimer) pushUser() });
async function mergeOwnedFromServer() {
  if (!isGoogle()) return;
  try {
    const d = await getDoc(doc(db, 'users', S.user.uid));
    if (d.exists()) {
      const srv = d.data().owned || {};
      for (const [k, v] of Object.entries(srv)) S.owned[k] = Math.max(S.owned[k] || 0, v);
      if (!store.get('dp-name', '') && d.data().name) store.set('dp-name', d.data().name);
      /* 開ける回数はサーバーの方を使う。この端末だけで投票してもらった分は足す */
      const sc = d.data().charge, sr = d.data().rew || {};
      if (sc) {
        const extra = Object.keys(rew).filter(id => !sr[id]).length * PACK_PER_VOTE;
        Object.assign(charge, { n: sc.n, t: sc.t, b: sc.b + extra });
      }
      Object.assign(rew, sr); store.set('dp-charge', charge); store.set('dp-rew', rew);
    }
    saveOwned();
  } catch (e) { console.warn(e) }
}

/* ---------- 図鑑 ---------- */
let dexSel = null;
async function renderDex() {
  if (!S.packIndex.length) { $('#dexChips').innerHTML = ''; $('#dexProg').textContent = ''; $('#dexGrid').innerHTML = '<p class="empty">まだパックがありません。</p>'; return }
  if (!dexSel || !S.packIndex.find(p => p.no === dexSel)) dexSel = S.packIndex[0].no;
  $('#dexChips').innerHTML = S.packIndex.map(p => `<button class="chip" data-no="${p.no}" aria-pressed="${p.no === dexSel}">${esc(p.name)}</button>`).join('');
  let p; try { p = await loadPack(dexSel) } catch (e) { $('#dexGrid').innerHTML = '<p class="empty">読み込めませんでした。</p>'; return }
  const ak = Object.fromEntries(ATTRS.map((a, i) => [a.k, i]));
  const cards = p.cards.slice().sort((a, b) => (ak[a.attr] ?? 9) - (ak[b.attr] ?? 9) || b.star - a.star || a.no - b.no);
  $('#dexProg').innerHTML = `${cards.filter(c => S.owned[c.id]).length} / ${cards.length}<small>${esc(p.name)}</small>`;
  $('#dexGrid').innerHTML = cards.map(c => S.owned[c.id] ? `<div class="cw">${cardHTML(c, 'full', `<span class="cnt">×${S.owned[c.id]}</span>`)}${capHTML(c)}</div>` : `<div class="cw">${cardHTML(c, 'sil')}</div>`).join('');
}
$('#dexChips').addEventListener('click', e => { const b = e.target.closest('[data-no]'); if (b) { dexSel = +b.dataset.no; renderDex() } });
$('#dexGrid').addEventListener('click', e => { const card = e.target.closest('.card[data-cid]'); if (card) openDetail(card.dataset.cid) });

/* ---------- 作品画面 ---------- */
let dtCard = null;
function openDetail(id) {
  const c = cardById(id); if (!c) return; dtCard = c;
  const packName = S.theme && c.tid === S.theme.id ? S.theme.name : (S.packIndex.find(p => p.tid === c.tid) || {}).name || '';
  $('#dtCard').innerHTML = cardHTML(c, c.star ? 'full' : 'pending', '', 3);
  const rows = [['パック', esc(packName)], ['作品番号', fmtNo(c)], ['作者', c.anon ? '―' : esc(c.by)]];
  if (c.star) rows.push(['系統・星', `${c.attr ? ATTR_L[c.attr] : '—'} ・ ${'★'.repeat(c.star)}`]);
  if (c.fan) rows.push(['収録', 'パック対象外']);
  let needBase = false;
  if (c.baseNo) {
    const bc = c.base ? cardById(c.base) : null; needBase = !!c.base && !bc;
    rows.push(['元ネタ', visible(bc) ? `<button class="linkbtn" data-goto="${esc(bc.id)}">${esc(c.baseNo)} ${esc(bc.name)}</button>` : esc(c.baseNo)]);
  }
  $('#dtInfo').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#dtMake').hidden = !S.theme;
  $('#dt').hidden = false; document.body.style.overflow = 'hidden'; $('#dt').scrollTop = 0;
  // 元ネタのカードがまだ読み込まれていなければ、その1枚だけ読んで表示し直す
  if (needBase) fetchBase(c).then(b => { if (b && dtCard === c && !$('#dt').hidden) openDetail(c.id) }).catch(() => { });
}
async function fetchBase(c) {
  const n = parseNo(c.baseNo); if (!n) return null;
  if (S.theme && n.tno === S.theme.no) {
    const d = await getDoc(doc(cardsCol(), c.base)); if (!d.exists()) return null;
    const b = toCard(d); S.cards.set(b.id, b); return visible(b) ? b : null;
  }
  if (S.packIndex.find(p => p.no === n.tno)) { const p = await loadPack(n.tno); return p.cards.find(x => x.id === c.base) || null }
  return null;
}
function closeDetail() { $('#dt').hidden = true; document.body.style.overflow = '' }
$('#dtInfo').addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) openDetail(b.dataset.goto) });
$('#dtClose').onclick = closeDetail;
$('#dt').addEventListener('click', e => { if (e.target === $('#dt')) closeDetail() });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#dt').hidden) closeDetail() });
$('#dtMake').onclick = () => {
  const c = dtCard; ed.base = { id: c.id, tid: c.tid, tno: c.tno, no: c.no, name: c.name, by: c.anon ? '―' : c.by, px: c.px, p: c.p };
  saveDraft(); closeDetail(); setTab('make'); window.scrollTo(0, 0); toast('元にする作品を設定しました');
};

/* ---------- お問い合わせ ---------- */
const REASONS = {
  del: [['own', '自分の作品を消したい（投稿した本人）'], ['rights', '自分の作品や、権利を持つキャラクターが無断で使われている'], ['copy', '他人の作品のトレース・転載に見える'], ['nsfw', '性的・暴力的・差別的な内容'], ['abuse', '誹謗中傷や個人情報が含まれている'], ['spam', 'テーマと関係ない・荒らし']],
  hide: [['quit', '名前を出したくなくなった'], ['trouble', 'トラブルを避けたい'], ['other', 'その他']],
};
const cType = () => document.querySelector('input[name="ctype"]:checked').value;
let cFound = null, cSeq = 0;
async function findNo(v) {
  const n = parseNo(v); if (!n) return null;
  if (S.theme && n.tno === S.theme.no) {
    const hit = [...S.cards.values()].find(c => c.no === n.no);
    if (hit) return visible(hit) ? hit : null;
    try {
      const snap = await getDocs(query(cardsCol(), where('no', '==', n.no), limit(1))); if (snap.empty) return null;
      const c = toCard(snap.docs[0]); S.cards.set(c.id, c); return visible(c) ? c : null;
    } catch (e) { return null }
  }
  if (!S.packIndex.find(p => p.no === n.tno)) return null;
  try { const p = await loadPack(n.tno); return p.cards.find(c => c.no === n.no) || null } catch (e) { return null }
}
async function renderContact() {
  const t = cType();
  $('#cWork').hidden = t === 'ad'; $('#cAd').hidden = t !== 'ad';
  if (t !== 'ad') {
    if ($('#cReason').dataset.t !== t) { $('#cReason').innerHTML = '<option value="">選んでください</option>' + REASONS[t].map(([k, l]) => `<option value="${k}">${l}</option>`).join(''); $('#cReason').dataset.t = t }
    const my = ++cSeq; const c = await findNo($('#cNo').value); if (my !== cSeq) return;
    cFound = c; $('#cCard').innerHTML = c ? cardHTML(c, c.star ? 'full' : 'pending') + capHTML(c) : '';
  }
  $('#cErr').textContent = '';
}
function openContact(t) { $('#ct-' + (t || 'del')).checked = true; $('#cForm').hidden = false; $('#cDone').hidden = true; openPage('contact'); renderContact() }
document.querySelectorAll('input[name="ctype"]').forEach(r => r.onchange = renderContact);
$('#cNo').oninput = renderContact;
let lastCType = 'del';
$('#cForm').addEventListener('submit', async e => {
  e.preventDefault(); const t = cType(); const err = m => { $('#cErr').textContent = m };
  if (!S.user) return err('接続できていません。時間をおいてもう一度お試しください');
  let req = { type: t, uid: S.user.uid, at: serverTimestamp(), done: false };
  if (t === 'ad') {
    const name = $('#cName').value.trim(), mail = $('#cMail').value.trim(), body = $('#cBody').value.trim();
    if (!name) return err('お名前・会社名を入れてください');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return err('メールアドレスの形が正しくありません');
    if (!body) return err('ご依頼の内容を入れてください');
    Object.assign(req, { name: name.slice(0, 60), mail: mail.slice(0, 120), body: body.slice(0, 300) });
  } else {
    const c = cFound;
    if (!c) return err('その作品番号のカードが見つかりません');
    if (!$('#cReason').value) return err('理由を選んでください');
    if (t === 'hide' && c.uid && c.uid !== S.user.uid) return err('作者名の非表示は、その作品を投稿したアカウントからのみ依頼できます');
    Object.assign(req, { tid: c.tid, cid: c.id, no: fmtNo(c), reason: $('#cReason').value });
  }
  try { await addDoc(collection(db, 'requests'), req) }
  catch (e2) { return err(t === 'hide' ? '送信できませんでした。作者名の非表示は、その作品を投稿したアカウントからのみ依頼できます' : '送信できませんでした。時間をおいてもう一度お試しください') }
  lastCType = t;
  $('#cDoneMsg').textContent = t === 'ad' ? '送信しました。内容を確認して、メールでご連絡します。' : `送信しました（${req.no}）。運営者が確認して対応します。個別の返信はありません。`;
  $('#cForm').reset(); $('#cForm').hidden = true; $('#cDone').hidden = false;
});
$('#cAgain').onclick = () => openContact(lastCType);

/* ---------- アカウント ---------- */
function renderAccount() {
  $('#aName').value = store.get('dp-name', '');
  const g = isGoogle();
  $('#aStatus').textContent = g ? `Googleアカウント（${S.user.email || ''}）と連携しています。集めたカードはどの端末でも見られます。` : 'まだGoogleアカウントと連携していません。いまのデータはこの端末のブラウザにだけ保存されています。';
  $('#aGoogle').hidden = g; $('#aLogout').hidden = !g;
}
$('#aName').oninput = () => { store.set('dp-name', $('#aName').value.trim().slice(0, 12)); $('#fBy').value = store.get('dp-name', ''); if (isGoogle()) saveOwned() };
$('#aGoogle').onclick = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await linkWithPopup(auth.currentUser, provider);
  } catch (e) {
    if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
      // このGoogleアカウントは別の端末ですでに使われている → そちらに切り替える
      const cred = GoogleAuthProvider.credentialFromError(e);
      if (!cred) { toast('連携できませんでした'); return }
      /* いまの匿名アカウントの票は空にして、切り替え先へ持っていく（同じ人の票が2回数えられないように） */
      await flushVotes();
      if (S.theme && Object.keys(S.myVotes).length) {
        carryVotes = { ...S.myVotes }; S.myVotes = {}; saveLocalVotes(true);
        voteDirty = true; await flushVotes();
        if (voteDirty) { S.myVotes = carryVotes; carryVotes = null; saveLocalVotes(true); toast('連携できませんでした。時間をおいてもう一度お試しください'); return }
      }
      try { await signInWithCredential(auth, cred) }
      catch (e2) {
        console.warn(e2);
        if (carryVotes) { S.myVotes = carryVotes; carryVotes = null; saveLocalVotes(true); voteDirty = true; flushVotes() }
        toast('連携できませんでした'); return;
      }
      // 読み込み直し（カード・票・集めたカード）は onAuthStateChanged がアカウントの切り替えを見て行う
      toast('Googleアカウントに切り替えました'); return;
    } else if (e.code !== 'auth/popup-closed-by-user') { console.warn(e); toast('連携できませんでした'); return }
    else return;
  }
  await auth.currentUser.getIdToken(true);
  S.user = auth.currentUser;
  await mergeOwnedFromServer();
  voteDirty = true; await flushVotes();
  renderAccount(); toast('Googleアカウントと連携しました');
};
$('#aLogout').onclick = async () => {
  await flushVotes(); if (ownedTimer) await pushUser();
  await signOut(auth);
  /* 集めたカードはGoogleアカウントの方に残っている。この端末の控えは消して、次に使う人のデータと混ざらないようにする */
  S.owned = {}; store.set('dp-owned', {});
  toast('ログアウトしました');
};

/* ---------- 起動 ---------- */
let shown = false;
async function start() {
  if (!CONFIGURED) { $('#voteGrid').innerHTML = '<p class="empty">js/config.js に Firebase の設定を書いてください。</p>'; return }
  /* テーマとカードはだれでも読めるので、ログインを待たずに読み始める */
  const ready = Promise.all([loadTheme(), loadPackIndex()])
    .catch(e => { console.warn(e); toast('読み込みに失敗しました') })
    .then(() => { shown = true; renderHeader(); setTab(MAIN.includes(S.tab) ? S.tab : 'vote'); countCards().then(renderHeader) });
  let firstUser = true;
  onAuthStateChanged(auth, async u => {
    if (!u) { try { await signInAnonymously(auth) } catch (e) { toast('接続できませんでした') } return }
    const changed = !S.user || S.user.uid !== u.uid; S.user = u;
    if (!changed) return;
    await ready;
    if (!firstUser) resetCards();
    firstUser = false;
    try { await Promise.all([loadMyVotes(), mergeOwnedFromServer()]) } catch (e) { console.warn(e) }
    setTab(S.tab);
  });
  loadCardFont().then(() => { clearCardCache(); if (shown) setTab(S.tab) });
}
renderHeader();
$('#voteGrid').innerHTML = '<p class="empty">読み込み中…</p>';
start();
