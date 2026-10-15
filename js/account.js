/* アカウントページ（作者名とGoogle連携） */
import { auth, GoogleAuthProvider, linkWithPopup, signInWithCredential, signOut } from './fb.js';
import { $ } from './cards.js';
import { S, ROOT, V, store, toast, boot, isGoogle, saveOwned, pushUser, ownedPending, mergeOwnedFromServer, flushVotes, saveLocalVotes } from './core.js';

/* ---------- アカウント ---------- */
function renderAccount() {
  if (!S.user) return;
  $('#aMine').href = ROOT + 'author/?u=' + encodeURIComponent(S.user.uid);
  $('#aName').value = store.get('dp-name', '');
  const g = isGoogle();
  $('#aStatus').textContent = g ? `Googleアカウント（${S.user.email || ''}）と連携しています。集めたカードはどの端末でも見られます。` : 'まだGoogleアカウントと連携していません。いまのデータはこの端末のブラウザにだけ保存されています。';
  $('#aGoogle').hidden = g; $('#aLogout').hidden = !g;
}
$('#aName').oninput = () => { store.set('dp-name', $('#aName').value.trim().slice(0, 12)); if (isGoogle()) saveOwned() };
$('#aGoogle').onclick = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await linkWithPopup(auth.currentUser, provider);
  } catch (e) {
    if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
      // このGoogleアカウントは別の端末ですでに使われている → そちらに切り替える
      const cred = GoogleAuthProvider.credentialFromError(e);
      if (!cred) { toast('連携できませんでした'); return }
      /* いまの匿名アカウントの票は空にして、切り替え先へ持っていく（同じ人の票が2回数えられないように） */
      await flushVotes();
      if (S.theme && Object.keys(S.myVotes).length) {
        V.carry = { ...S.myVotes }; S.myVotes = {}; saveLocalVotes(true);
        V.dirty = true; await flushVotes();
        if (V.dirty) { S.myVotes = V.carry; V.carry = null; saveLocalVotes(true); toast('連携できませんでした。時間をおいてもう一度お試しください'); return }
      }
      try { await signInWithCredential(auth, cred) }
      catch (e2) {
        console.warn(e2);
        if (V.carry) { S.myVotes = V.carry; V.carry = null; saveLocalVotes(true); V.dirty = true; flushVotes() }
        toast('連携できませんでした'); return;
      }
      // 読み込み直し（カード・票・集めたカード）は onAuthStateChanged がアカウントの切り替えを見て行う
      toast('Googleアカウントに切り替えました'); return;
    } else if (e.code !== 'auth/popup-closed-by-user') { console.warn(e); toast('連携できませんでした'); return }
    else return;
  }
  await auth.currentUser.getIdToken(true);
  S.user = auth.currentUser;
  await mergeOwnedFromServer();
  V.dirty = true; await flushVotes();
  renderAccount(); toast('Googleアカウントと連携しました');
};
$('#aLogout').onclick = async () => {
  await flushVotes(); if (ownedPending()) await pushUser();
  await signOut(auth);
  /* 集めたカードはGoogleアカウントの方に残っている。この端末の控えは消して、次に使う人のデータと混ざらないようにする */
  S.owned = {}; store.set('dp-owned', {});
  toast('ログアウトしました');
};

boot({ render: renderAccount, votes: true });
