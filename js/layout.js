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
  <nav><a href="${R || './'}"${cur('vote')}>投票</a><a href="${R}pack/"${cur('pack')}>パック</a><a href="${R}dex/"${cur('dex')}>図鑑</a><a class="nav-pk" id="navPk" href="${R}pack/"></a></nav>`);
  document.body.insertAdjacentHTML('beforeend', '<div id="toast" hidden></div>');
  const info = ['terms', 'contact', 'account'].includes(page);
  document.addEventListener('DOMContentLoaded', () => wrap.insertAdjacentHTML('beforeend', (info ? '' : `<aside class="ad">
    <span class="ad-lbl">広告</span><span>広告募集中</span><a class="linkbtn" href="${R}contact/?t=ad">広告のご依頼はこちら</a>
  </aside>`) + `<footer class="foot"><a class="linkbtn" href="${R}terms/">利用規約</a><a class="linkbtn" href="${R}account/">アカウント</a><a class="linkbtn" href="${R}contact/">お問い合わせ</a><button class="linkbtn" data-howto>あそびかた</button></footer>`));
  /* あそびかた（4コマ）：初めて来たときだけ自動で出す。あとからは下の「あそびかた」で。
     中身は開くときに作る（絵 img/howto/1〜4.png も、そのとき初めて読み込む）。見たかどうかはこのブラウザに覚えるだけ */
  const HT = [['みんなでつくるカードパック', '毎月テーマが決まるよ'], ['カードを描こう', '32x32 のドット絵で、テーマに合わせて'],
    ['みんなのカードに投票しよう', '投票すると、パックを開けられる回数が増える'], ['票の数でレアリティが決まる', '月末に集計して、翌月からパックで引けるよ']];
  function howto() {
    let m = document.getElementById('howto');
    if (!m) {
      document.body.insertAdjacentHTML('beforeend', `<div id="howto" class="ht" role="dialog" aria-modal="true" aria-labelledby="htTtl"><div class="ht-in">
        <h2 id="htTtl">ドットパックってなに？</h2>
        <ol class="ht-grid">${HT.map(([a, b], i) => `<li><img src="${R}img/howto/${i + 1}.png" width="240" height="180" alt=""><b>${a}</b><small>${b}</small></li>`).join('')}</ol>
        <button class="btn primary" data-htclose>はじめる</button></div></div>`);
      m = document.getElementById('howto');
      m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-htclose]')) close() });   // 外側か「はじめる」で閉じる
    }
    m.hidden = false; document.body.style.overflow = 'hidden';
  }
  function close() {
    document.getElementById('howto').hidden = true; document.body.style.overflow = '';
    try { localStorage.setItem('dp-howto', '1') } catch (e) { }
  }
  document.addEventListener('keydown', e => { const m = document.getElementById('howto'); if (e.key === 'Escape' && m && !m.hidden) close() });
  document.addEventListener('click', e => { if (e.target.closest('[data-howto]')) howto() });
  let seen = true; try { seen = !!localStorage.getItem('dp-howto') } catch (e) { }   // 覚えられないブラウザでは毎回出さない
  if (!seen && page !== 'terms') document.addEventListener('DOMContentLoaded', howto);
  /* 「もどる」：このサイトから来たなら1つ前へ、そうでなければ投票ページへ */
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-back]')) return;
    if (document.referrer.startsWith(location.origin) && history.length > 1) history.back(); else location.href = R || './';
  });
})();
