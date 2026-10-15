/* 作者ページ（author/?u=アカウントの番号）：その人が描いたカードの一覧。
   投票中（今月）のカードは Firestore から、その人の分だけ読む（最大50枚）。
   パックに収録されたカードは packs/ の JSON から探す。持っているカードは絵を、持っていないカードはシルエットと「〇月のパック」を出す。
   作者名を非表示にしたカード・削除・非表示のカードは出さない */
import { getDocs, query, where, limit } from './fb.js';
import { $, esc, cardHTML } from './cards.js';
import { S, boot, cardsCol, toCard, visible, loadPack, monthLabel } from './core.js';
import { openDetail } from './detail.js';

const uid = new URLSearchParams(location.search).get('u') || '';
const OK = /^[A-Za-z0-9_-]{1,128}$/.test(uid);
let data = null, loading = false;

async function load() {
  loading = true;
  const open = [], packed = [];
  if (OK && S.theme) try {
    const snap = await getDocs(query(cardsCol(), where('uid', '==', uid), limit(50)));
    snap.forEach(d => { const c = toCard(d); if (visible(c) && !c.anon) { S.cards.set(c.id, c); open.push(c) } });
  } catch (e) { }
  if (OK) await Promise.all(S.packIndex.map(async pi => {
    try { const p = await loadPack(pi.no); for (const c of p.cards) if (c.uid === uid && !c.anon) packed.push({ c, pi }) } catch (e) { }
  }));
  open.sort((a, b) => b.no - a.no);
  packed.sort((a, b) => b.pi.no - a.pi.no || a.c.no - b.c.no);
  data = { open, packed }; loading = false; render();
}

function render() {
  if (!S.loaded) return;
  if (!data) { if (!loading) load(); return }
  const { open, packed } = data, latest = open[0] || (packed[0] && packed[0].c);
  const name = latest ? latest.by || 'ななしさん' : '';
  const me = S.user && S.user.uid === uid;
  document.title = `${name || '作者'}の作品｜ドットパック`;
  $('#auName').innerHTML = latest ? `${esc(name)}の作品${me ? '<small>（あなた）</small>' : ''}` : '作品が見つかりません';
  let h = '';
  if (open.length) h += `<h3 class="au-h">投票中</h3><div class="grid">${open.map(c => `<div class="cw">${cardHTML(c, 'pending')}</div>`).join('')}</div>`;
  if (packed.length) h += `<h3 class="au-h">パックに収録</h3><div class="grid">${packed.map(({ c, pi }) => {
    const mine = S.owned[c.id], label = `${monthLabel(pi.month)}のパック`;
    return `<div class="cw">${mine ? cardHTML(c, 'full') : cardHTML(c, 'sil')}<div class="cap"><span>${esc(label)}${mine ? '' : 'で出るよ'}</span></div></div>`;
  }).join('')}</div>`;
  $('#auBody').innerHTML = h || (latest ? '' : '<p class="empty">この作者の作品はまだありません。</p>');
}
$('#auBody').addEventListener('click', e => { const card = e.target.closest('.card[data-cid]'); if (card) openDetail(card.dataset.cid) });

boot({ render });
