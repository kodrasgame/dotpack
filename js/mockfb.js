/* 確認モード用：Firebase の代わりにブラウザの中だけで動く簡易データベース。
   index.html?mock で使えます。本番では使われません。 */
import { ADMIN_UID } from './config.js';
const KEY='mockdb';
const load=()=>JSON.parse(localStorage.getItem(KEY)||'{}');const save=d=>localStorage.setItem(KEY,JSON.stringify(d));
export const CONFIGURED=true;export const app={};export const db={};
export class Timestamp{constructor(ms){this.ms=ms}toMillis(){return this.ms}toDate(){return new Date(this.ms)}static fromMillis(m){return new Timestamp(m)}}
export const serverTimestamp=()=>({__server:true});
export const increment=n=>({__inc:n});
const applyInc=(old,x)=>{const o={...x};for(const k in o)if(o[k]&&o[k].__inc!==undefined)o[k]=((old&&old[k])||0)+o[k].__inc;return o};
let clock=Date.now();const now=()=>++clock;
const enc=v=>{if(v&&v.__server)return{__ts:now()};if(v instanceof Timestamp)return{__ts:v.ms};if(Array.isArray(v))return v.map(enc);if(v&&typeof v==='object'){const o={};for(const k in v)o[k]=enc(v[k]);return o}return v};
const dec=v=>{if(v&&v.__ts!==undefined)return new Timestamp(v.__ts);if(Array.isArray(v))return v.map(dec);if(v&&typeof v==='object'){const o={};for(const k in v)o[k]=dec(v[k]);return o}return v};
const rid=()=>Math.random().toString(36).slice(2,12);
export function collection(_d,...s){return{type:'col',path:s.join('/')}}
export function doc(a,...s){if(a&&a.type==='col')return{type:'doc',path:a.path+'/'+(s[0]||rid())};return{type:'doc',path:s.join('/')}}
export function query(c,...cons){return{type:'q',path:c.path,cons}}
export const where=(f,op,v)=>({k:'w',f,op,v}),orderBy=(f,dir)=>({k:'o',f,dir}),limit=n=>({k:'l',n}),startAfter=s=>({k:'s',s});
const snapOf=(path,data)=>({id:path.split('/').pop(),exists:()=>data!==undefined,data:()=>data===undefined?undefined:dec(data),ref:{path}});
export async function getDoc(r){return snapOf(r.path,load()[r.path])}
const val=v=>v&&v.__ts!==undefined?v.__ts:(v instanceof Timestamp?v.ms:v);
export async function getDocs(q){const d=load();const depth=q.path.split('/').length+1;
  let rows=Object.entries(d).filter(([p])=>p.startsWith(q.path+'/')&&p.split('/').length===depth);
  for(const c of q.cons||[]){if(c.k==='w')rows=rows.filter(([,x])=>{const a=val(x[c.f]),b=val(c.v);return c.op==='=='?a===b:c.op==='>'?a>b:true});
    if(c.k==='o')rows.sort(([pa,a],[pb,b])=>{const x=val(a[c.f]),y=val(b[c.f]);return (x===y?(pa>pb?1:-1):x>y?1:-1)*(c.dir==='desc'?-1:1)});
    if(c.k==='s'){const i=rows.findIndex(([p])=>p===c.s.ref.path);rows=rows.slice(i+1)}if(c.k==='l')rows=rows.slice(0,c.n)}
  const docs=rows.map(([p,x])=>snapOf(p,x));return{docs,empty:!docs.length,size:docs.length,forEach:f=>docs.forEach(f)}}
export async function setDoc(r,data,opt){const d=load();d[r.path]=opt&&opt.merge?{...(d[r.path]||{}),...enc(data)}:enc(data);save(d)}
export async function updateDoc(r,data){const d=load();if(!d[r.path])throw new Error('no doc');d[r.path]={...d[r.path],...enc(applyInc(d[r.path],data))};save(d)}
export async function getCountFromServer(q){const s=await getDocs(q);return{data:()=>({count:s.size})}}
export async function addDoc(c,data){const r=doc(c);await setDoc(r,data);return r}
export async function runTransaction(_d,fn){return fn({get:getDoc,update:(r,x)=>{const d=load();d[r.path]={...d[r.path],...enc(x)};save(d)},set:(r,x)=>{const d=load();d[r.path]=enc(x);save(d)}})}
export function writeBatch(){const ops=[];return{update:(r,x)=>ops.push(['u',r,x]),set:(r,x)=>ops.push(['s',r,x]),commit:async()=>{for(const[t,r,x]of ops)await(t==='u'?updateDoc(r,x):setDoc(r,x))}}}
/* 認証 */
const subs=[];export const auth={currentUser:null};
const emit=()=>subs.forEach(f=>f(auth.currentUser));
const mkUser=(uid,google,email)=>({uid,isAnonymous:!google,email:email||null,providerData:google?[{providerId:'google.com'}]:[],getIdToken:async()=>''});
export function onAuthStateChanged(_a,cb){subs.push(cb);const u=localStorage.getItem('mockuser');if(u&&!auth.currentUser){const o=JSON.parse(u);auth.currentUser=mkUser(o.uid,o.google,o.email)}setTimeout(()=>cb(auth.currentUser),0)}
export async function signInAnonymously(){auth.currentUser=mkUser('anon_'+rid(),false);localStorage.setItem('mockuser',JSON.stringify({uid:auth.currentUser.uid}));emit()}
export class GoogleAuthProvider{static credentialFromError(){return null}}
export async function signInWithPopup(){auth.currentUser=mkUser(ADMIN_UID,true,'admin@example.com');localStorage.setItem('mockuser',JSON.stringify({uid:auth.currentUser.uid,google:true,email:'admin@example.com'}));emit();return{user:auth.currentUser}}
export async function linkWithPopup(u){u.providerData.push({providerId:'google.com'});u.isAnonymous=false;u.email='me@example.com';localStorage.setItem('mockuser',JSON.stringify({uid:u.uid,google:true,email:u.email}))}
export async function signInWithCredential(){}
export async function signOut(){auth.currentUser=null;localStorage.removeItem('mockuser');emit()}
