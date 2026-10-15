/* カード1枚ごとのページ（card/?no=0012-2）。投稿した直後は ?new=1 がつく */
import { getDocs, query, where, limit } from './fb.js';
import { $, esc, ATTR_L, fmtNo, parseNo, cardHTML } from './cards.js';
import { S, ROOT, authorHTML, boot, visible, cardsCol, toCard, loadPack, makeFrom, cardPath } from './core.js';
import { shareCard, saveCardImage } from './share.js';

const q = new URLSearchParams(location.search), n = parseNo(q.get('no') || ''), isNew = q.has('new');
let card, loading = null;
/* 検索エンジン向けの head の meta を書き換える（Google は JS を動かしてから読む） */
function head(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) { m = document.createElement('meta'); m.name = name; document.head.appendChild(m) }
  m.content = content;
}
async function find() {
  if (!n) return null;
  if (S.theme && n.tno === S.theme.no) {
    const snap = await getDocs(query(cardsCol(), where('no', '==', n.no), limit(1)));
    if (snap.empty) return null;
    const c = toCard(snap.docs[0]); S.cards.set(c.id, c); return visible(c) ? c : null;
  }
  if (!S.packIndex.find(p => p.no === n.tno)) return null;
  const p = await loadPack(n.tno); return p.cards.find(c => c.no === n.no) || null;
}
async function render() {
  if (!S.loaded) return;
  if (card === undefined) { try { card = await (loading || (loading = find())) } catch (e) { console.warn(e); card = null } }
  const c = card;
  if (!c) { $('#cdBody').innerHTML = '<p class="empty">カードが見つかりません。</p>'; head('robots', 'noindex'); return }
  document.title = `${c.name}｜ドットパック`;
  head('description', `ドット絵カード「${c.name}」${c.anon || !c.by ? '' : `（作：${c.by}）`}。みんなで描いて集めるドットパックのカードです。`);
  if (!document.querySelector('link[rel=canonical]')) document.head.insertAdjacentHTML('beforeend', `<link rel="canonical" href="${esc(ROOT + cardPath(c))}">`);
  const open = S.theme && c.tid === S.theme.id;
  const packName = open ? S.theme.name : (S.packIndex.find(p => p.tid === c.tid) || {}).name || '';
  const rows = [['パック', esc(packName)], ['作品番号', esc(fmtNo(c))], ['作者', authorHTML(c)]];
  if (c.star) rows.push(['系統・星', `${c.attr ? ATTR_L[c.attr] : '—'} ・ ${'★'.repeat(c.star)}`]);
  if (c.fan) rows.push(['収録', 'パック対象外']);
  if (c.baseNo) rows.push(['元ネタ', `<a class="linkbtn" href="${ROOT}${cardPath(parseNo(c.baseNo))}">${esc(c.baseNo)}</a>`]);
  $('#cdBody').innerHTML = `${isNew ? '<p class="cd-new">投稿しました！<small>みんなに見てもらおう</small></p>' : ''}
    <div class="dt-card">${cardHTML(c, c.star ? 'full' : 'pending', '', 3)}</div>
    <dl class="dt-info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="ov-actions">
      <button class="btn primary" id="cdShare">Xでシェア</button>
      <button class="btn" id="cdSave">画像を保存</button>
      ${S.theme ? '<button class="btn" id="cdMake">これを元に作る</button>' : ''}
    </div>
    ${open ? `<p><a class="linkbtn" href="${ROOT}">投票ページへ</a></p>` : ''}`;
  $('#cdShare').onclick = () => shareCard(c, isNew || (S.user && c.uid === S.user.uid));
  $('#cdSave').onclick = () => saveCardImage(c);
  if (S.theme) $('#cdMake').onclick = () => makeFrom(c);
}
boot({ render });
