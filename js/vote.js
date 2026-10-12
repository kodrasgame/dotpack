/* 投票ページ（サイトのいちばん上） */
import { db, doc, getDoc, getDocs, updateDoc, query, orderBy, limit, startAfter, serverTimestamp } from './fb.js';
import { $, esc, ATTRS, N, cardHTML } from './cards.js';
import { PACK_PER_VOTE } from './config.js';
import {
  S, V, store, memo, toast, boot, renderHeader, forgetCount, forgetFeed, visible, capHTML, cardsCol, toCard,
  saveLocalVotes, flushVotes, voteReward, packsLeft, rew
} from './core.js';
import { openDetail } from './detail.js';

/* 受付中のカード：並び順ごとに PAGE 枚ずつ読む（「もっと見る」で続きを読む） */
const PAGE = 20;
const SORTS = { new: ['no', 'desc'], pop: ['vc', 'desc'] };
let sort = store.get('dp-sort', 'new');   // new（新着順）/ pop（人気順）
let feeds = {};                           // 並び順ごとの読み込み状況 { ids, cursor, done, loading, failed, at }
const feed = () => feeds[sort] || (feeds[sort] = recall() || { ids: [], cursor: null, done: false, loading: null, failed: false });

/* 読んだ一覧は、並び順ごとに KEEP のあいだ覚えておく（トップに戻るたびに読み直さない）。
   at は最初の1ページを読んだ時刻。選んでいる並び順をもう一度押すと捨てて読み直す。投稿したときも捨てる（make.js） */
const KEEP = 5 * 6e4;
function kept() { const m = S.theme && memo.get('dp-feed', KEEP); return m && m.tid === S.theme.id ? m.by : {} }
function recall() {
  const k = kept()[sort];
  if (!k || Date.now() - k.at >= KEEP) return null;
  k.cards.forEach(c => { if (!S.cards.has(c.id)) S.cards.set(c.id, c) });
  return { ids: k.cards.map(c => c.id), cursor: null, done: k.done, loading: null, failed: false, at: k.at };
}
function keep(s, f) {
  const by = kept(); by[s] = { at: f.at, done: f.done, cards: f.ids.map(id => S.cards.get(id)).filter(Boolean) };
  memo.set('dp-feed', { tid: S.theme.id, by });
}
function unkeep(s) { const by = kept(); if (by[s]) { delete by[s]; memo.set('dp-feed', { tid: S.theme.id, by }) } }

function loadMore() {
  const s = sort, f = feed();
  if (!S.theme || f.done) return Promise.resolve();
  if (f.loading) return f.loading;
  return f.loading = (async () => {
    /* 覚えていた一覧の続きを読むときは、最後の1枚だけ読み直して「ここから先」の目印にする */
    if (!f.cursor && f.ids.length) { const last = await getDoc(doc(cardsCol(), f.ids[f.ids.length - 1])); if (last.exists()) f.cursor = last; else f.ids = [] }
    const cons = [orderBy(...SORTS[s])]; if (f.cursor) cons.push(startAfter(f.cursor)); cons.push(limit(PAGE));
    const snap = await getDocs(query(cardsCol(), ...cons));
    snap.forEach(d => { S.cards.set(d.id, toCard(d)); if (!f.ids.includes(d.id)) f.ids.push(d.id) });
    if (snap.docs.length) f.cursor = snap.docs[snap.docs.length - 1];
    f.done = snap.docs.length < PAGE;
    f.at = f.at || Date.now(); keep(s, f);
  })().finally(() => { f.loading = null });
}
async function more() {
  const f = feed();
  try { await loadMore() } catch (e) { console.warn(e); f.failed = true; toast('読み込めませんでした') }
  render();
}

let delArm = null;
function render() {
  document.querySelectorAll('[data-sort]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === sort));
  $('#voteSort').hidden = !S.theme;
  if (!S.theme) { $('#voteNote').textContent = ''; $('#voteGrid').innerHTML = S.loaded ? '<p class="empty">いまは投稿・投票を受け付けていません。</p>' : '<p class="empty">読み込み中…</p>'; $('#voteMore').hidden = true; return }
  const f = feed(), uid = S.user && S.user.uid;
  if (!f.ids.length && !f.done && !f.loading && !f.failed) more();   // 最初の1ページ
  const list = f.ids.map(id => S.cards.get(id)).filter(visible);
  $('#voteMore').hidden = f.done; $('#voteMore').disabled = !!f.loading; $('#voteMore').textContent = f.loading ? '読み込み中…' : 'もっと見る';
  $('#voteNote').innerHTML = `あなたの投票でレアリティが決まる！<br>投票するとパック開封回数が増えます（あと <b>${packsLeft()}</b> 回）`;
  $('#voteGrid').innerHTML = list.map(c => `<div class="vcell">${cardHTML(c, 'pending', c.uid !== uid && !rew[c.id] ? `<span class="cnt plus1">+${PACK_PER_VOTE}</span>` : '')}${capHTML(c)}${c.uid === uid ?
    `<div class="mine">あなたの作品<button class="linkbtn" data-del="${esc(c.id)}">${delArm === c.id ? 'もう一度押すと削除' : '削除'}</button></div>` :
    `<div class="vbtns">${ATTRS.map(a => `<button class="vb a-${a.k}" data-id="${esc(c.id)}" data-k="${a.k}" aria-pressed="${S.myVotes[c.id] === a.k}">${a.l}</button>`).join('')}</div>`}</div>`).join('')
    || (f.done ? '<p class="empty">まだ投稿がありません。右上の「＋つくる」から最初の1枚をどうぞ。</p>' : f.loading && !f.ids.length ? '<p class="empty">読み込み中…</p>' : '');
}

/* 並び順。選んでいる方をもう一度押すと、最新の状態で読み直す */
$('#voteSort').addEventListener('click', e => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  if (b.dataset.sort === sort) { if (!feed().loading) { delete feeds[sort]; unkeep(sort) } }
  else { sort = b.dataset.sort; store.set('dp-sort', sort) }
  render();
});
$('#voteMore').onclick = () => { feed().failed = false; more(); render() };
$('#voteGrid').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (d) {
    const id = d.dataset.del; if (delArm !== id) { delArm = id; render(); return }
    delArm = null;
    try {
      await updateDoc(doc(db, 'themes', S.theme.id, 'cards', id), { deleted: true, px: '0'.repeat(N * N), name: '', text: '', by: '', updatedAt: serverTimestamp() });
      const c = S.cards.get(id); if (c) c.deleted = true; S.count = Math.max(0, S.count - 1); forgetCount();
      forgetFeed(); keep(sort, feed());   // 一覧の控えも直す（ほかの並び順の控えは捨てる）
      renderHeader(); render(); toast('削除しました');
    }
    catch (err) { toast('削除できませんでした') }
    return;
  }
  const b = e.target.closest('.vb');
  if (b) {
    if (!S.votesReady) return;
    const id = b.dataset.id, k = b.dataset.k;
    if (S.myVotes[id] === k) delete S.myVotes[id]; else S.myVotes[id] = k;
    saveLocalVotes(true);
    if (S.myVotes[id] && voteReward(id)) toast(`パック +${PACK_PER_VOTE}（あと ${packsLeft()} 回）`);
    V.dirty = true; clearTimeout(V.timer); V.timer = setTimeout(flushVotes, 3000);
    render(); return;
  }
  if (e.target.closest('button')) return;
  const card = e.target.closest('.card[data-cid]'); if (card) openDetail(card.dataset.cid);
});

boot({ render, votes: true, onUser: () => { feeds = {}; forgetFeed() } });
