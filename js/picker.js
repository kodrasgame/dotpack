/* 色選び：外側の輪で色合い、内側の四角で鮮やかさ（左右）と明るさ（上下）。ページの中に組み込む（別窓を開かない）
   makePicker(canvas, onInput) → { set(hex), get(), hsv(), part({ s | v }) }。onInput(hex) は動かしているあいだずっと呼ばれる */
const SIZE = 168, RO = SIZE / 2, RI = RO - 16, SQ = Math.floor(RI * Math.SQRT2) - 8, S0 = (SIZE - SQ) / 2;

export function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, v: mx };
}
export function hsvToHex({ h, s, v }) {
  const f = k => { const t = (k + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(t, 4 - t, 1))) * 255) };
  return '#' + [f(5), f(3), f(1)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* 白黒にしたときの明るさ（0〜1）。よくある白黒変換と同じ重み（赤 .299・緑 .587・青 .114） */
export function luma(hex) { const n = parseInt(hex.slice(1), 16); return ((n >> 16 & 255) * .299 + (n >> 8 & 255) * .587 + (n & 255) * .114) / 255 }
/* 色合い h で、白黒にしたときの明るさが L になる色。鮮やかさは s のまま（明るすぎて届かないときだけ s を下げる）。
   HSV では v に比例して明るさが変わり、v=1 では s を下げるほど白に近づくので、計算でぴったり決まる */
export function sameLuma(h, s, L) {
  const full = luma(hsvToHex({ h, s, v: 1 }));
  if (full >= L) return { h, s, v: full ? L / full : 0 };
  const pure = luma(hsvToHex({ h, s: 1, v: 1 }));
  return { h, s: pure < 1 ? Math.max(0, Math.min(s, (1 - L) / (1 - pure))) : 0, v: 1 };
}

export function makePicker(cv, onInput) {
  const dpr = Math.max(1, Math.round(devicePixelRatio || 1));
  cv.width = cv.height = SIZE * dpr; cv.style.width = cv.style.height = SIZE + 'px';
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  let hsv = { h: 0, s: 0, v: 0 }, drag = null;

  function draw() {
    x.clearRect(0, 0, SIZE, SIZE);
    // 輪（色合い）
    const cg = x.createConicGradient(-Math.PI / 2, RO, RO);
    for (let i = 0; i <= 6; i++) cg.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    x.beginPath(); x.arc(RO, RO, RO, 0, Math.PI * 2); x.arc(RO, RO, RI, 0, Math.PI * 2, true); x.fillStyle = cg; x.fill('evenodd');
    // 四角（鮮やかさ・明るさ）
    const gx = x.createLinearGradient(S0, 0, S0 + SQ, 0); gx.addColorStop(0, '#fff'); gx.addColorStop(1, `hsl(${hsv.h},100%,50%)`);
    x.fillStyle = gx; x.fillRect(S0, S0, SQ, SQ);
    const gy = x.createLinearGradient(0, S0, 0, S0 + SQ); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, '#000');
    x.fillStyle = gy; x.fillRect(S0, S0, SQ, SQ);
    // 目印（白黒の二重の輪）
    const a = (hsv.h - 90) * Math.PI / 180, rm = (RO + RI) / 2;
    mark(RO + Math.cos(a) * rm, RO + Math.sin(a) * rm, 6);
    mark(S0 + hsv.s * SQ, S0 + (1 - hsv.v) * SQ, 5);
  }
  function mark(px, py, r) {
    x.lineWidth = 2;
    x.strokeStyle = '#000'; x.beginPath(); x.arc(px, py, r + 1, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#fff'; x.beginPath(); x.arc(px, py, r - 1, 0, Math.PI * 2); x.stroke();
  }
  function pos(e) { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * SIZE / b.width, (e.clientY - b.top) * SIZE / b.height] }
  function apply(e) {
    const [px, py] = pos(e);
    if (drag === 'h') hsv.h = (Math.atan2(py - RO, px - RO) * 180 / Math.PI + 90 + 360) % 360;
    else { hsv.s = Math.min(1, Math.max(0, (px - S0) / SQ)); hsv.v = Math.min(1, Math.max(0, 1 - (py - S0) / SQ)) }
    draw(); onInput(hsvToHex(hsv));
  }
  cv.addEventListener('pointerdown', e => {
    if (cv.getAttribute('aria-disabled') === 'true') return;
    const [px, py] = pos(e), r = Math.hypot(px - RO, py - RO);
    if (r >= RI - 4 && r <= RO + 2) drag = 'h';
    else if (px >= S0 - 6 && px <= S0 + SQ + 6 && py >= S0 - 6 && py <= S0 + SQ + 6) drag = 'sv';
    else return;
    cv.setPointerCapture(e.pointerId); e.preventDefault(); apply(e);
  });
  cv.addEventListener('pointermove', e => { if (drag) apply(e) });
  const end = () => { if (drag) { drag = null; cv.dispatchEvent(new Event('change')) } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

  return {
    /* 外から色を入れる（灰色などで色合いが決まらないときは、今の色合いを残す） */
    set(hex) { if (hex === hsvToHex(hsv)) return draw(); const n = hexToHsv(hex); if (n.v === 0) { n.h = hsv.h; n.s = hsv.s } else if (n.s === 0) n.h = hsv.h; hsv = n; draw() },
    get: () => hsvToHex(hsv),
    hsv: () => ({ ...hsv }),
    /* 一部だけ変える（明度だけ・彩度だけのバー用）。例：part({ v: .5 }) */
    part(p) { Object.assign(hsv, p); draw(); onInput(hsvToHex(hsv)) },   // { h, s, v } のどれか
  };
}
