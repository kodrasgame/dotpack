/* ドットパック 公開ページの共通部分（どのページでも使う状態・読み込み・票・パックの回数・集めたカード） */
import {
  auth, db, CONFIGURED, MOCK, onAuthStateChanged, signInAnonymously,
  doc, getDoc, getDocs, setDoc, collection, query, where, limit, serverTimestamp, writeBatch, increment, getCountFromServer
} from './fb.js';
import { $, esc, N, fmtNo, PALETTES, LEGACY, B64, artColors, clearCardCache, loadCardFont, logoInfo } from './cards.js';
import { PACK_CHARGE_HOURS, PACK_MAX, PACK_PER_VOTE } from './config.js';

/* サイトのいちばん上（dotpack/）の場所。ページのリンクやファイルの読み込みに使う */
export const ROOT = new URL('../', import.meta.url).href;
export const go = path => { location.href = ROOT + path };

/* ---------- 小さな道具 ---------- */
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } },
};
/* ページを移っても少しのあいだ覚えておく控え（読み取り回数の節約）。タブを閉じると消える */
export const memo = {
  get(k, maxAge) { if (MOCK) return null; try { const v = JSON.parse(sessionStorage.getItem(k)); return v && Date.now() - v.at < maxAge ? v.v : null } catch (e) { return null } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify({ at: Date.now(), v })) } catch (e) { } },
  del(k) { try { sessionStorage.removeItem(k) } catch (e) { } },
};
export const forgetCount = () => memo.del('dp-count');
export const forgetFeed = () => memo.del('dp-feed');   // 投票一覧の控え（vote.js）
let toastT;
export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200) }
/* 次のページを開いたときに出すお知らせ */
export function toastNext(msg) { try { sessionStorage.setItem('dp-toast', msg) } catch (e) { } }
export const ms = v => v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0);

/* ---------- 状態 ---------- */
export const S = {
  user: null,
  theme: null,          // 受付中のテーマ { id, no, name, month, palettes, seq }
  cards: new Map(),     // 読み込んだ受付中のカード id -> card
  count: null,          // 受付中のカードの枚数（削除・非表示を除く）
  myVotes: {},          // cardId -> 系統
  packIndex: [],        // 締め切ったパックの一覧（packs/index.json）
  packs: new Map(),     // パック番号 -> パックの中身
  owned: store.get('dp-owned', {}),
};
export const isGoogle = () => !!(S.user && S.user.providerData.some(p => p.providerId === 'google.com'));
export const authorName = () => store.get('dp-name', '') || 'ななしさん';
export const visible = c => !!c && !c.deleted && !c.hidden;
export function capHTML(c) {
  return `<div class="cap"><span>by ${authorHTML(c)}</span></div>${c.baseNo ? `<div class="cap-base">元ネタ ${esc(c.baseNo)}</div>` : ''}`;
}

/* カード1枚ごとのページ（card/?no=0012-2） */
/* 作者ページへのリンク（作者名を非表示にしたカードは「―」だけ） */
export const authorHTML = c => c.anon || !c.by ? '―' : c.uid ? `<a class="linkbtn" href="${ROOT}author/?u=${encodeURIComponent(c.uid)}">${esc(c.by)}</a>` : esc(c.by);
export const cardPath = c => 'card/?no=' + fmtNo(c).slice(3);
/* 「これを元に作る」：描きかけの下書きに元ネタだけ書き足して、つくるページへ */
export function makeFrom(c) {
  const base = { id: c.id, tid: c.tid, tno: c.tno, no: c.no, name: c.name, by: c.anon ? '―' : c.by, art: c.art || null, px: c.px || null, p: c.p ?? null };
  const d = store.get('dp-draft', null), colors = artColors(c);
  /* 描きかけの絵がなければ、パレットを元ネタと同じ色にする（描きかけがあれば、その絵の色を変えないようにそのまま） */
  const blank = !d || d.t !== S.theme.id || d.v !== 2 || !/[^A]/.test(d.px || '');
  store.set('dp-draft', blank ? { t: S.theme.id, v: 2, px: B64[0].repeat(N * N), colors, base, name: d && d.t === S.theme.id ? d.name || '' : '', text: d && d.t === S.theme.id ? d.text || '' : '' } : { ...d, base });
  toastNext('元にする作品を設定しました'); go('make/');
}

/* ---------- ヘッダー ---------- */
export function monthLabel(m) { return m ? Number(m.split('-')[1]) + '月' : '' }
export function renderHeader() {
  const th = S.theme;
  if (!th) { $('#thLbl').textContent = ''; $('#thName').textContent = 'ドットパック'; $('#thMeta').textContent = S.loaded ? '次のテーマを準備中です' : ''; return }
  $('#thLbl').textContent = monthLabel(th.month) + 'のテーマ';
  const lg = th.logo && logoInfo(th.logo);   // テーマのロゴがあれば名前のかわりに出す
  $('#thName').innerHTML = lg ? `<img class="theme-logo" src="${lg.url}" width="${lg.w * 2}" height="${lg.h * 2}" alt="${esc(th.name)}">` : esc(th.name);
  const [y, m] = th.month.split('-').map(Number);
  const left = Math.max(0, Math.ceil((new Date(y, m, 1) - new Date()) / 864e5));
  $('#thMeta').innerHTML = `投稿・投票 受付中<br>のこり <b>${left}</b> 日 ・ <b>${esc(S.count ?? '…')}</b> 枚`;
}

/* ---------- 読み込み ---------- */
const MIN = 6e4;
async function loadTheme() {
  const c = memo.get('dp-theme', 10 * MIN);
  if (c) S.theme = c.theme;
  else {
    const snap = await getDocs(query(collection(db, 'themes'), where('status', '==', 'open'), limit(1)));
    S.theme = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    memo.set('dp-theme', { theme: S.theme });
  }
  if (S.theme) { PALETTES[S.theme.id] = S.theme.palettes; if (S.theme.legacyPalettes) LEGACY[S.theme.id] = S.theme.legacyPalettes }
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
export const cardsCol = () => collection(db, 'themes', S.theme.id, 'cards');
export const toCard = d => { const v = d.data(); return { ...v, id: d.id, createdAt: ms(v.createdAt), updatedAt: ms(v.updatedAt) } };
/* 枚数だけを数える（1000枚ごとに読み取り1回ぶん） */
async function countCards() {
  if (!S.theme) return;
  const c = memo.get('dp-count', 5 * MIN);
  if (c && c.tid === S.theme.id) { S.count = c.n; return }
  try { const r = await getCountFromServer(query(cardsCol(), where('deleted', '==', false), where('hidden', '==', false))); S.count = r.data().count; memo.set('dp-count', { tid: S.theme.id, n: S.count }) }
  catch (e) { console.warn(e); S.count = S.theme.seq || 0 }
}
async function loadPackIndex() {
  const mp = MOCK ? store.get('mock-packs', null) : null;
  if (mp) S.packIndex = mp.index.slice();
  else try { const r = await fetch(ROOT + 'packs/index.json', { cache: 'no-cache' }); S.packIndex = r.ok ? await r.json() : [] } catch (e) { S.packIndex = [] }
  S.packIndex.sort((a, b) => b.no - a.no);
  for (const p of S.packIndex) PALETTES[p.tid] = p.palettes;
}
/* 同じパックを同時に何度も頼まれても、読み込みは1回だけにする */
const packLoading = new Map();
export function loadPack(no) {
  if (S.packs.has(no)) return Promise.resolve(S.packs.get(no));
  if (!packLoading.has(no)) packLoading.set(no, fetchPack(no).finally(() => packLoading.delete(no)));
  return packLoading.get(no);
}
async function fetchPack(no) {
  const mp = MOCK ? store.get('mock-packs', null) : null;
  let p;
  if (mp && mp.packs[no]) p = mp.packs[no];
  else { const r = await fetch(`${ROOT}packs/${String(no).padStart(4, '0')}.json`, { cache: 'no-cache' }); if (!r.ok) throw new Error('pack'); p = await r.json() }
  PALETTES[p.tid] = p.palettes;
  p.cards.forEach(c => { c.tid = p.tid; c.tno = p.no });
  S.packs.set(no, p); return p;
}
export function cardById(id) {
  if (S.cards.has(id)) return S.cards.get(id);
  for (const p of S.packs.values()) { const c = p.cards.find(c => c.id === id); if (c) return c }
  return null;
}

/* ---------- 票（まとめて保存） ----------
   画面の票（S.myVotes）と、サーバーに保存済みの票（savedVotes）の差だけ書く */
export const V = { dirty: false, carry: null, timer: null };   // carry：別のアカウントに切り替えたときに持っていく票
let savedVotes = {}, savedFor = '';
const voteKey = () => 'dp-votes-' + S.theme.id + '-' + S.user.uid;   // 端末に保存する票はアカウントごと
async function readSavedVotes(tid, uid) {
  const d = await getDoc(doc(db, 'votes', tid + '_' + uid));
  savedVotes = d.exists() ? (d.data().v || {}) : {}; savedFor = tid + '_' + uid;
}
export const saveLocalVotes = dirty => store.set(voteKey(), { v: S.myVotes, dirty });
async function loadMyVotes(need) {
  if (!S.theme || !S.user) { V.carry = null; return }
  const local = store.get(voteKey(), null);
  const pending = local && local.dirty && local.v;
  if (!need && !pending && !V.carry) return;   // 票を使わないページでは、保存し残しがあるときだけ読む
  try { await readSavedVotes(S.theme.id, S.user.uid) } catch (e) { savedVotes = {}; savedFor = '' }
  // 保存しきれなかった票が端末に残っていれば、それを使って保存し直す
  if (pending) { S.myVotes = local.v; V.dirty = true } else S.myVotes = { ...savedVotes };
  if (V.carry) {
    // 切り替え先ですでに入れていた票はそのまま、まだ入れていない作品の分だけ足す
    S.myVotes = { ...V.carry, ...S.myVotes }; V.carry = null; V.dirty = true;
  }
  if (V.dirty) { saveLocalVotes(true); await flushVotes() }
}
let flushing = null;
export async function flushVotes() {
  while (flushing) await flushing;
  if (!V.dirty || !S.theme || !S.user) return;
  V.dirty = false; clearTimeout(V.timer);
  const target = { ...S.myVotes }, tid = S.theme.id, uid = S.user.uid, google = isGoogle();
  flushing = (async () => {
    try {
      if (savedFor !== tid + '_' + uid) await readSavedVotes(tid, uid);
      try { await saveVotes(target, tid, uid, google) }
      catch (e) { await readSavedVotes(tid, uid); await saveVotes(target, tid, uid, google) }   // ほかの端末で票が変わっていたら、読み直してもう一度
      if (!V.dirty && S.user && S.user.uid === uid) saveLocalVotes(false);
    } catch (e) { V.dirty = true; console.warn('vote save failed', e) }
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

/* ---------- パックを開ける回数 ----------
   時間でたまる分（n：PACK_MAX まで、t：最後に数えた時刻）と、投票でもらった分（b：上限なし）。端末に保存 */
const HOUR = 36e5, CHARGE = PACK_CHARGE_HOURS * HOUR;
export const charge = store.get('dp-charge', { n: PACK_MAX, t: Date.now(), b: 0 });
export const rew = store.get('dp-rew', {});   // 投票で回数をもらった作品 id -> 1
function saveCharge() { store.set('dp-charge', charge); store.set('dp-rew', rew); saveOwned(); showPacks() }
/* タブの右端の「パック開封 ○回」（js/layout.js の #navPk） */
export function showPacks() { const el = document.getElementById('navPk'); if (el) el.innerHTML = `<span class="pk-l">パック</span>開封 <b>${packsLeft()}</b>回` }
setInterval(showPacks, 30000);
function tick() {
  const now = Date.now();
  if (charge.n >= PACK_MAX) { charge.t = now; return }
  const k = Math.floor((now - charge.t) / CHARGE); if (k <= 0) return;
  charge.n = Math.min(PACK_MAX, charge.n + k); charge.t = charge.n >= PACK_MAX ? now : charge.t + k * CHARGE;
  store.set('dp-charge', charge);   // 時間で戻った分はサーバーに送らなくても、どの端末でも同じ計算になる
}
export const packsLeft = () => { tick(); return charge.n + charge.b };
export function usePack() {
  tick(); if (charge.n > 0) charge.n--; else if (charge.b > 0) charge.b--; else return false;
  saveCharge(); return true;
}
/* 同じ作品への投票でもらえるのは1回だけ（取り消して入れ直してもふえない） */
export function voteReward(id) {
  if (rew[id]) return false;
  rew[id] = 1; charge.b += PACK_PER_VOTE; saveCharge(); return true;
}
export function chargeText() {
  const left = packsLeft();
  if (charge.n >= PACK_MAX) return `あと <b>${left}</b> 回開けられます`;
  const m = Math.max(1, Math.ceil((charge.t + CHARGE - Date.now()) / 6e4));
  return `あと <b>${left}</b> 回開けられます ・ 次の1回まで ${m >= 60 ? Math.floor(m / 60) + '時間' : ''}${m % 60 ? m % 60 + '分' : ''}`;
}

/* ---------- 集めたカードと開ける回数：端末に保存。Google連携していればサーバーにも（まとめて保存） ---------- */
let ownedTimer = null;
export function saveOwned() {
  store.set('dp-owned', S.owned);
  if (!isGoogle()) return;
  clearTimeout(ownedTimer); ownedTimer = setTimeout(pushUser, 3000);   // 票と同じ3秒（つづけて投票しているあいだは1回にまとまる）
}
export function pushUser() {
  clearTimeout(ownedTimer); ownedTimer = null;
  if (!isGoogle()) return Promise.resolve();
  return setDoc(doc(db, 'users', S.user.uid), { name: store.get('dp-name', ''), owned: S.owned, charge: { n: charge.n, t: charge.t, b: charge.b }, rew, updatedAt: serverTimestamp() }).catch(e => console.warn(e));
}
export const ownedPending = () => !!ownedTimer;
addEventListener('pagehide', () => { if (ownedTimer) pushUser() });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ownedTimer) pushUser() });
const sameMap = (a, b) => { const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]) };
export async function mergeOwnedFromServer() {
  if (!isGoogle()) return;
  try {
    const d = await getDoc(doc(db, 'users', S.user.uid));
    let same = false;   // 合わせた結果がサーバーの中身と同じなら、書き戻さない（ページを開くたびに書き込まないように）
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
      same = !!sc && sameMap(sc, { n: charge.n, t: charge.t, b: charge.b }) && sameMap(srv, S.owned) && sameMap(sr, rew) && (d.data().name || '') === store.get('dp-name', '');
    }
    if (same) store.set('dp-owned', S.owned); else saveOwned();
  } catch (e) { console.warn(e) }
}

/* ---------- 起動 ----------
   render：このページの描き直し。votes：このページで自分の票を使うか。onUser：アカウントが変わったとき */
export function boot({ render = () => { }, votes = false, onUser = () => { } } = {}) {
  renderHeader(); showPacks();
  try { const t = sessionStorage.getItem('dp-toast'); if (t) { sessionStorage.removeItem('dp-toast'); toast(t) } } catch (e) { }
  if (!CONFIGURED) { toast('js/config.js に Firebase の設定を書いてください'); return }
  let shown = false;
  /* テーマとカードはだれでも読めるので、ログインを待たずに読み始める */
  const ready = Promise.all([loadTheme(), loadPackIndex()])
    .catch(e => { console.warn(e); toast('読み込みに失敗しました') })
    .then(() => { S.loaded = true; shown = true; renderHeader(); render(); countCards().then(renderHeader) });
  let firstUser = true;
  onAuthStateChanged(auth, async u => {
    if (!u) { try { await signInAnonymously(auth) } catch (e) { toast('接続できませんでした') } return }
    const changed = !S.user || S.user.uid !== u.uid; S.user = u;
    if (!changed) return;
    await ready;
    S.votesReady = false;
    if (!firstUser) { S.cards = new Map(); onUser() }
    firstUser = false;
    try { await Promise.all([loadMyVotes(votes), mergeOwnedFromServer()]) } catch (e) { console.warn(e) }
    S.votesReady = true;
    showPacks(); render();
  });
  loadCardFont().then(() => { clearCardCache(); if (shown) render() });
}
