/* 作品画面（カードを押したときに開く大きい表示）。投票と図鑑のページで使う */
import { db, doc, getDoc } from './fb.js';
import { $, esc, ATTR_L, fmtNo, parseNo, cardHTML } from './cards.js';
import { S, ROOT, authorHTML, visible, cardById, cardsCol, toCard, loadPack, makeFrom, cardPath } from './core.js';
import { shareCard } from './share.js';

document.body.insertAdjacentHTML('beforeend', `<div id="dt" class="modal" hidden>
  <div class="dt-in">
    <div id="dtCard" class="dt-card"></div>
    <dl id="dtInfo" class="dt-info"></dl>
    <div class="ov-actions">
      <button class="btn primary" id="dtMake">これを元に作る</button>
      <button class="btn" id="dtShare">Xでシェア</button>
      <button class="btn" id="dtClose">とじる</button>
    </div>
  </div>
</div>`);

let dtCard = null;
export function openDetail(id) {
  const c = cardById(id); if (!c) return; dtCard = c;
  const packName = S.theme && c.tid === S.theme.id ? S.theme.name : (S.packIndex.find(p => p.tid === c.tid) || {}).name || '';
  $('#dtCard').innerHTML = cardHTML(c, c.star ? 'full' : 'pending', '', 3);
  const rows = [['パック', esc(packName)], ['作品番号', `<a class="linkbtn" href="${ROOT}${esc(cardPath(c))}">${esc(fmtNo(c))}</a>`], ['作者', authorHTML(c)]];
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
export function closeDetail() { $('#dt').hidden = true; document.body.style.overflow = '' }
$('#dtInfo').addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) openDetail(b.dataset.goto) });
$('#dtClose').onclick = closeDetail;
$('#dt').addEventListener('click', e => { if (e.target === $('#dt')) closeDetail() });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#dt').hidden) closeDetail() });
$('#dtMake').onclick = () => makeFrom(dtCard);
$('#dtShare').onclick = () => shareCard(dtCard, S.user && dtCard.uid === S.user.uid);
