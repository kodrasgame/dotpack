/* 投票の枠（カード＋系統ボタン）。投票ページと作者ページで使う */
import { esc, ATTRS, cardHTML } from './cards.js';
import { PACK_PER_VOTE } from './config.js';
import { S, V, toast, capHTML, saveLocalVotes, flushVotes, voteReward, packsLeft, rew } from './core.js';

/* mine：自分の作品のときに出す部分（投票ページは削除ボタン付き）。cap：作者名・元ネタの行を出すか */
export function voteCell(c, { mine = () => '<div class="mine">あなたの作品</div>', cap = true } = {}) {
  const own = S.user && c.uid === S.user.uid;
  return `<div class="vcell">${cardHTML(c, 'pending', !own && !rew[c.id] ? `<span class="cnt plus1">+${PACK_PER_VOTE}</span>` : '')}${cap ? capHTML(c) : ''}${own ? mine(c) :
    `<div class="vbtns">${ATTRS.map(a => `<button class="vb a-${a.k}" data-id="${esc(c.id)}" data-k="${a.k}" aria-pressed="${S.myVotes[c.id] === a.k}">${a.l}</button>`).join('')}</div>`}</div>`;
}
/* 系統ボタンを押したとき。押されたのが系統ボタンなら票を入れて true を返す（画面の描き直しは呼んだ側で） */
export function voteClick(e) {
  const b = e.target.closest('.vb'); if (!b) return false;
  if (!S.votesReady) return true;
  const id = b.dataset.id, k = b.dataset.k;
  if (S.myVotes[id] === k) delete S.myVotes[id]; else S.myVotes[id] = k;
  saveLocalVotes(true);
  if (S.myVotes[id] && voteReward(id)) toast(`パック +${PACK_PER_VOTE}（あと ${packsLeft()} 回）`);
  V.dirty = true; clearTimeout(V.timer); V.timer = setTimeout(flushVotes, 3000);
  return true;
}
