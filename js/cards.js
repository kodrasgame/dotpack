/* カードの描画と共通の道具（公開ページと管理画面で共通） */

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* 系統。en＝カード左上の印の文字、c＝印の地の色 */
export const ATTRS = [
  { k: 'cute', l: 'かわいい', en: 'CUTE', c: '#ef6aa0' },
  { k: 'cool', l: 'クール', en: 'COOL', c: '#3f7fdc' },
  { k: 'strong', l: 'パワフル', en: 'POWER', c: '#f2c12e', t: '#1c1c1c' },
  { k: 'weird', l: '怪しい', en: 'WEIRD', c: '#8a57c9' },
  { k: 'passion', l: '情熱', en: 'PASSION', c: '#e0453a' },
];
const ATTR_C = Object.fromEntries(ATTRS.map(a => [a.k, a]));
export const ATTR_L = Object.fromEntries(ATTRS.map(a => [a.k, a.l]));
export const N = 32;                 // 絵は 32×32
export const NAME_MAX = 16;          // 名前：全角8文字（全角=2、半角=1）
export const TEXT_MAX = 18;          // ひとこと：18文字

/* 作品番号は「カード番号-パック番号」。例：No.0003-1 */
export const fmtNo = c => 'No.' + (c && c.no ? String(c.no).padStart(4, '0') + '-' + c.tno : '----');
export function parseNo(v) { const m = String(v).match(/(\d+)\D+(\d+)/); return m ? { no: +m[1], tno: +m[2] } : null; }

/* 名前の幅（全角=2、半角=1） */
export const nameW = s => [...s].reduce((w, ch) => w + (/[ -~｡-ﾟ]/.test(ch) ? 1 : 2), 0);
export function clipW(s, max) { let w = 0, out = ''; for (const ch of s) { const c = nameW(ch); if (w + c > max) break; w += c; out += ch } return out }

/* 各テーマのおすすめパレット（描くときの色の初期値）。tid -> [{name, colors[最大16]}]。前の形式のカードの色にも使う */
export const PALETTES = {};
/* テーマのパレットを変えたあとも、前の形式のカードが元の色のまま描けるように残しておくパレット。tid -> palettes */
export const LEGACY = {};

/* ---------- 絵の保存形式（art） ----------
   "1" ＋ 幅2文字 ＋ 高さ2文字 ＋ 色16個（1色4文字）＋ 絵。使う文字は B64 の64種類だけ（URLにもそのまま使える）。
   絵の1文字：0＝透明、1＝黒、2＝白、3〜18＝色16個、19〜63＝「次の1文字の色を3〜47回くり返す」。左上から右下へ1本の流れで読む。
   カードの絵は 32×32。テーマのロゴも同じ形式（LOGO_MAX まで）。
   前の形式（px：16進1024文字 ＋ p：テーマのパレット番号）のカードもそのまま描ける。 */
export const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = Object.fromEntries([...B64].map((c, i) => [c, i]));
export const BASE = ['#000000', '#ffffff'];    // 黒・白（どのカードでも使える固定の色）
export const NCOL = 16;                         // 自由に選べる色の数
export const LOGO_MAX = { w: 160, h: 32 };      // テーマのロゴの最大の大きさ（ドット）
const NV = 3 + NCOL, MAXRUN = 64 - NV + 2;      // 色の値は 0〜18、くり返しは3〜47回
const n2 = n => B64[n >> 6 & 63] + B64[n & 63], d2 = s => B64I[s[0]] * 64 + B64I[s[1]];
export const hex6 = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '#888888';
/* vals：0〜18 の数の並び（w×h）。colors：16色 */
export function encodeArt(vals, w, h, colors) {
  let s = '1' + n2(w) + n2(h);
  for (let k = 0; k < NCOL; k++) { const v = parseInt(hex6(colors[k]).slice(1), 16); s += B64[v >> 18 & 63] + B64[v >> 12 & 63] + B64[v >> 6 & 63] + B64[v & 63] }
  for (let i = 0; i < vals.length;) {
    let j = i; while (j < vals.length && vals[j] === vals[i] && j - i < MAXRUN) j++;
    if (j - i >= 3) { s += B64[NV + j - i - 3] + B64[vals[i]]; i = j } else s += B64[vals[i++]];
  }
  return s;
}
const artMemo = new Map();
/* 読めない文字列なら null */
export function decodeArt(s) {
  if (typeof s !== 'string' || s[0] !== '1' || s.length < 5 + NCOL * 4) return null;
  if (artMemo.has(s)) return artMemo.get(s);
  const w = d2(s.slice(1, 3)), h = d2(s.slice(3, 5)); if (!(w > 0 && h > 0 && w * h <= 16384)) return null;
  const colors = [];
  for (let k = 0; k < NCOL; k++) { let v = 0; for (let q = 0; q < 4; q++) { const d = B64I[s[5 + k * 4 + q]]; if (d === undefined) return null; v = v * 64 + d } colors.push('#' + v.toString(16).padStart(6, '0')) }
  const px = new Uint8Array(w * h); let i = 0;
  for (let k = 5 + NCOL * 4; k < s.length && i < w * h; k++) {
    const v = B64I[s[k]]; if (v === undefined) return null;
    if (v >= NV) { const c = B64I[s[++k]]; if (c === undefined || c >= NV) return null; px.fill(c, i, Math.min(w * h, i + v - NV + 3)); i += v - NV + 3 }
    else px[i++] = v;
  }
  const r = { w, h, colors, px }; if (artMemo.size > 2000) artMemo.clear(); artMemo.set(s, r); return r;
}
/* カード（または表紙）の絵を { w, h, px（値の並び）, cols（値→色） } にする */
function artOf(c) {
  const a = c && c.art && decodeArt(c.art);
  if (a) return { w: a.w, h: a.h, px: a.px, cols: [null, ...BASE, ...a.colors] };
  const px = new Uint8Array(N * N);
  if (c && typeof c.px === 'string') {   // 前の形式
    for (let i = 0; i < N * N; i++) px[i] = parseInt(c.px[i], 16) || 0;
    const src = LEGACY[c.tid] || PALETTES[c.tid], pal = src && src[c.p] ? src[c.p].colors : [];
    return { w: N, h: N, px, cols: [null, ...Array.from({ length: 15 }, (_, k) => pal[k] || '#888888')] };
  }
  return { w: N, h: N, px, cols: [null] };
}
export function artCanvas(c, sil) {
  const a = artOf(c), cv = document.createElement('canvas'); cv.width = a.w; cv.height = a.h; const x = cv.getContext('2d');
  const silCol = cssv('--sil') || '#cfcfcf';
  for (let i = 0; i < a.px.length; i++) { const v = a.px[i]; if (!v) continue; x.fillStyle = sil ? silCol : (a.cols[v] || '#888888'); x.fillRect(i % a.w, i / a.w | 0, 1, 1) }
  return cv;
}
const artCache = new Map();
export function artURL(c, sil) {
  const k = (c.id || '') + '|' + (c.art || c.px || '') + (sil ? ':s' : '');
  if (!artCache.has(k)) artCache.set(k, artCanvas(c, sil).toDataURL());
  return artCache.get(k);
}
/* テーマのロゴ（art 形式）。読めなければ null */
export function logoInfo(art) { const a = decodeArt(art); return a && a.w <= LOGO_MAX.w && a.h <= LOGO_MAX.h ? { w: a.w, h: a.h, url: artURL({ art }) } : null }

/* ---------- カード（110×154ドット、カードレイアウトツールで決めた配置） ---------- */
export const CW = 110, CH = 154, CB = 5, CC = 2;
const LAY = { art: { x: 7, y: 7, scale: 3 }, stars: { r: 103, y: 15, gap: 1 }, no: { x: 103, y: 7 }, name: { x: 9, y: 104 }, text: { x: 9, y: 117, w: 91, lh: 12 } };

/* 枠：のっぺりした1色（5ドット）＋いちばん外側の1ドットは黒。★1 黒・★2 銀・★3 金・★4以上 虹。受付中は黒、未所持は灰 */
const METAL = { 1: '#1c1c1c', 2: '#9aa3b1', 3: '#d4a133' };
const rainbow = t => `hsl(${Math.round(((t * 360 + 300) % 360) / 15) * 15} 85% 58%)`;
const frameColor = (star, t) => star >= 4 ? rainbow(t) : METAL[star];
/* 枠は星と色が同じならどのカードも同じ。1回だけ描いて使い回す（毎回描くと1枚ごとに数千回の点打ちになる） */
const frames = new Map();
function drawFrame(x, edge, star) {
  const key = star + '|' + edge;
  let f = frames.get(key);
  if (!f) { f = document.createElement('canvas'); f.width = CW; f.height = CH; paintFrame(f.getContext('2d'), edge, star); frames.set(key, f) }
  x.drawImage(f, 0, 0);
}
function paintFrame(x, edge, star) {
  const per = 2 * (CW + CH);
  x.fillStyle = '#ffffff'; x.fillRect(CB, CB, CW - 2 * CB, CH - 2 * CB);
  for (let py = 0; py < CH; py++) for (let px = 0; px < CW; px++) {
    const d = Math.min(px, py, CW - 1 - px, CH - 1 - py, px + py - CC, (CW - 1 - px) + py - CC, px + (CH - 1 - py) - CC, (CW - 1 - px) + (CH - 1 - py) - CC);
    if (d < 0 || d >= CB) continue;
    if (star) { const m = Math.min(py, CW - 1 - px, CH - 1 - py, px); const p = m === py ? px : m === CW - 1 - px ? CW + py : m === CH - 1 - py ? CW + CH + (CW - 1 - px) : 2 * CW + CH + (CH - 1 - py); x.fillStyle = d === 0 ? '#1c1c1c' : frameColor(star, p / per) }
    else x.fillStyle = edge;
    x.fillRect(px, py, 1, 1);
  }
}

/* 星：7×6ドット */
const STAR = ['...#...', '..###..', '#######', '.#####.', '.##.##.', '.#...#.'];
/* 星は番号の下に縦に並べる（右端そろえ） */
function drawStars(x, n) { const L = LAY.stars, ox = L.r - 7; for (let k = 0; k < n; k++) { x.fillStyle = frameColor(n, k / 5); const oy = L.y + k * (6 + L.gap); STAR.forEach((row, j) => { for (let i = 0; i < 7; i++)if (row[i] === '#') x.fillRect(ox + i, oy + j, 1, 1) }) } }

/* 作品番号用のドット数字（高さ6ドット＝星と同じ） */
const DIGIT = {
  '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'], '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '...#.', '..#..', '.#...', '#####'], '3': ['####.', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.'], '5': ['#####', '#....', '####.', '....#', '....#', '####.'],
  '6': ['.###.', '#....', '####.', '#...#', '#...#', '.###.'], '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '.###.', '#...#', '#...#', '.###.'], '9': ['.###.', '#...#', '#...#', '.####', '....#', '.###.'],
  '-': ['...', '...', '###', '...', '...', '...'], 'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  'o': ['....', '....', '.##.', '#..#', '#..#', '.##.'], '.': ['.', '.', '.', '.', '.', '#'],
};
const digitsW = str => [...str].reduce((w, ch, i) => w + (DIGIT[ch] ? DIGIT[ch][0].length : 3) + (i ? 1 : 0), 0);
function drawDigits(ctx, str, x, y, col) {
  let cx = x - digitsW(str); ctx.fillStyle = col;
  for (const ch of str) { const g = DIGIT[ch]; if (g) g.forEach((row, j) => { for (let i = 0; i < row.length; i++)if (row[i] === '#') ctx.fillRect(cx + i, y + j, 1, 1) }); cx += (g ? g[0].length : 3) + 1 }
}

/* 系統の印：左上の札。系統の色＋英単語（高さ5ドットの自作文字・白） */
const ABC = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'], ' ': ['.', '.', '.', '.', '.'], G: ['.##', '#..', '#.#', '#.#', '.##'], I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#..', '#..', '#..', '#..', '###'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'], W: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
};
/* パック対象外（既存作品のキャラ）の札 */
const FAN_MARK = { en: 'FAN ART', c: '#8a8a8a' };
const MARK = { y: 6, tx: 5, h: 9 };   // 上の黒線のy・文字の左端・色の部分の高さ
/* 左上に貼る札：左は枠の外側の黒線にくっつけ、右だけ斜め（下へ2ドットごとに1ドットすぼまる）。まわりは黒1ドット */
function drawMark(x, a) {
  const w = [...a.en].reduce((t, ch, i) => t + ABC[ch][0].length + (i ? 1 : 0), 0);
  const base = MARK.tx + w + 2 + (MARK.h - 1 >> 1);   // いちばん上の段の右端
  const right = j => base - (j >> 1);
  x.fillStyle = '#1c1c1c';
  x.fillRect(0, MARK.y, base + 1, 1); x.fillRect(0, MARK.y + MARK.h + 1, right(MARK.h - 1) + 1, 1);
  for (let j = 0; j < MARK.h; j++) x.fillRect(right(j), MARK.y + 1 + j, 1, 1);
  x.fillStyle = a.c;
  for (let j = 0; j < MARK.h; j++) x.fillRect(1, MARK.y + 1 + j, right(j) - 1, 1);
  let cx = MARK.tx; x.fillStyle = a.t || '#ffffff';
  for (const ch of a.en) { const g = ABC[ch]; g.forEach((row, j) => { for (let i = 0; i < row.length; i++)if (row[i] === '#') x.fillRect(cx + i, MARK.y + 3 + j, 1, 1) }); cx += g[0].length + 1 }
}

/* 文字：BestTenDOT 10ドット。ベースラインを8.8に置くとドットが格子にそろう */
const tcan = document.createElement('canvas'); tcan.width = CW; tcan.height = 12;
const tctx = tcan.getContext('2d');
const FONT = '10px "BestTenDOT"';
/* ブラウザの文字描画は、ふちに半透明の点を足すことがある（Windows などで文字がにじむ）。
   そこで10倍の大きさで描いて、各ドットの真ん中が塗られているかだけを見て、1ドットずつ打つ。どの端末でも同じ見た目になる */
const TS = 10;
const bcan = document.createElement('canvas'); bcan.width = CW * TS; bcan.height = 12 * TS;
const bctx = bcan.getContext('2d', { willReadFrequently: true });
function ptext(ctx, str, x, y, color) {
  if (!str) return;
  const w = Math.min(CW - x, CW);
  bctx.clearRect(0, 0, bcan.width, bcan.height); bctx.font = `${10 * TS}px "BestTenDOT"`; bctx.textBaseline = 'alphabetic'; bctx.fillStyle = '#000';
  bctx.fillText(str, 0, 8.8 * TS);
  const d = bctx.getImageData(0, 0, w * TS, 12 * TS).data, rw = w * TS;
  ctx.fillStyle = color;
  for (let j = 0; j < 12; j++) for (let i = 0; i < w; i++) if (d[((j * TS + TS / 2) * rw + i * TS + TS / 2) * 4 + 3] >= 128) ctx.fillRect(x + i, y + j, 1, 1);
}
const NO_HEAD = '。、．，！？」』）ー〜…・';
export function wrapText(str, maxW) {
  tctx.font = FONT; const out = []; let line = '';
  for (const ch of str) {
    if (tctx.measureText(line + ch).width > maxW && line) {
      const sp = line.lastIndexOf(' ');
      if (ch !== ' ' && /[!-~]/.test(ch) && sp > 0) { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch }   // 英語は単語の切れ目で改行
      else if (NO_HEAD.includes(ch) && line.length > 1) { out.push(line.slice(0, -1)); line = line.slice(-1) + ch } else { out.push(line); line = ch === ' ' ? '' : ch }
    } else line += ch;
  }
  if (line) out.push(line); return out;
}
/* カードの背景：星ごとに1枚（締め切り後のカードだけ）。img/bg/star1〜4.png を枠の内側 100×144 ドットに引き伸ばして使う */
const bgImgs = {};
const loadBackgrounds = () => Promise.all([1, 2, 3, 4].map(n => new Promise(res => {
  const im = new Image(); im.onload = () => { bgImgs[n] = im; res() }; im.onerror = res; im.src = new URL(`../img/bg/star${n}.png`, import.meta.url).href;
})));
export const loadCardFont = () => Promise.all([document.fonts.load(FONT, 'あ').catch(() => { }), loadBackgrounds()]);

/* mode: 'full'（締め切り後）/ 'pending'（受付中）/ 'sil'（未所持） */
const cardCache = new Map();
export function clearCardCache() { cardCache.clear(); artCache.clear(); packCache.clear(); backURL = null }
export function cardImg(c, mode) {
  const key = [c.id, mode, c.star, c.attr, c.name, c.text, c.fan, c.p, c.no, c.tno, (c.art || c.px || '').length].join('|');
  if (c.id !== '_p' && cardCache.has(key)) return cardCache.get(key);
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  const full = mode === 'full', sil = mode === 'sil';
  const edge = sil ? cssv('--sil') : cssv('--fg'), ink = cssv('--fg'), quiet = cssv('--muted');
  const at = full && c.star && ATTR_C[c.attr];
  drawFrame(x, edge, full ? c.star : 0);
  const bg = full && c.star && bgImgs[Math.min(c.star, 4)];
  if (bg) x.drawImage(bg, CB, CB, CW - 2 * CB, CH - 2 * CB);   // 小さい画像も枠の内側いっぱいに引き伸ばす
  const A = LAY.art;
  x.drawImage(artCanvas(c, sil), A.x, A.y, N * A.scale, N * A.scale);
  if (full && c.star) drawStars(x, c.star);
  else if (!sil && c.fan) drawMark(x, FAN_MARK);
  if (c.no) drawDigits(x, fmtNo(c), LAY.no.x, LAY.no.y, sil ? quiet : ink);
  if (at) drawMark(x, at);
  ptext(x, sil ? '？？？' : (c.name || '（名前）'), LAY.name.x, LAY.name.y, sil ? quiet : ink);
  if (!sil && c.text) wrapText(c.text, LAY.text.w).slice(0, 2).forEach((l, i) => ptext(x, l, LAY.text.x, LAY.text.y + i * LAY.text.lh, quiet));
  const url = cv.toDataURL(); if (c.id !== '_p') cardCache.set(key, url); return url;
}
export function cardHTML(c, mode = 'full', extra = '', scale = 2) {
  const cls = mode === 'full' ? `s-${esc(c.star)}` : mode === 'sil' ? 'sil' : '';
  const label = mode === 'sil' ? '未所持のカード' : `${c.name}${mode === 'full' ? ` ${c.attr ? ATTR_L[c.attr] : ''} 星${c.star}` : ''}`;
  return `<div class="card ${cls}"${mode !== 'sil' && c.id && c.id !== '_p' ? ` data-cid="${esc(c.id)}"` : ''}><img class="cimg" src="${cardImg(c, mode)}" width="${CW * scale}" height="${CH * scale}" alt="${esc(label)}">${extra}</div>`;
}

/* カードの裏：枠＋市松＋「？」 */
const QMARK = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];
let backURL = null;
export function cardBackURL() {
  if (backURL) return backURL;
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const x = cv.getContext('2d');
  drawFrame(x, cssv('--fg'), 0);
  const b1 = cssv('--back1'), b2 = cssv('--back2');
  for (let py = CB; py < CH - CB; py++) for (let px = CB; px < CW - CB; px++) { x.fillStyle = ((px - CB) / 6 | 0) % 2 ^ ((py - CB) / 6 | 0) % 2 ? b1 : b2; x.fillRect(px, py, 1, 1) }
  const S = 4, qx = (CW - 5 * S) / 2 | 0, qy = 56;
  x.fillStyle = '#ffffff'; x.fillRect(qx - 6, qy - 6, 5 * S + 12, 7 * S + 12);
  x.fillStyle = cssv('--fg'); x.fillRect(qx - 6, qy - 6, 5 * S + 12, 2); x.fillRect(qx - 6, qy + 7 * S + 4, 5 * S + 12, 2); x.fillRect(qx - 6, qy - 6, 2, 7 * S + 12); x.fillRect(qx + 5 * S + 4, qy - 6, 2, 7 * S + 12);
  QMARK.forEach((row, j) => { for (let i = 0; i < 5; i++)if (row[i] === '#') x.fillRect(qx + i * S, qy + j * S, S, S) });
  return backURL = cv.toDataURL();
}

/* パックの袋：96×128ドット。上下はギザギザの留め口、まん中に表紙の絵とテーマ名 */
export const PW = 96, PH = 128;
const packCache = new Map();
export function packURL(p, cover) {
  const key = p.no + '|' + p.name + '|' + (cover ? (cover.art || cover.px || '').slice(0, 80) : '');
  if (packCache.has(key)) return packCache.get(key);
  const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  const fg = cssv('--fg'), mid = '#4a4a4a';
  x.fillStyle = fg; x.fillRect(0, 8, PW, PH - 16);
  x.fillStyle = '#ffffff'; x.fillRect(2, 10, PW - 4, PH - 20);
  x.fillStyle = cssv('--check'); for (let py = 12; py < PH - 12; py += 6) for (let px = 6; px < PW - 4; px += 6) x.fillRect(px, py, 2, 2);
  for (const top of [true, false]) for (let px = 0; px < PW; px++) {
    const tooth = (px >> 2) % 2 === 0;
    for (let k = 0; k < 10; k++) {
      if (k < 2 && !tooth) continue;
      const py = top ? k : PH - 1 - k;
      x.fillStyle = k >= 2 && px % 4 === 1 ? mid : fg; x.fillRect(px, py, 1, 1);
    }
  }
  const ay = 18, ax = (PW - 64) / 2;
  if (cover) { x.fillStyle = '#ffffff'; x.fillRect(ax - 2, ay - 2, 68, 68); x.drawImage(artCanvas(cover), ax, ay, 64, 64) }
  tctx.font = FONT;
  const lines = wrapText(p.name || '', PW - 12).slice(0, 2), ty = lines.length > 1 ? 88 : 94;
  lines.forEach((l, i) => { const w = Math.ceil(tctx.measureText(l).width); ptext(x, l, (PW - w) / 2 | 0, ty + i * 12, fg) });
  const url = cv.toDataURL(); packCache.set(key, url); return url;
}

/* ---------- 星の決め方（管理画面の締め切りで使う） ----------
   系統ごとに：1位が★4、次の約25%が★3、その次の約35%が★2、残りは★1。
   ただし1位の半分以上の票があれば★2以上。票ゼロは必ず★1。 */
export function assignStars(cards, totals) {
  const groups = {};
  for (const c of cards) {
    const t = totals[c.id] || {}; let best = null, bv = 0;
    for (const a of ATTRS) if ((t[a.k] || 0) > bv) { bv = t[a.k]; best = a.k }
    c.attr = best; c.score = bv;
    (groups[best || 'none'] = groups[best || 'none'] || []).push(c);
  }
  for (const [k, list] of Object.entries(groups)) {
    list.sort((a, b) => b.score - a.score);
    const m = list.length - 1, srN = Math.round(m * .25), rN = Math.round(m * .35), top = list[0].score;
    list.forEach((c, i) => { c.star = (k === 'none' || c.score === 0) ? 1 : i === 0 ? 4 : i <= srN ? 3 : (i <= srN + rN || c.score >= top / 2) ? 2 : 1 });
  }
  return cards;
}

/* パックを引く：1〜4枚目 ★1 55% / ★2 30% / ★3 12% / ★4 3%。5枚目は★3以上（★4 20%） */
export function pull(cards) {
  const by = { 1: [], 2: [], 3: [], 4: [], 5: [] }; cards.forEach(c => by[c.star] && by[c.star].push(c));
  const order = { 5: [5, 4, 3, 2, 1], 4: [4, 3, 2, 1], 3: [3, 2, 4, 1], 2: [2, 1, 3, 4], 1: [1, 2, 3, 4] };
  const out = [];
  for (let i = 0; i < 5; i++) {
    const r = Math.random(); const want = i === 4 ? (r < .2 ? 4 : 3) : (r < .03 ? 4 : r < .15 ? 3 : r < .45 ? 2 : 1);
    const k = (i === 4 ? [want, 4, 3, 2, 1] : order[want]).find(k => by[k].length); if (!k) break;   // 5枚目は★3がなければ★4を先に探す
    const pool = by[k]; out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}
