/* Firebase の読み込み。
   URL に ?mock を付けると、Firebase につながない「確認モード」になる（?mock=0 で解除）。
   確認モードはこのパソコンで開いたとき（localhost など）だけ。公開したサイトでは ?mock を付けても動かない。 */
let mockOn = false;
const LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
if (LOCAL) try {
  const q = new URLSearchParams(location.search);
  if (q.has('mock')) localStorage.setItem('dp-mock', q.get('mock') === '0' ? '0' : '1');
  mockOn = localStorage.getItem('dp-mock') === '1';
} catch (e) { }
export const MOCK = mockOn;
const m = MOCK ? await import('./mockfb.js') : await import('./fbreal.js');
export const {
  auth, db, CONFIGURED,
  onAuthStateChanged, signInAnonymously, GoogleAuthProvider, linkWithPopup, signInWithPopup, signInWithCredential, signOut,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit,
  runTransaction, serverTimestamp, writeBatch, startAfter, increment, getCountFromServer
} = m;

if (MOCK) {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:50;background:#1c1c1c;color:#fff;font-size:20px;line-height:1.2;padding:6px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
  bar.innerHTML = '確認モード（Firebaseにつながっていません。データはこのブラウザの中だけ）<button style="font:inherit;background:#fff;color:#1c1c1c;border:0;padding:0 8px">確認用データを消す</button><a style="color:#fff" href="?mock=0">確認モードをやめる</a>';
  bar.querySelector('button').onclick = () => { for (const k of Object.keys(localStorage)) if (k.startsWith('mock') || k.startsWith('dp-')) localStorage.removeItem(k); localStorage.setItem('dp-mock', '1'); location.reload() };
  document.body.appendChild(bar);
  const pad = () => document.body.style.paddingBottom = bar.offsetHeight + 'px'; pad(); addEventListener('resize', pad);
}
