/* つくるページ（ドット絵のエディタと投稿） */
import { db, doc, collection, runTransaction, serverTimestamp } from './fb.js';
import { $, esc, N, NAME_MAX, TEXT_MAX, fmtNo, nameW, clipW, artURL, cardHTML, B64, BASE, NCOL, encodeArt, hex6 } from './cards.js';
import { S, store, boot, go, forgetCount, forgetFeed, authorName, cardPath } from './core.js';

/* ---------- つくる（エディタ） ---------- */
/* 絵は1マス1文字（B64 の文字。'A'＝透明、'B'＝黒、'C'＝白、'D'〜'S'＝16色）。色は ed.colors の16色を自由に変えられる */
const EMPTY = B64[0].repeat(N * N);
const draft = store.get('dp-draft', null);
const ed = { px: EMPTY, colors: null, color: 3, tool: 'pen', hist: [], base: null };
const val = ch => B64.indexOf(ch);
const pad16 = cols => Array.from({ length: NCOL }, (_, k) => hex6((cols || [])[k] || GRAY[k]));
const GRAY = ['#e8e8e8', '#d0d0d0', '#b8b8b8', '#a0a0a0', '#888888', '#707070', '#585858', '#404040', '#e8e8e8', '#d0d0d0', '#b8b8b8', '#a0a0a0', '#888888', '#707070', '#585858', '#404040'];
const presetColors = i => pad16(S.theme.palettes && S.theme.palettes[i] ? S.theme.palettes[i].colors : []);
const cv = $('#cv'), cx = cv.getContext('2d'), view = $('#cvView');
let CELL = cv.width / N, zoom = 1, cssSize = 0;
const ZOOMS = [1, 2, 3, 4];
const edCols = () => [null, ...BASE, ...ed.colors];   // 値 → 色
const edArt = () => encodeArt(Array.from(ed.px, val), N, N, ed.colors);
function saveDraft() { if (S.theme) store.set('dp-draft', { t: S.theme.id, v: 2, px: ed.px, colors: ed.colors, base: ed.base, name: $('#fName').value, text: $('#fText').value }) }
let draftLoaded = false;
function openMake() {
  if (!S.loaded) return;
  if (!S.theme) { $('#makeBody').hidden = true; $('#makeClosed').hidden = false; return }
  $('#makeBody').hidden = false; $('#makeClosed').hidden = true;
  if (!draftLoaded) {
    draftLoaded = true;
    if (draft && draft.t === S.theme.id) {
      if (draft.v === 2) { ed.px = draft.px; ed.colors = pad16(draft.colors) }
      else if (typeof draft.px === 'string') {   // 前の形式の下書き（16進＋パレット番号）を読みかえる
        ed.px = Array.from(draft.px, ch => B64[parseInt(ch, 16) ? parseInt(ch, 16) + 2 : 0]).join(''); ed.colors = presetColors(draft.p || 0);
      }
      ed.base = draft.base || null; $('#fName').value = draft.name || ''; $('#fText').value = draft.text || '';
    }
    if (!ed.colors) ed.colors = presetColors(0);
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
window.addEventListener('resize', () => { if (S.theme) layoutCanvas() });
function drawEditor() {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--art-bg').trim(), ck = cs.getPropertyValue('--check').trim(), cols = edCols();
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = i / N | 0, v = val(ed.px[i]);
    cx.fillStyle = v ? cols[v] : (((x >> 1) + (y >> 1)) % 2 ? ck : bg); cx.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  const lw = Math.max(1, Math.round(window.devicePixelRatio || 1));
  for (let k = 1; k < N; k++) {
    cx.fillStyle = k === N / 2 ? 'rgba(128,128,128,.55)' : k % 8 === 0 ? 'rgba(128,128,128,.35)' : 'rgba(128,128,128,.16)';
    const p = k * CELL; cx.fillRect(p, 0, lw, cv.height); cx.fillRect(0, p, cv.width, lw);
  }
}
function setPx(i, v) { ed.px = ed.px.slice(0, i) + B64[v] + ed.px.slice(i + 1) }
function flood(i, v) {
  const arr = ed.px.split(''), from = arr[i], to = B64[v]; if (from === to) return;
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
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const sx = x - dx, sy = y - dy; o += (sx < 0 || sy < 0 || sx >= N || sy >= N) ? B64[0] : px[sy * N + sx] }
  return o;
}
function line(a, b, v) {
  let x0 = a % N, y0 = a / N | 0; const x1 = b % N, y1 = b / N | 0, dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (; ;) { setPx(y0 * N + x0, v); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx } if (e2 <= dx) { err += dx; y0 += sy } }
}
function paint(e) {
  const i = cellAt(e); if (i < 0 || i === lastCell) return;   // 同じマスの中で動いただけなら描き直さない
  const v = ed.tool === 'erase' ? 0 : ed.color;
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
/* おすすめパレット（テーマごと）：押すと16色をそのパレットの色にする（描いた絵の色もまとめて変わる） */
function renderPals() {
  $('#pals').innerHTML = (S.theme.palettes || []).map((p, i) => `<button class="palbtn" data-p="${i}">${esc(p.name)}<span class="strip">${p.colors.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span></button>`).join('');
}
$('#pals').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; ed.colors = presetColors(+b.dataset.p); renderPal(); drawEditor(); saveDraft(); renderPreview() });
/* 色：黒・白（固定）＋自由な16色。16色の方は選んでから「色を変える」で変えられる */
const pal = $('#pal');
const useBW = () => S.theme.bw !== false;   // 黒・白を使うかはテーマごとに管理画面で決める
function renderPal() {
  if (!useBW() && ed.color < 3) ed.color = 3;
  const sw = (c, v, label) => `<button class="sw" data-c="${v}" style="background:${c}" aria-label="${label}" aria-pressed="${v === ed.color}"></button>`;
  pal.innerHTML = (useBW() ? `<div class="sw-row">${sw(BASE[0], 1, '黒')}${sw(BASE[1], 2, '白')}</div>` : '')
    + `<div class="sw-row">${ed.colors.map((c, k) => sw(c, k + 3, '色' + (k + 1))).join('')}</div>`;
  const free = ed.color >= 3; $('#colPick').disabled = !free; if (free) $('#colPick').value = ed.colors[ed.color - 3];
}
pal.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; ed.color = +b.dataset.c; if (ed.tool === 'erase' || ed.tool === 'move') ed.tool = 'pen'; renderPal(); renderTools() });
$('#colPick').addEventListener('input', e => { if (ed.color < 3) return; ed.colors[ed.color - 3] = hex6(e.target.value); renderPal(); drawEditor(); renderPreview() });
$('#colPick').addEventListener('change', saveDraft);
function renderBase() {
  const c = ed.base; $('#baseBox').hidden = !c; if (!c) return;
  $('#baseImg').src = artURL(c); $('#baseName').textContent = c.name; $('#baseNo').textContent = fmtNo(c) + '　by ' + c.by;
}
$('#baseClear').onclick = () => { ed.base = null; saveDraft(); renderBase(); renderPreview() };
function renderPreview() {
  $('#nameCnt').textContent = `${nameW($('#fName').value)}/${NAME_MAX}`;
  const pc = { id: '_p', name: $('#fName').value, text: $('#fText').value, art: edArt(), fan: $('#fFan').checked };
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
  const filled = [...ed.px].filter(c => c !== B64[0]).length;
  const err = m => { $('#mkErr').textContent = m };
  if (filled < 30) return err('もう少し描いてから投稿してください（30マス以上）');
  if (!name) return err('名前を入れてください');
  err(''); posting = true; $('#submit').disabled = true;
  const by = authorName().slice(0, 12);
  try {
    const tRef = doc(db, 'themes', S.theme.id), cRef = doc(collection(db, 'themes', S.theme.id, 'cards'));
    let posted = null;
    await runTransaction(db, async tx => {
      const t = await tx.get(tRef);
      if (!t.exists() || t.data().status !== 'open') throw new Error('closed');
      const seq = (t.data().seq || 0) + 1; posted = { no: seq, tno: t.data().no };
      tx.update(tRef, { seq });
      tx.set(cRef, {
        uid: S.user.uid, tid: S.theme.id, tno: t.data().no, no: seq, by, name, text, art: edArt(),
        fan: $('#fFan').checked, base: ed.base ? ed.base.id : null, baseNo: ed.base ? fmtNo(ed.base) : null,
        hidden: false, deleted: false, anon: false, vc: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    });
    ed.px = EMPTY; ed.hist = []; ed.base = null; $('#fName').value = ''; $('#fText').value = ''; $('#fFan').checked = false; saveDraft();
    /* 投稿したカードのページへ（そこから X にシェアできる）。投票ページは新着順にしておく */
    forgetCount(); forgetFeed(); store.set('dp-sort', 'new');
    go(cardPath(posted) + '&new=1');
  } catch (e) {
    console.warn(e); err(e.message === 'closed' ? 'いまは投稿を受け付けていません' : '投稿できませんでした。時間をおいてもう一度お試しください');
  } finally { posting = false; $('#submit').disabled = false }
};

boot({ render: openMake });
