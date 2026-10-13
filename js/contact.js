/* お問い合わせページ。?t=ad で広告のご依頼、?no=0012-2 で作品番号を入れた状態で開く */
import { db, doc, collection, query, where, limit, getDocs, writeBatch, serverTimestamp } from './fb.js';
import { $, fmtNo, parseNo, cardHTML } from './cards.js';
import { S, store, boot, visible, capHTML, cardsCol, toCard, loadPack } from './core.js';

/* ---------- お問い合わせ ---------- */
const REASONS = {
  del: [['own', '自分の作品を消したい（投稿した本人）'], ['rights', '自分の作品や、権利を持つキャラクターが無断で使われている'], ['copy', '他人の作品のトレース・転載に見える'], ['nsfw', '性的・暴力的・差別的な内容'], ['abuse', '誹謗中傷や個人情報が含まれている'], ['spam', 'テーマと関係ない・荒らし']],
  hide: [['quit', '名前を出したくなくなった'], ['trouble', 'トラブルを避けたい'], ['other', 'その他']],
};
const cType = () => document.querySelector('input[name="ctype"]:checked').value;
let cFound = null, cSeq = 0;
const missed = new Set();   // 探して無かった番号（種類や理由を選び直すたびに読みに行かないように）
async function findNo(v) {
  const n = parseNo(v); if (!n) return null;
  if (S.theme && n.tno === S.theme.no) {
    const hit = [...S.cards.values()].find(c => c.no === n.no);
    if (hit) return visible(hit) ? hit : null;
    if (missed.has(n.no)) return null;
    try {
      const snap = await getDocs(query(cardsCol(), where('no', '==', n.no), limit(1))); if (snap.empty) { missed.add(n.no); return null }
      const c = toCard(snap.docs[0]); S.cards.set(c.id, c); return visible(c) ? c : null;
    } catch (e) { return null }
  }
  if (!S.packIndex.find(p => p.no === n.tno)) return null;
  try { const p = await loadPack(n.tno); return p.cards.find(c => c.no === n.no) || null } catch (e) { return null }
}
async function renderContact() {
  const t = cType();
  $('#cWork').hidden = t === 'ad'; $('#cAd').hidden = t !== 'ad';
  if (t !== 'ad') {
    if ($('#cReason').dataset.t !== t) { $('#cReason').innerHTML = '<option value="">選んでください</option>' + REASONS[t].map(([k, l]) => `<option value="${k}">${l}</option>`).join(''); $('#cReason').dataset.t = t }
    const my = ++cSeq; const c = await findNo($('#cNo').value); if (my !== cSeq) return;
    cFound = c; $('#cCard').innerHTML = c ? cardHTML(c, c.star ? 'full' : 'pending') + capHTML(c) : '';
  }
  $('#cErr').textContent = '';
}
function openContact(t) { $('#ct-' + (t || 'del')).checked = true; $('#cForm').hidden = false; $('#cDone').hidden = true; renderContact() }
document.querySelectorAll('input[name="ctype"]').forEach(r => r.onchange = renderContact);
$('#cNo').oninput = renderContact;
let lastCType = 'del';
$('#cForm').addEventListener('submit', async e => {
  e.preventDefault(); const t = cType(); const err = m => { $('#cErr').textContent = m };
  if (!S.user) return err('接続できていません。時間をおいてもう一度お試しください');
  let req = { type: t, uid: S.user.uid, at: serverTimestamp(), done: false };
  if (t === 'ad') {
    const name = $('#cName').value.trim(), mail = $('#cMail').value.trim(), body = $('#cBody').value.trim();
    if (!name) return err('お名前・会社名を入れてください');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return err('メールアドレスの形が正しくありません');
    if (!body) return err('ご依頼の内容を入れてください');
    Object.assign(req, { name: name.slice(0, 60), mail: mail.slice(0, 120), body: body.slice(0, 300) });
  } else {
    const c = cFound;
    if (!c) return err('その作品番号のカードが見つかりません');
    if (!$('#cReason').value) return err('理由を選んでください');
    if (t === 'hide' && c.uid && c.uid !== S.user.uid) return err('作者名の非表示は、その作品を投稿したアカウントからのみ依頼できます');
    Object.assign(req, { tid: c.tid, cid: c.id, no: fmtNo(c), reason: $('#cReason').value });
  }
  if (Date.now() - store.get('dp-lastreq', 0) < 60000) return err('続けて送るときは、1分ほどあけてください');
  try {
    /* 続けて送れる間隔の確認用に、limits にも送った時刻を入れる（ルールで確かめる） */
    const b = writeBatch(db); b.set(doc(collection(db, 'requests')), req); b.set(doc(db, 'limits', S.user.uid), { req: serverTimestamp() }, { merge: true });
    await b.commit(); store.set('dp-lastreq', Date.now());
  }
  catch (e2) { return err(t === 'hide' ? '送信できませんでした。作者名の非表示は、その作品を投稿したアカウントからのみ依頼できます' : '送信できませんでした。時間をおいてもう一度お試しください') }
  lastCType = t;
  $('#cDoneMsg').textContent = t === 'ad' ? '送信しました。内容を確認して、メールでご連絡します。' : `送信しました（${req.no}）。運営者が確認して対応します。個別の返信はありません。`;
  $('#cForm').reset(); $('#cForm').hidden = true; $('#cDone').hidden = false;
});
$('#cAgain').onclick = () => openContact(lastCType);

{
  const q = new URLSearchParams(location.search);
  if (q.get('no')) $('#cNo').value = q.get('no').slice(0, 12);
  $('#ct-' + (['del', 'hide', 'ad'].includes(q.get('t')) ? q.get('t') : 'del')).checked = true;
}
boot({ render: renderContact });
