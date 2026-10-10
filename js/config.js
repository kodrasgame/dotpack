/* ===== ここを自分の値に書き換える =====
   firebaseConfig は Firebase コンソール → プロジェクトの設定 → マイアプリ（ウェブ）に出ている値。
   公開されても問題ない値です（守りはセキュリティルールで行います）。 */
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  appId: 'YOUR_APP_ID',
};

/* 管理者（もとはしさん）の Google アカウントの UID。
   admin.html に Google でログインすると画面に表示されます。firestore.rules にも同じ値を書きます。 */
export const ADMIN_UID = 'YOUR_ADMIN_UID';

/* パックを開けられる回数
   PACK_CHARGE_HOURS 時間ごとに1回ふえて、PACK_MAX 回までたまる。
   ほかの人の作品に投票すると、1枚につき PACK_PER_VOTE 回ふえる（こちらは上限なし）。 */
export const PACK_CHARGE_HOURS = 3;
export const PACK_MAX = 4;
export const PACK_PER_VOTE = 1;
