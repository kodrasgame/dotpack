/* Firebase の読み込み（バージョンを固定）。Firestore は読み書きだけの軽い版（lite）を使う。
   バージョンを変えるときは、各ページの head にある modulepreload の3行も同じ番号にする（先に取りに行かせる指定） */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const CONFIGURED = !String(firebaseConfig.apiKey).startsWith('YOUR_');

export {
  onAuthStateChanged, signInAnonymously, GoogleAuthProvider, linkWithPopup, signInWithPopup,
  signInWithCredential, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
export {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit,
  runTransaction, serverTimestamp, writeBatch, startAfter, increment, getCount as getCountFromServer
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js';
