/* 図鑑ページ（集めたカード） */
import { $, esc, ATTRS, cardHTML } from './cards.js';
import { S, boot, capHTML, loadPack } from './core.js';
import { openDetail } from './detail.js';

/* ---------- 図鑑 ---------- */
let dexSel = null;
async function renderDex() {
  if (!S.loaded) return;
  if (!S.packIndex.length) { $('#dexChips').innerHTML = ''; $('#dexProg').textContent = ''; $('#dexGrid').innerHTML = '<p class="empty">まだパックがありません。</p>'; return }
  if (!dexSel || !S.packIndex.find(p => p.no === dexSel)) dexSel = S.packIndex[0].no;
  $('#dexChips').innerHTML = S.packIndex.map(p => `<button class="chip" data-no="${p.no}" aria-pressed="${p.no === dexSel}">${esc(p.name)}</button>`).join('');
  const no = dexSel;
  let p; try { p = await loadPack(no) } catch (e) { if (no === dexSel) $('#dexGrid').innerHTML = '<p class="empty">読み込めませんでした。</p>'; return }
  if (no !== dexSel) return;   // 読み込んでいるあいだに別のパックが選ばれた
  const ak = Object.fromEntries(ATTRS.map((a, i) => [a.k, i]));
  const cards = p.cards.slice().sort((a, b) => (ak[a.attr] ?? 9) - (ak[b.attr] ?? 9) || b.star - a.star || a.no - b.no);
  $('#dexProg').innerHTML = `${cards.filter(c => S.owned[c.id]).length} / ${cards.length}<small>${esc(p.name)}</small>`;
  $('#dexGrid').innerHTML = cards.map(c => S.owned[c.id] ? `<div class="cw">${cardHTML(c, 'full', `<span class="cnt">×${S.owned[c.id]}</span>`)}${capHTML(c)}</div>` : `<div class="cw">${cardHTML(c, 'sil')}</div>`).join('');
}
$('#dexChips').addEventListener('click', e => { const b = e.target.closest('[data-no]'); if (b) { dexSel = +b.dataset.no; renderDex() } });
$('#dexGrid').addEventListener('click', e => { const card = e.target.closest('.card[data-cid]'); if (card) openDetail(card.dataset.cid) });

boot({ render: renderDex });
