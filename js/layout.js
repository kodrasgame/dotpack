/* どのページにも共通の、上（ロゴ・テーマ・タブ）と下（広告・リンク）。
   各ページの <div class="wrap"> のいちばん最初で読み込む。ページの種類は <body data-page="…"> */
(() => {
  const me = document.currentScript, wrap = me.parentElement, page = document.body.dataset.page;
  const R = me.getAttribute('src').replace(/js\/layout\.js.*$/, '');   // サイトのいちばん上への道すじ（"" か "../"）
  const cur = p => p === page ? ' aria-current="page"' : '';
  me.insertAdjacentHTML('afterend', `<div class="topbar">
    <p class="logo"><a href="${R || './'}"><img src="${R}img/logo.png" width="159" height="36" alt="ドットパック"></a></p>
    <a class="plus" href="${R}make/"${cur('make')}><span aria-hidden="true">＋</span>つくる</a>
  </div>
  <header>
    <div><div class="theme-lbl" id="thLbl"></div><h1 class="theme-name" id="thName"></h1></div>
    <div class="theme-meta" id="thMeta"></div>
  </header>
  <nav><a href="${R || './'}"${cur('vote')}>投票</a><a href="${R}pack/"${cur('pack')}>パック</a><a href="${R}dex/"${cur('dex')}>図鑑</a></nav>`);
  document.body.insertAdjacentHTML('beforeend', '<div id="toast" hidden></div>');
  const info = ['terms', 'contact', 'account'].includes(page);
  document.addEventListener('DOMContentLoaded', () => wrap.insertAdjacentHTML('beforeend', (info ? '' : `<aside class="ad">
    <span class="ad-lbl">広告</span><span>広告募集中</span><a class="linkbtn" href="${R}contact/?t=ad">広告のご依頼はこちら</a>
  </aside>`) + `<footer class="foot"><a class="linkbtn" href="${R}terms/">利用規約</a><a class="linkbtn" href="${R}account/">アカウント</a><a class="linkbtn" href="${R}contact/">お問い合わせ</a></footer>`));
  /* 「もどる」：このサイトから来たなら1つ前へ、そうでなければ投票ページへ */
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-back]')) return;
    if (document.referrer.startsWith(location.origin) && history.length > 1) history.back(); else location.href = R || './';
  });
})();
