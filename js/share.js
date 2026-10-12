/* カードを X でシェアする。スマホは画像つきで共有（X のアプリを選べる）、パソコンは X の投稿画面をカードのページのリンクつきで開く */
import { CW, CH, cardImg, fmtNo } from './cards.js';
import { ROOT, cardPath } from './core.js';

const mode = c => c.star ? 'full' : 'pending';
const fileName = c => `dotpack-${fmtNo(c).slice(3)}.png`;
/* カードの画像を4倍に拡大したPNG（ドットがぼやけないように） */
async function cardPNG(c, scale = 4) {
  const im = new Image(); im.src = cardImg(c, mode(c)); await im.decode();
  const cv = document.createElement('canvas'); cv.width = CW * scale; cv.height = CH * scale;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(res, 'image/png'));
}
export async function shareCard(c, mine) {
  const url = ROOT + cardPath(c);
  const text = mine ? `ドット絵カード「${c.name}」を描きました！\n#ドットパック` : `「${c.name}」${c.anon || !c.by ? '' : ` by ${c.by}`}\n#ドットパック`;
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare) {
    try {
      const file = new File([await cardPNG(c)], fileName(c), { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: text + '\n' + url }); return }
    } catch (e) { if (e.name === 'AbortError') return }
  }
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
}
export async function saveCardImage(c) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(await cardPNG(c)); a.download = fileName(c);
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
