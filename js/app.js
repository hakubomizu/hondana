/* =====================================================================
 * app.js ― アプリ本体（画面の表示と操作）
 *
 * このファイルの構成
 *   1. 共通の準備（状態・補助関数・お知らせ表示）
 *   2. 画面の切り替え（ルーター）
 *   3. 一覧画面（検索・並べ替え・オリジナルのドラッグ）
 *   4. 詳細画面
 *   5. 登録・編集画面（バーコード読み取り・書誌検索・写真・重複チェック）
 *   6. 設定画面（ジャンル管理・バックアップ・書誌検索の設定）
 *   7. 起動処理
 *   8. シリーズ画面（シリーズの一覧・シリーズごとの本・本の選択）
 *   9. 説明ページ（中継プログラムの作り方）
 *
 * 画面の切り替えは URL の「#」以降（ハッシュ）で行います。
 *   #/            … 一覧
 *   #/book/本のID … 詳細
 *   #/add         … 新しい本の登録
 *   #/edit/本のID … 編集
 *   #/settings    … 設定
 *   #/help/proxy              … 中継プログラムの作り方の説明
 *   #/series                  … シリーズの一覧
 *   #/series/シリーズ名       … そのシリーズの本
 *   #/series/シリーズ名/pick  … そのシリーズに入れる本の選択
 * ページ全体を読み込み直さずに <main id="view"> の中身だけを書き換えるので、
 * 電波が無い場所でも画面を移動できます。
 * ===================================================================== */

const App = (() => {

  /* =================================================================
   * 1. 共通の準備
   * ================================================================= */

  /** 要素を 1 つ探す短縮記法。$('#id') のように使う */
  const $ = (selector, root) => (root || document).querySelector(selector);

  const view = $('#view'); // 各画面の中身を書き込む場所

  // 読書状態の「内部の値」と「画面に出す言葉」の対応
  const STATUS = { unread: '未読', reading: '読書中', done: '読了' };

  // 並べ替えの種類。[内部の値, 画面に出す言葉]
  // この配列の順番が、一覧画面のボタンの左からの並び順になる
  const SORTS = [
    ['yomi', '五十音順'],
    ['new', '登録順'],
    ['genre', 'ジャンル別'],
    ['custom', 'オリジナル']   // 利用者がドラッグで決めた順番
  ];

  // 日本語の順序で文字列を比べる道具。numeric:true で「2巻」が「10巻」より前に来る
  const collator = new Intl.Collator('ja', { numeric: true });

  // アプリが覚えておく現在の状態
  const state = {
    books: [],       // 全ての本（一覧用。写真本体は含まない）
    genres: [],      // ジャンル名の一覧（設定画面での並び順）
    series: [],      // 利用者が名付けたシリーズ名の一覧
    sort: 'yomi',    // 現在の並べ替え
    query: '',       // 検索欄に入力されている文字
    navIds: [],      // 直前に表示した一覧での本の並び順（詳細画面で前後の本へ移るときに使う）
    listScroll: 0,   // 一覧画面のスクロール位置（詳細から戻ったとき元の位置に戻すため）
    route: ''        // 今どの画面にいるか
  };

  // 登録・編集画面で作業中のデータ（その画面にいる間だけ使う）
  let form = null;

  /* ---------------------------------------------------------------
   * 画面下に短いお知らせを出す（数秒で自動的に消える）
   * --------------------------------------------------------------- */
  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  /* ---------------------------------------------------------------
   * 画面上部のバー（戻るリンク・画面名・右側のリンク）の HTML を作る
   * --------------------------------------------------------------- */
  function barHtml(options) {
    const back = options.backHref
      ? `<a class="bar-back" href="${options.backHref}">${Util.esc(options.backLabel)}</a>`
      : '<span></span>';
    const right = options.rightHtml || '<span></span>';
    return `<header class="bar">${back}<h1 class="bar-title">${Util.esc(options.title)}</h1>${right}</header>`;
  }

  /** 題名の表示用 HTML（巻数があれば題名の後ろに添える） */
  function titleHtml(book) {
    const volume = book.volume ? ` <span class="vol">${Util.esc(book.volume)}</span>` : '';
    return Util.esc(book.title) + volume;
  }

  /** ジャンルの色を CSS に渡すための style 属性を作る（未分類は色なし） */
  function spineStyle(genre) {
    const hue = Util.genreHue(genre);
    return hue === null ? '' : ` style="--h:${hue}"`;
  }

  /** 五十音順の比較。よみが同じなら巻数の順にする */
  function compareYomi(a, b) {
    return (
      collator.compare(Util.sortKey(a), Util.sortKey(b)) ||
      collator.compare(a.volume || '', b.volume || '')
    );
  }

  /* =================================================================
   * 2. 画面の切り替え（ルーター）
   * ================================================================= */

  /* ---------------------------------------------------------------
   * URL のハッシュを見て、対応する画面を表示する。
   * ハッシュが変わるたびに（リンクを押す・戻るボタンを押すなど）呼ばれる。
   * --------------------------------------------------------------- */
  async function route() {
    // 一覧画面から離れるときは、スクロール位置を覚えておく
    if (state.route === 'list') state.listScroll = window.scrollY;

    // 別の画面へ移るときは、開いたままのカメラや拡大表示を閉じる
    closeScanner();
    hideViewer();
    form = null;

    const hash = location.hash.replace(/^#\/?/, ''); // 例：「book/abc123」
    const [name, id, sub] = hash.split('/');

    try {
      if (name === 'book' && id) {
        state.route = 'detail';
        await renderDetail(id);
        window.scrollTo(0, 0);
      } else if (name === 'add') {
        state.route = 'form';
        await renderForm(null);
        window.scrollTo(0, 0);
      } else if (name === 'edit' && id) {
        state.route = 'form';
        await renderForm(id);
        window.scrollTo(0, 0);
      } else if (name === 'settings') {
        state.route = 'settings';
        await renderSettings();
        window.scrollTo(0, 0);
      } else if (name === 'help') {
        state.route = 'help';
        await renderHelpProxy();
        window.scrollTo(0, 0);
      } else if (name === 'series') {
        // シリーズ名は URL に入れるとき記号に変換（エンコード）しているので、元に戻して使う
        state.route = 'series';
        if (id && sub === 'pick') await renderSeriesPick(decodeURIComponent(id));
        else if (id) await renderSeriesDetail(decodeURIComponent(id));
        else await renderSeriesList();
        window.scrollTo(0, 0);
      } else {
        state.route = 'list';
        await renderList();
        window.scrollTo(0, state.listScroll);
      }
    } catch (err) {
      console.error(err);
      view.innerHTML =
        barHtml({ title: '本棚', backHref: '#/', backLabel: '一覧' }) +
        '<p class="empty">画面を表示できませんでした。ページを読み込み直してください。</p>';
    }
  }

  /** 指定した本が見つからないときの画面 */
  function renderNotFound() {
    view.innerHTML =
      barHtml({ title: '本棚', backHref: '#/', backLabel: '一覧' }) +
      '<p class="empty">この本は見つかりませんでした。削除された可能性があります。</p>';
  }

  /* =================================================================
   * 3. 一覧画面
   * ================================================================= */

  /* ---------------------------------------------------------------
   * 一覧画面の枠（検索欄・並べ替えの切り替え・登録ボタン）を表示する。
   * 本の並びそのものは drawList() が描く。
   * --------------------------------------------------------------- */
  async function renderList() {
    state.books = await DB.getAllBooks();

    const sortButtons = SORTS.map(([value, label]) =>
      `<button type="button" class="seg-btn${state.sort === value ? ' is-on' : ''}" data-sort="${value}"
        aria-pressed="${state.sort === value}">${label}</button>`
    ).join('');

    view.innerHTML = `
      <header class="bar bar-home">
        <h1 class="home-title">本棚</h1>
        <span class="home-count">${state.books.length} 冊</span>
        <a class="bar-link" href="#/settings">設定</a>
      </header>
      <div class="tools">
        <input type="search" id="q" class="search" placeholder="題名・作者・出版社で検索"
          value="${Util.esc(state.query)}" aria-label="本を検索" autocomplete="off">
        <div class="seg" role="group" aria-label="並べ替え">${sortButtons}</div>
        <a class="btn series-btn" href="#/series">シリーズ</a>
      </div>
      <div id="list"></div>
      <a class="fab" href="#/add">本を登録</a>
    `;

    // 検索欄：1 文字入力するたびに絞り込み直す
    $('#q').addEventListener('input', (e) => {
      state.query = e.target.value;
      drawList();
    });

    // 並べ替えの切り替え：押されたものを記憶して描き直す
    $('.seg').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sort]');
      if (!btn) return;
      state.sort = btn.dataset.sort;
      DB.setSetting('sort', state.sort);
      document.querySelectorAll('.seg-btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      drawList();
    });

    // 「オリジナル」のときのドラッグ並べ替えを有効にする
    enableReorder($('#list'));

    drawList();
  }

  /** 検索欄の文字で絞り込んだ本の配列を返す（題名・よみ・作者・出版社・シリーズ名が対象） */
  function filteredBooks() {
    const q = Util.searchText(state.query);
    if (!q) return state.books.slice();
    return state.books.filter((b) => {
      // 項目同士がつながって誤って一致しないよう、区切り文字を挟んで連結する
      const target = [b.title, b.titleYomi, b.author, b.publisher, b.series]
        .map(Util.searchText)
        .join('\u0001');
      return target.includes(q);
    });
  }

  /* ---------------------------------------------------------------
   * 一覧の 1 行分の HTML を作る。
   *   左端の色帯 … ジャンルごとの色（本の背表紙に見立てたもの）
   *   withGrip  … true のとき、右端にドラッグ用のつまみを付ける
   * --------------------------------------------------------------- */
  function rowHtml(book, withGrip) {
    const thumb = book.thumb
      ? `<img class="thumb" src="${book.thumb}" alt="" loading="lazy">`
      : '<span class="thumb thumb-none" aria-hidden="true"></span>';
    const sub = [book.author, book.publisher].filter(Boolean).map(Util.esc).join('　');
    const status = book.status && book.status !== 'unread'
      ? `<span class="badge badge-${book.status}">${STATUS[book.status]}</span>`
      : '';
    const grip = withGrip
      ? `<button type="button" class="grip" aria-label="「${Util.esc(book.title)}」を移動">
           <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
         </button>`
      : '';
    return `
      <li class="row" data-id="${book.id}">
        <a class="row-link" href="#/book/${book.id}">
          <span class="spine"${spineStyle(book.genre)}></span>
          ${thumb}
          <span class="row-text">
            <span class="row-title">${titleHtml(book)}</span>
            ${sub ? `<span class="row-sub">${sub}</span>` : ''}
          </span>
          ${status}
        </a>
        ${grip}
      </li>`;
  }

  /* ---------------------------------------------------------------
   * 現在の検索文字と並べ替えに従って、本の並びを描く。
   * --------------------------------------------------------------- */
  function drawList() {
    const box = $('#list');
    if (!box) return;
    const books = filteredBooks();

    // 1 冊も登録されていないとき
    if (state.books.length === 0) {
      box.innerHTML = `
        <div class="empty">
          <p>まだ本が登録されていません。</p>
          <p>下の「本を登録」から、最初の 1 冊を追加してください。</p>
        </div>`;
      return;
    }
    // 検索に一致する本が無いとき
    if (books.length === 0) {
      box.innerHTML = `<p class="empty">「${Util.esc(state.query)}」に一致する本はありません。</p>`;
      return;
    }

    let html = '';

    if (state.sort === 'genre') {
      // ----- ジャンル別：ジャンルごとに見出しを付け、その中は五十音順 -----
      const groups = new Map();
      books.forEach((b) => {
        const key = b.genre || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      });
      // 見出しの順番：設定画面のジャンル順 → 一覧に無いジャンル名 → 未分類
      const order = state.genres.filter((g) => groups.has(g));
      groups.forEach((_, key) => {
        if (key && !order.includes(key)) order.push(key);
      });
      if (groups.has('')) order.push('');

      html = order.map((genre) => {
        const list = groups.get(genre).sort(compareYomi);
        return `
          <section class="group">
            <h2 class="group-head">
              <span class="spine"${spineStyle(genre)}></span>
              <span class="group-name">${Util.esc(genre || '未分類')}</span>
              <span class="group-count">${list.length} 冊</span>
            </h2>
            <ul class="rows">${list.map((b) => rowHtml(b, false)).join('')}</ul>
          </section>`;
      }).join('');

    } else if (state.sort === 'custom') {
      // ----- オリジナル：利用者が決めた順番（order の小さい順） -----
      books.sort((a, b) => (a.order || 0) - (b.order || 0));
      const searching = Boolean(state.query.trim());
      const note = searching
        ? '<p class="note">検索中は順番を変えられません。検索欄を空にすると並べ替えできます。</p>'
        : '<p class="note">右端のつまみを押したまま上下に動かすと、順番を変えられます。</p>';
      html = note + `<ul class="rows" id="customRows">${books.map((b) => rowHtml(b, !searching)).join('')}</ul>`;

    } else {
      // ----- 五十音順／登録順 -----
      if (state.sort === 'new') {
        books.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // 新しく登録した本が上
      } else {
        books.sort(compareYomi);
      }
      html = `<ul class="rows">${books.map((b) => rowHtml(b, false)).join('')}</ul>`;
    }

    box.innerHTML = html;
    rememberOrder(box);
  }

  /* ---------------------------------------------------------------
   * 「オリジナル」のドラッグ並べ替え。
   *
   * iPhone のブラウザは、パソコン向けの標準的なドラッグ機能（drag & drop）に
   * 十分対応していないため、指やマウスの動き（pointer イベント）を使って
   * 自前で実装している。
   *
   * 仕組み：
   *   1. つまみを押すと、その行を「つかんだ」状態にする。
   *   2. 指の動きに合わせて、行を transform で上下にずらして表示する。
   *   3. 行の中心が隣の行の中心を越えたら、HTML 上の順番を入れ替える。
   *   4. 指を離したら、画面上の順番を各本の order に書き込んで保存する。
   * --------------------------------------------------------------- */
  function enableReorder(listBox) {
    listBox.addEventListener('pointerdown', (downEvent) => {
      const grip = downEvent.target.closest('.grip');
      if (!grip) return;
      const row = grip.closest('.row');
      const rows = row.parentElement;
      downEvent.preventDefault();

      // 指が つまみ の外へ出ても、動きを受け取り続けられるようにする
      grip.setPointerCapture(downEvent.pointerId);
      row.classList.add('is-dragging');

      let pointerY = downEvent.clientY;                       // 指の現在位置（画面上の高さ）
      let originY = downEvent.clientY + window.scrollY;       // つかんだ位置（ページ全体での高さ）
      let frame = null;                                       // 自動スクロール用の繰り返し処理

      // 行を HTML 上で移動する。移動で行の本来の位置が変わる分、基準位置も補正する
      function moveBefore(reference) {
        const before = row.offsetTop;
        rows.insertBefore(row, reference);
        originY += row.offsetTop - before;
      }

      // 指の位置に合わせて行をずらし、必要なら隣の行と入れ替える
      function update() {
        row.style.transform = `translateY(${pointerY + window.scrollY - originY}px)`;
        const rect = row.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const prev = row.previousElementSibling;
        const next = row.nextElementSibling;
        if (prev) {
          const r = prev.getBoundingClientRect();
          if (center < r.top + r.height / 2) {
            moveBefore(prev);
            row.style.transform = `translateY(${pointerY + window.scrollY - originY}px)`;
            return;
          }
        }
        if (next) {
          const r = next.getBoundingClientRect();
          if (center > r.top + r.height / 2) {
            moveBefore(next.nextElementSibling); // null のときは末尾に移動する
            row.style.transform = `translateY(${pointerY + window.scrollY - originY}px)`;
          }
        }
      }

      // 指が画面の上端・下端に近いときは、画面を少しずつ自動でスクロールする
      function autoScroll() {
        const edge = 80;
        let step = 0;
        if (pointerY < edge) step = -10;
        else if (pointerY > window.innerHeight - edge) step = 10;
        if (step !== 0) {
          window.scrollBy(0, step);
          update();
        }
        frame = requestAnimationFrame(autoScroll);
      }

      function onMove(e) {
        pointerY = e.clientY;
        update();
      }

      // 指を離したとき：後片付けをして、新しい順番を保存する
      async function onEnd() {
        cancelAnimationFrame(frame);
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onEnd);
        grip.removeEventListener('pointercancel', onEnd);
        row.style.transform = '';
        row.classList.remove('is-dragging');

        // 画面上の並び順（上から 0, 1, 2 …）を、各本の order に書き込む
        const ids = Array.from(rows.children).map((li) => li.dataset.id);
        state.navIds = ids; // 詳細画面で前後へ移る順番も、新しい並びに合わせる
        const changed = [];
        ids.forEach((id, index) => {
          const book = state.books.find((b) => b.id === id);
          if (book && book.order !== index) {
            book.order = index;
            changed.push(book);
          }
        });
        if (changed.length > 0) {
          try {
            await DB.putBooks(changed);
          } catch (err) {
            console.error(err);
            toast('順番を保存できませんでした');
          }
        }
      }

      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onEnd);
      grip.addEventListener('pointercancel', onEnd);
      frame = requestAnimationFrame(autoScroll);
    });
  }

  /* =================================================================
   * 4. 詳細画面
   * ================================================================= */

  /* ---------------------------------------------------------------
   * 本 1 冊の詳細（写真・題名・作者・出版社など）を表示する。
   * --------------------------------------------------------------- */
  async function renderDetail(id) {
    state.books = await DB.getAllBooks();
    const book = state.books.find((b) => b.id === id);
    if (!book) return renderNotFound();
    const images = await DB.getImagesByBook(id);

    // 前後の本を調べる。順番は、直前に見ていた一覧（またはシリーズ）の並びに従う。
    // 先頭の本には「前」が無く、末尾の本には「次」が無い（null になる）
    const order = navOrder(id);
    const position = order.indexOf(id);
    const prevId = position > 0 ? order[position - 1] : null;
    const nextId = position < order.length - 1 ? order[position + 1] : null;

    // 写真の並び。タップすると拡大表示する
    const gallery = images.length
      ? `<div class="gallery">${images.map((img, i) =>
          `<button type="button" class="shot" data-index="${i}" aria-label="写真 ${i + 1} を拡大">
             <img src="${img.dataUrl}" alt="本の写真 ${i + 1}">
           </button>`).join('')}</div>`
      : `<p class="gallery-none">写真はまだありません。「編集」から追加できます。</p>`;

    // 値がある項目だけを表にして出す
    const facts = [
      ['作者', book.author],
      ['出版社', book.publisher],
      ['ジャンル', book.genre || '未分類'],
      // シリーズ名は、押すとそのシリーズのページへ移動できるようリンクにする
      ['シリーズ', book.series, book.series ? seriesHref(book.series) : ''],
      ['巻数', book.volume],
      ['ISBN', book.isbn],
      ['登録日', Util.formatDate(book.createdAt)]
    ].filter(([, value]) => value)
      .map(([label, value, href]) => {
        const body = href ? `<a href="${href}">${Util.esc(value)}</a>` : Util.esc(value);
        return `<div class="fact"><dt>${label}</dt><dd>${body}</dd></div>`;
      })
      .join('');

    const statusButtons = Object.keys(STATUS).map((key) =>
      `<button type="button" class="seg-btn${book.status === key ? ' is-on' : ''}" data-status="${key}"
        aria-pressed="${book.status === key}">${STATUS[key]}</button>`
    ).join('');

    view.innerHTML = `
      ${barHtml({
        title: '',
        backHref: '#/',
        backLabel: '一覧',
        rightHtml: `<a class="bar-link" href="#/edit/${book.id}">編集</a>`
      })}
      <nav class="pager" aria-label="前後の本">
        <button type="button" id="prevBook" class="link-btn"${prevId ? '' : ' disabled'}>‹ 前の本</button>
        <span class="pager-count">${position + 1} / ${order.length}</span>
        <button type="button" id="nextBook" class="link-btn"${nextId ? '' : ' disabled'}>次の本 ›</button>
      </nav>
      <article class="detail">
        ${gallery}
        <div class="detail-head">
          <span class="spine"${spineStyle(book.genre)}></span>
          <div>
            <h2 class="detail-title">${titleHtml(book)}</h2>
            ${book.titleYomi ? `<p class="detail-yomi">${Util.esc(book.titleYomi)}</p>` : ''}
          </div>
        </div>
        <div class="seg seg-status" role="group" aria-label="読書状態">${statusButtons}</div>
        <dl class="facts">${facts}</dl>
        ${book.memo ? `<section class="memo"><h3>メモ</h3><p>${Util.esc(book.memo)}</p></section>` : ''}
        <button type="button" id="deleteBook" class="btn btn-danger">この本を削除</button>
      </article>
    `;

    // 写真をタップしたら拡大表示
    const galleryEl = $('.gallery');
    if (galleryEl) {
      galleryEl.addEventListener('click', (e) => {
        const shot = e.target.closest('.shot');
        if (shot) openViewer(book.id, images, Number(shot.dataset.index));
      });
    }

    // 前後の本へ移るボタン。replace を使うので、「一覧」に戻る操作は 1 回で済む
    $('#prevBook').addEventListener('click', () => { if (prevId) location.replace('#/book/' + prevId); });
    $('#nextBook').addEventListener('click', () => { if (nextId) location.replace('#/book/' + nextId); });

    // 指で左右にスライドして前後の本へ移れるようにする
    enableBookSwipe($('.detail'), prevId, nextId);

    // 読書状態の切り替え：押したらすぐ保存する（編集画面を開かなくてよい）
    $('.seg-status').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-status]');
      if (!btn || btn.dataset.status === book.status) return;
      book.status = btn.dataset.status;
      book.updatedAt = Date.now();
      await DB.putBook(book);
      document.querySelectorAll('.seg-status .seg-btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      toast(`「${STATUS[book.status]}」にしました`);
    });

    // 削除：確認してから、本と写真を消して一覧へ戻る
    $('#deleteBook').addEventListener('click', async () => {
      if (!confirm(`「${book.title}」を削除します。写真も一緒に削除され、元に戻せません。`)) return;
      await DB.deleteBook(book.id);
      toast('削除しました');
      location.replace('#/');
    });
  }

  /* ---------------------------------------------------------------
   * 一覧に表示した本の並び順を覚える。
   * 詳細画面で「前の本／次の本」へ移るときの順番になる。
   * --------------------------------------------------------------- */
  function rememberOrder(container) {
    state.navIds = Array.from(container.querySelectorAll('.row')).map((li) => li.dataset.id);
  }

  /* ---------------------------------------------------------------
   * 前後移動に使う本の並び（ID の配列）を返す。
   *   ・直前に見ていた一覧にその本が含まれていれば、その一覧の並びを使う
   *     （検索で絞り込んでいた場合は、絞り込んだ範囲の中だけを移動する）。
   *   ・ページを読み込み直した直後など、一覧の並びが分からないときは、
   *     現在の並べ替え設定で全ての本を並べたものを使う。
   * --------------------------------------------------------------- */
  function navOrder(currentId) {
    if (state.navIds.includes(currentId)) {
      // 一覧を表示した後に削除された本は除く
      return state.navIds.filter((id) => state.books.some((b) => b.id === id));
    }
    const books = state.books.slice();
    if (state.sort === 'custom') {
      books.sort((a, b) => (a.order || 0) - (b.order || 0));
    } else if (state.sort === 'new') {
      books.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else if (state.sort === 'genre') {
      // ジャンルの順（設定画面の順、未分類は最後）→ 同じジャンルの中は五十音順
      const rank = (b) => {
        if (!b.genre) return Infinity;
        const i = state.genres.indexOf(b.genre);
        return i === -1 ? state.genres.length : i;
      };
      books.sort((a, b) => (rank(a) - rank(b)) || collator.compare(a.genre || '', b.genre || '') || compareYomi(a, b));
    } else {
      books.sort(compareYomi);
    }
    return books.map((b) => b.id);
  }

  /* ---------------------------------------------------------------
   * 詳細画面を指で左右にスライドして、前後の本へ移れるようにする。
   *
   *   左へスライド … 次の本    右へスライド … 前の本
   *
   * 仕組み：
   *   1. 指の動きが「横方向」だと分かったら、画面を指に合わせて横にずらす。
   *      （縦方向の動きは通常のスクロールとして扱い、何もしない）
   *   2. 一定の距離（70px）以上ずらして指を離すと、前後の本へ移る。
   *   3. 最初の本で右へ、最後の本で左へスライドしたときは、
   *      画面が少しだけ動いて元に戻る（それ以上は進めないことを示す）。
   *
   * 写真の並び（横スクロールする部分）の上で始めた操作は、写真のスクロールを優先する。
   * マウスでは文字の選択と紛らわしいので反応させない（ボタンで移動できる）。
   * --------------------------------------------------------------- */
  function enableBookSwipe(article, prevId, nextId) {
    let start = null;        // 指を置いた位置
    let horizontal = false;  // 横方向の操作だと判定済みか

    article.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.gallery')) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      horizontal = false;
      article.style.transition = 'none';
    });

    article.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!horizontal) {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          horizontal = true;                 // 横方向の操作と判定
        } else if (Math.abs(dy) > 12) {
          start = null;                      // 縦方向（スクロール）なので、この操作は扱わない
          return;
        } else {
          return;                            // まだ判定できるほど動いていない
        }
      }
      // 進む先に本があれば指の動きどおりに、無ければ 5 分の 1 だけ動かす
      const target = dx < 0 ? nextId : prevId;
      article.style.transform = `translateX(${target ? dx : dx * 0.2}px)`;
    });

    function finish(e) {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const target = dx < 0 ? nextId : prevId;
      const go = horizontal && e.type === 'pointerup' && Math.abs(dx) > 70 && target;
      start = null;
      if (go) {
        location.replace('#/book/' + target);
      } else {
        // 元の位置へなめらかに戻す
        article.style.transition = 'transform 0.2s';
        article.style.transform = '';
      }
    }
    article.addEventListener('pointerup', finish);
    article.addEventListener('pointercancel', finish);
  }

  /* =================================================================
   * 写真の拡大表示
   *
   * できること
   *   ・2 本の指を広げる／狭める … 拡大・縮小（指の間の位置を中心に拡大する）
   *   ・拡大中に 1 本の指で動かす … 見たい箇所へ移動
   *   ・すばやく 2 回タップ       … その位置を拡大／元の大きさに戻す
   *   ・等倍のとき左右にスライド  … 次の写真／前の写真へ
   *   ・パソコンではマウスのホイールで拡大・縮小、←→キーで前後へ
   *
   * 写真の順番
   *   今の本の写真 → 次の本の写真 → … と、本をまたいで連続して見られる。
   *   本の順番は詳細画面の前後移動と同じ。写真の無い本は飛ばす。
   *   一番最初の写真より前、一番最後の写真より後へは進めない。
   * ================================================================= */

  // 拡大表示の現在の状態
  const viewer = {
    open: false,
    originBookId: null, // 開いたときに詳細画面に出ていた本
    bookId: null,       // 今表示している写真の本
    images: [],         // その本の写真
    index: 0,           // 何枚目を表示しているか（0 始まり）
    scale: 1,           // 拡大率（1 が等倍）
    x: 0,               // 写真をずらしている量（横）
    y: 0,               // 写真をずらしている量（縦）
    busy: false         // 次の本の写真を読み込み中か
  };
  const MAX_SCALE = 5;  // 拡大の上限（5 倍）

  /** 拡大表示を開く。bookId の本の写真 images のうち、index 枚目から表示する */
  function openViewer(bookId, images, index) {
    viewer.open = true;
    viewer.originBookId = bookId;
    viewer.bookId = bookId;
    viewer.images = images;
    viewer.index = index;
    $('#viewer').hidden = false;
    document.body.classList.add('no-scroll');
    showViewerImage();
  }

  /** 拡大表示を画面から消す（画面の移動は行わない） */
  function hideViewer() {
    if (!viewer.open) return;
    viewer.open = false;
    viewer.images = [];
    $('#viewer').hidden = true;
    $('#viewerImg').removeAttribute('src');
    document.body.classList.remove('no-scroll');
  }

  /**
   * 利用者の操作で拡大表示を閉じる。
   * 写真を送って別の本まで進んでいた場合は、後ろの詳細画面もその本に切り替える
   * （閉じたときに、見ていた写真と違う本が出ていると混乱するため）。
   */
  function closeViewer() {
    if (!viewer.open) return;
    const movedTo = viewer.bookId !== viewer.originBookId ? viewer.bookId : null;
    hideViewer();
    if (movedTo) location.replace('#/book/' + movedTo);
  }

  /** 写真の位置と拡大率を画面に反映する。animate が true のときはなめらかに動かす */
  function applyViewerTransform(animate) {
    const img = $('#viewerImg');
    img.style.transition = animate ? 'transform 0.2s' : 'none';
    img.style.transform = `translate(${viewer.x}px, ${viewer.y}px) scale(${viewer.scale})`;
  }

  /** 拡大中の移動量を、写真の端が画面の内側に入り込まない範囲に収める */
  function clampViewerPan() {
    const img = $('#viewerImg');
    const stage = $('#viewerStage');
    const maxX = Math.max(0, (img.offsetWidth * viewer.scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * viewer.scale - stage.clientHeight) / 2);
    viewer.x = Math.min(maxX, Math.max(-maxX, viewer.x));
    viewer.y = Math.min(maxY, Math.max(-maxY, viewer.y));
  }

  /**
   * 画面上の点（clientX, clientY）を中心にして、拡大率を newScale に変える。
   * 「その点に映っている箇所が、拡大後も同じ位置に残る」ようにずらし量を計算する。
   */
  function zoomViewerAt(clientX, clientY, newScale, animate) {
    const rect = $('#viewerStage').getBoundingClientRect();
    const px = clientX - (rect.left + rect.width / 2);  // 枠の中心から見た点の位置
    const py = clientY - (rect.top + rect.height / 2);
    const next = Math.min(MAX_SCALE, Math.max(1, newScale));
    viewer.x = px - (next / viewer.scale) * (px - viewer.x);
    viewer.y = py - (next / viewer.scale) * (py - viewer.y);
    viewer.scale = next;
    if (next === 1) { viewer.x = 0; viewer.y = 0; }
    clampViewerPan();
    applyViewerTransform(animate);
  }

  /** dir の方向（+1 が次、-1 が前）にある、写真を持つ一番近い本を探す。無ければ null */
  function neighborBookWithPhotos(dir) {
    const order = navOrder(viewer.bookId);
    let i = order.indexOf(viewer.bookId) + dir;
    while (i >= 0 && i < order.length) {
      const book = state.books.find((b) => b.id === order[i]);
      if (book && book.thumb) return book; // thumb（一覧用の小さな画像）があれば写真がある
      i += dir;
    }
    return null;
  }

  /** dir の方向へ進めるか（今の本に続きの写真があるか、写真を持つ隣の本があるか） */
  function viewerCanStep(dir) {
    const i = viewer.index + dir;
    return (i >= 0 && i < viewer.images.length) || Boolean(neighborBookWithPhotos(dir));
  }

  /**
   * dir の方向へ 1 枚進む。進めたら true、端で進めなければ false を返す。
   * 今の本の写真が尽きたら、隣の本の写真を読み込んで続きとして表示する。
   */
  async function viewerStep(dir) {
    if (!viewer.open || viewer.busy) return false;
    const i = viewer.index + dir;
    if (i >= 0 && i < viewer.images.length) {
      viewer.index = i;
    } else {
      const book = neighborBookWithPhotos(dir);
      if (!book) return false;
      viewer.busy = true;
      let images = [];
      try {
        images = await DB.getImagesByBook(book.id);
      } finally {
        viewer.busy = false;
      }
      if (!viewer.open || images.length === 0) return false;
      viewer.bookId = book.id;
      viewer.images = images;
      // 次の本へ進んだときは 1 枚目から、前の本へ戻ったときは最後の 1 枚から表示する
      viewer.index = dir > 0 ? 0 : images.length - 1;
    }
    showViewerImage();
    return true;
  }

  /** 現在の写真を表示し、拡大を解除して、上下の表示（題名・枚数・ボタン）を更新する */
  function showViewerImage() {
    const img = $('#viewerImg');
    img.src = viewer.images[viewer.index].dataUrl;
    viewer.scale = 1;
    viewer.x = 0;
    viewer.y = 0;
    applyViewerTransform(false);

    const book = state.books.find((b) => b.id === viewer.bookId);
    const title = book ? book.title + (book.volume ? ' ' + book.volume : '') : '';
    $('#viewerInfo').textContent = `${title}（${viewer.index + 1} / ${viewer.images.length} 枚目）`;
    // 端まで来たら、その方向のボタンを押せなくする
    $('#viewerPrev').disabled = !viewerCanStep(-1);
    $('#viewerNext').disabled = !viewerCanStep(1);
  }

  /* ---------------------------------------------------------------
   * 拡大表示での指・マウスの操作を受け付ける準備（起動時に 1 回だけ実行）。
   *
   * 画面に触れている指を 1 本ずつ記録し、
   *   2 本のとき … 指の間隔の変化を拡大率にする（ピンチ操作）
   *   1 本のとき … 拡大中なら写真の移動、等倍なら左右送り
   * として扱う。
   * --------------------------------------------------------------- */
  function setupViewerGestures() {
    const stage = $('#viewerStage');
    const points = new Map(); // 触れている指：指の番号 → 位置
    let drag = null;          // 1 本指の操作を始めたときの記録
    let pinch = null;         // 2 本指の操作を始めたときの記録
    let lastTap = 0;          // 直前のタップの時刻（2 回タップの判定用）

    // 枠の中心から見た位置に直す
    const fromCenter = (x, y) => {
      const rect = stage.getBoundingClientRect();
      return { x: x - (rect.left + rect.width / 2), y: y - (rect.top + rect.height / 2) };
    };
    // 1 本指の操作の記録を取り直す（ピンチが終わって指が 1 本残ったときにも使う）
    const beginDrag = (p) => {
      drag = { x: p.x, y: p.y, viewX: viewer.x, viewY: viewer.y, time: Date.now(), moved: false };
    };

    stage.addEventListener('pointerdown', (e) => {
      if (!viewer.open) return;
      e.preventDefault();
      // 指が枠の外へ出ても動きを受け取り続ける（対応していない環境では何もしない）
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 無視してよい */ }
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (points.size === 1) {
        beginDrag({ x: e.clientX, y: e.clientY });
      } else if (points.size === 2) {
        // 2 本目の指が触れた：ピンチ操作の開始時点の状態を記録する
        const [a, b] = Array.from(points.values());
        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          center: fromCenter((a.x + b.x) / 2, (a.y + b.y) / 2),
          scale: viewer.scale,
          viewX: viewer.x,
          viewY: viewer.y
        };
        drag = null;
      }
    });

    stage.addEventListener('pointermove', (e) => {
      if (!points.has(e.pointerId)) return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (points.size === 2 && pinch) {
        // ----- ピンチ：指の間隔の比で拡大率を決め、指の中心に合わせて位置を保つ -----
        const [a, b] = Array.from(points.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const center = fromCenter((a.x + b.x) / 2, (a.y + b.y) / 2);
        const next = Math.min(MAX_SCALE, Math.max(1, pinch.scale * (distance / pinch.distance)));
        viewer.x = center.x - (next / pinch.scale) * (pinch.center.x - pinch.viewX);
        viewer.y = center.y - (next / pinch.scale) * (pinch.center.y - pinch.viewY);
        viewer.scale = next;
        clampViewerPan();
        applyViewerTransform(false);

      } else if (points.size === 1 && drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) drag.moved = true;

        if (viewer.scale > 1) {
          // ----- 拡大中：写真を動かして、見たい箇所を表示する -----
          viewer.x = drag.viewX + dx;
          viewer.y = drag.viewY + dy;
          clampViewerPan();
        } else {
          // ----- 等倍：左右送り。進めない方向へは 4 分の 1 だけ動かす -----
          viewer.x = viewerCanStep(dx < 0 ? 1 : -1) ? dx : dx * 0.25;
          viewer.y = 0;
        }
        applyViewerTransform(false);
      }
    });

    async function onPointerEnd(e) {
      if (!points.has(e.pointerId)) return;
      const last = points.get(e.pointerId);
      points.delete(e.pointerId);

      if (pinch) {
        // ピンチの終了。指が 1 本残っていれば、そこから移動の操作として続ける
        pinch = null;
        if (viewer.scale <= 1.02) { viewer.scale = 1; viewer.x = 0; viewer.y = 0; }
        applyViewerTransform(true);
        const rest = Array.from(points.values())[0];
        if (rest) { beginDrag(rest); drag.moved = true; }
        return;
      }
      if (!drag || points.size > 0) return;
      const record = drag;
      drag = null;
      const dx = last.x - record.x;

      // ----- タップ（ほとんど動かさず、すぐ離した）：2 回続けば拡大／元に戻す -----
      if (!record.moved && e.type === 'pointerup' && Date.now() - record.time < 300) {
        const now = Date.now();
        if (now - lastTap < 320) {
          lastTap = 0;
          zoomViewerAt(last.x, last.y, viewer.scale > 1 ? 1 : 2.5, true);
        } else {
          lastTap = now;
        }
        return;
      }

      // ----- 等倍での左右送り：十分に動かしていれば前後の写真へ -----
      if (viewer.scale === 1) {
        const dir = dx < 0 ? 1 : -1;
        if (e.type === 'pointerup' && Math.abs(dx) > 60 && viewerCanStep(dir)) {
          const moved = await viewerStep(dir);
          if (moved) return;
        }
        // 送らなかった場合（動きが小さい・端で進めない）は元の位置へ戻す
        viewer.x = 0;
        viewer.y = 0;
        applyViewerTransform(true);
      }
    }
    stage.addEventListener('pointerup', onPointerEnd);
    stage.addEventListener('pointercancel', onPointerEnd);

    // パソコン向け：マウスのホイールで、カーソルの位置を中心に拡大・縮小
    stage.addEventListener('wheel', (e) => {
      if (!viewer.open) return;
      e.preventDefault();
      zoomViewerAt(e.clientX, e.clientY, viewer.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), false);
    }, { passive: false });

    $('#viewerPrev').addEventListener('click', () => viewerStep(-1));
    $('#viewerNext').addEventListener('click', () => viewerStep(1));
    $('#viewerClose').addEventListener('click', closeViewer);
  }

  /* =================================================================
   * 5. 登録・編集画面
   * ================================================================= */

  /** 入力欄 1 つ分の HTML を作る補助関数 */
  function fieldHtml(label, name, value, extra) {
    return `
      <label class="field">
        <span class="field-label">${label}</span>
        <input type="text" id="f-${name}" value="${Util.esc(value || '')}" autocomplete="off" ${extra || ''}>
      </label>`;
  }

  /** ジャンル選択欄の選択肢の HTML を作る */
  function genreOptionsHtml(selected) {
    const names = state.genres.slice();
    // 本に付いているジャンルが一覧に無い場合（バックアップ読み込み後など）も選べるようにする
    if (selected && !names.includes(selected)) names.push(selected);
    return (
      `<option value="">未分類</option>` +
      names.map((g) => `<option value="${Util.esc(g)}"${g === selected ? ' selected' : ''}>${Util.esc(g)}</option>`).join('') +
      `<option value="__new__">＋ 新しいジャンルを追加…</option>`
    );
  }

  /** シリーズ選択欄の選択肢の HTML を作る */
  function seriesOptionsHtml(selected) {
    const names = allSeries();
    return (
      `<option value="">なし</option>` +
      names.map((s) => `<option value="${Util.esc(s)}"${s === selected ? ' selected' : ''}>${Util.esc(s)}</option>`).join('') +
      `<option value="__new__">＋ 新しいシリーズを追加…</option>`
    );
  }

  /* ---------------------------------------------------------------
   * 登録・編集画面を表示する。
   *   id が null … 新しい本の登録
   *   id あり    … その本の編集
   * --------------------------------------------------------------- */
  async function renderForm(id) {
    const editing = Boolean(id);
    const original = editing ? await DB.getBook(id) : null;
    if (editing && !original) return renderNotFound();
    const images = editing ? await DB.getImagesByBook(id) : [];
    state.books = await DB.getAllBooks(); // 重複チェックに使う

    // この画面で作業中のデータ。写真は「保存」を押すまでここに置いておく
    form = {
      editing,
      original,
      images: images.map((img) => ({ id: img.id, dataUrl: img.dataUrl })),
      saving: false
    };

    const b = original || { status: 'unread' };
    const statusRadios = Object.keys(STATUS).map((key) => `
      <label class="radio">
        <input type="radio" name="status" value="${key}"${(b.status || 'unread') === key ? ' checked' : ''}>
        <span>${STATUS[key]}</span>
      </label>`).join('');

    view.innerHTML = `
      ${barHtml({
        title: editing ? '本を編集' : '本を登録',
        backHref: editing ? `#/book/${id}` : '#/',
        backLabel: editing ? '戻る' : '一覧'
      })}
      <form id="bookForm" class="form" novalidate>

        <section class="isbn-box">
          <h2>ISBN から書誌を取得</h2>
          <button type="button" id="scanBtn" class="btn btn-primary">バーコードを読み取る</button>
          <div class="isbn-line">
            <input type="text" id="f-isbn" inputmode="numeric" autocomplete="off"
              placeholder="または ISBN を入力" aria-label="ISBN" value="${Util.esc(b.isbn || '')}">
            <button type="button" id="lookupBtn" class="btn">書誌を検索</button>
          </div>
          <p id="lookupMsg" class="msg" role="status"></p>
          <p class="credit">題名・よみがな・作者・出版社の取得に、国立国会図書館サーチ（NDLサーチ）の API を利用しています。</p>
        </section>

        ${fieldHtml('題名（必須）', 'title', b.title, 'required')}
        ${fieldHtml('よみがな', 'titleYomi', b.titleYomi, 'placeholder="五十音順の並べ替えに使います"')}
        ${fieldHtml('作者', 'author', b.author)}
        ${fieldHtml('出版社', 'publisher', b.publisher)}

        <label class="field">
          <span class="field-label">ジャンル</span>
          <select id="f-genre">${genreOptionsHtml(b.genre || '')}</select>
        </label>

        <fieldset class="field">
          <legend class="field-label">読書状態</legend>
          <div class="radios">${statusRadios}</div>
        </fieldset>

        <div class="field-pair">
          <label class="field">
            <span class="field-label">シリーズ</span>
            <select id="f-series">${seriesOptionsHtml(b.series || '')}</select>
          </label>
          ${fieldHtml('巻数', 'volume', b.volume)}
        </div>

        <label class="field">
          <span class="field-label">メモ・感想</span>
          <textarea id="f-memo" rows="4">${Util.esc(b.memo || '')}</textarea>
        </label>

        <section class="field">
          <span class="field-label">写真（表紙・裏表紙など）</span>
          <div id="photos" class="photos"></div>
          <button type="button" id="addPhoto" class="btn">写真を追加</button>
          <p class="hint">1 枚目が一覧の小さな画像になります。保存時に自動で縮小・圧縮します。</p>
        </section>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="saveBtn">保存する</button>
          ${editing ? '' : '<button type="button" class="btn" id="saveNextBtn">保存して次の本を登録</button>'}
        </div>
      </form>
    `;

    drawPhotos();

    // ----- 各ボタンの動作を登録する -----
    $('#scanBtn').addEventListener('click', openScanner);
    $('#lookupBtn').addEventListener('click', () => runLookup($('#f-isbn').value));
    $('#addPhoto').addEventListener('click', () => $('#photoInput').click());

    // 写真の「削除」ボタン
    $('#photos').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      form.images = form.images.filter((img) => img.id !== btn.dataset.remove);
      drawPhotos();
    });

    // ジャンルで「新しいジャンルを追加」を選んだとき
    $('#f-genre').addEventListener('change', async (e) => {
      if (e.target.value !== '__new__') return;
      const name = (prompt('新しいジャンルの名前を入力してください') || '').trim();
      if (name && !state.genres.includes(name)) {
        state.genres.push(name);
        await DB.setSetting('genres', state.genres);
      }
      // 選択肢を作り直し、追加したジャンル（取り消した場合は未分類）を選んだ状態にする
      e.target.innerHTML = genreOptionsHtml(name || '');
    });

    // シリーズで「新しいシリーズを追加」を選んだとき（ジャンルと同じ仕組み）
    $('#f-series').addEventListener('change', async (e) => {
      if (e.target.value !== '__new__') return;
      const name = (prompt('新しいシリーズの名前を入力してください') || '').trim();
      if (name && !allSeries().includes(name)) {
        state.series.push(name);
        await DB.setSetting('seriesList', state.series);
      }
      e.target.innerHTML = seriesOptionsHtml(name || '');
    });

    // 保存ボタン（Enter キーでの送信もここに来る）
    $('#bookForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveForm(false);
    });
    const nextBtn = $('#saveNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => saveForm(true));
  }

  /** 登録・編集画面の写真の並びを描く */
  function drawPhotos() {
    const box = $('#photos');
    if (!box || !form) return;
    box.innerHTML = form.images.map((img, i) => `
      <div class="photo">
        <img src="${img.dataUrl}" alt="追加した写真 ${i + 1}">
        <button type="button" class="photo-remove" data-remove="${img.id}">削除</button>
      </div>`).join('');
  }

  /* ---------------------------------------------------------------
   * 写真が撮影・選択されたときの処理。
   * 1 枚ずつ縮小・圧縮してから、作業中データに加える。
   * --------------------------------------------------------------- */
  async function onPhotosChosen(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // 同じ写真をもう一度選べるよう、選択状態を空に戻す
    if (!form || files.length === 0) return;
    for (const file of files) {
      try {
        const dataUrl = await ImageTool.compress(file);
        if (!form) return; // 処理中に別の画面へ移動していたら中止
        form.images.push({ id: Util.uid(), dataUrl });
        drawPhotos();
      } catch (err) {
        console.error(err);
        toast('読み込めない写真がありました');
      }
    }
  }

  /** 書誌検索の結果メッセージを表示する。kind は 'ok' / 'warn' / ''（通常） */
  function setLookupMsg(html, kind) {
    const el = $('#lookupMsg');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'msg' + (kind ? ' msg-' + kind : '');
  }

  /** 同じ ISBN の本がすでに登録されていれば、その本を返す（編集中の本自身は除く） */
  function findSameIsbn(isbn) {
    const selfId = form && form.original ? form.original.id : null;
    return state.books.find((b) => b.isbn && b.isbn === isbn && b.id !== selfId) || null;
  }

  /* ---------------------------------------------------------------
   * ISBN から書誌情報を取得して、入力欄に書き込む。
   * バーコードを読み取ったとき、または「書誌を検索」を押したときに呼ばれる。
   * --------------------------------------------------------------- */
  async function runLookup(rawIsbn) {
    const isbn = Util.normalizeIsbn(rawIsbn);
    if (!isbn) {
      setLookupMsg('ISBN として正しくありません。13 桁（978…）または 10 桁で入力してください。', 'warn');
      return;
    }
    $('#f-isbn').value = isbn;

    // 重複チェック：同じ ISBN の本が登録済みなら知らせる
    const same = findSameIsbn(isbn);
    const dupHtml = same
      ? `<br>この本は登録済みです：<a href="#/book/${same.id}">「${Util.esc(same.title)}${same.volume ? ' ' + Util.esc(same.volume) : ''}」</a>`
      : '';

    setLookupMsg('書誌データを検索しています…', '');
    $('#lookupBtn').disabled = true;
    const result = await NDL.lookup(isbn);
    if (!form || !$('#lookupBtn')) return; // 検索中に別の画面へ移動していたら何もしない
    $('#lookupBtn').disabled = false;

    if (result.status === 'found') {
      const found = result.book;
      // すでに別の題名が入力されている場合は、上書きしてよいか確認する
      const currentTitle = $('#f-title').value.trim();
      let overwrite = true;
      if (currentTitle && currentTitle !== found.title) {
        overwrite = confirm('入力済みの内容を、取得した書誌データで上書きしますか？\n（キャンセルすると、空欄だけを埋めます）');
      }
      // シリーズは利用者が自分で名付けて管理するため、書誌データからは入力しない
      ['title', 'titleYomi', 'author', 'publisher', 'volume'].forEach((key) => {
        const input = $('#f-' + key);
        if (found[key] && (overwrite || !input.value.trim())) input.value = found[key];
      });
      setLookupMsg('書誌データを取得しました。内容を確認して、必要なら修正してください。' + dupHtml, same ? 'warn' : 'ok');

    } else if (result.status === 'notfound') {
      setLookupMsg('この ISBN の書誌データは見つかりませんでした。下の欄に手入力して登録できます。' + dupHtml, 'warn');

    } else if (result.reason === 'server') {
      setLookupMsg('NDLサーチが混み合っているか、停止しています。時間をおいて試すか、手入力してください。' + dupHtml, 'warn');

    } else if (result.viaProxy) {
      setLookupMsg('中継URL に接続できませんでした。電波の状況と、設定画面の中継URL を確認してください。' + dupHtml, 'warn');

    } else {
      setLookupMsg('NDLサーチに接続できませんでした。電波の状況を確認してください。何度試しても失敗する場合は、設定画面の「書誌検索」をご覧ください。手入力での登録はできます。' + dupHtml, 'warn');
    }
  }

  /* ---------------------------------------------------------------
   * バーコード読み取り画面を開く／閉じる
   * --------------------------------------------------------------- */
  function openScanner() {
    const msg = $('#scanMsg');
    msg.textContent = '裏表紙の上段のバーコード（978 から始まる方）を枠に合わせてください';
    $('#scanner').hidden = false;
    document.body.classList.add('no-scroll');

    Scanner.start($('#scanVideo'), {
      // ISBN を読み取れたら、画面を閉じて書誌を検索する
      onIsbn(isbn) {
        closeScanner();
        if (navigator.vibrate) navigator.vibrate(60); // 対応端末では短く振動して知らせる
        runLookup(isbn);
      },
      onHint(text) {
        msg.textContent = text;
      },
      onError(text) {
        closeScanner();
        setLookupMsg(Util.esc(text), 'warn');
      }
    });
  }
  function closeScanner() {
    Scanner.stop();
    if ($('#scanner').hidden) return;
    $('#scanner').hidden = true;
    document.body.classList.remove('no-scroll');
  }

  /* ---------------------------------------------------------------
   * 入力内容を保存する。
   *   continueAfter が true … 保存後、続けて次の本の登録画面を開く
   *   continueAfter が false … 保存後、その本の詳細画面を開く
   * --------------------------------------------------------------- */
  async function saveForm(continueAfter) {
    if (!form || form.saving) return;
    const value = (name) => $('#f-' + name).value.trim();

    // ----- 入力内容の確認 -----
    const title = value('title');
    if (!title) {
      toast('題名を入力してください');
      $('#f-title').focus();
      return;
    }
    let isbn = value('isbn');
    if (isbn) {
      const normalized = Util.normalizeIsbn(isbn);
      if (!normalized) {
        setLookupMsg('ISBN として正しくありません。修正するか、空欄にしてください。', 'warn');
        $('#f-isbn').focus();
        return;
      }
      isbn = normalized;
    }
    const genreValue = $('#f-genre').value;
    const seriesValue = $('#f-series').value;
    const checked = document.querySelector('input[name="status"]:checked');

    // ----- 保存する本のデータを組み立てる（編集時は元のデータに上書き） -----
    const now = Date.now();
    const book = Object.assign({}, form.original || {}, {
      title,
      titleYomi: Util.cleanYomi(value('titleYomi')),
      author: value('author'),
      publisher: value('publisher'),
      isbn,
      genre: genreValue === '__new__' ? '' : genreValue,
      status: checked ? checked.value : 'unread',
      series: seriesValue === '__new__' ? '' : seriesValue,
      volume: value('volume'),
      memo: $('#f-memo').value.trim(),
      updatedAt: now
    });

    // ----- 重複チェック -----
    // ISBN が同じ本、または ISBN の無い本で「題名・作者・巻数」が全て同じ本を重複とみなす
    const selfId = form.original ? form.original.id : null;
    const key = (b) => [b.title, b.author, b.volume].map(Util.searchText).join('\u0001');
    const duplicate = state.books.find((b) => {
      if (b.id === selfId) return false;
      if (isbn && b.isbn) return b.isbn === isbn;
      return key(b) === key(book);
    });
    if (duplicate && !confirm(`「${duplicate.title}」はすでに登録されています。\nそれでも保存しますか？`)) {
      return;
    }

    // ----- 新規登録のときだけ決める項目 -----
    if (!form.editing) {
      book.id = Util.uid();
      book.createdAt = now;
      // 「オリジナル」では一番下に追加する（今ある最大の番号 + 1）
      book.order = state.books.reduce((max, b) => Math.max(max, b.order || 0), -1) + 1;
    }

    form.saving = true;
    $('#saveBtn').disabled = true;
    try {
      // 1 枚目の写真から、一覧用の小さな画像を作る（写真が無ければ空）
      book.thumb = form.images.length > 0 ? await ImageTool.makeThumb(form.images[0].dataUrl) : '';
      await DB.putBook(book);
      await DB.replaceImages(book.id, form.images);
    } catch (err) {
      console.error(err);
      form.saving = false;
      $('#saveBtn').disabled = false;
      toast('保存できませんでした。端末の空き容量を確認してください。');
      return;
    }

    toast(`「${book.title}」を保存しました`);
    if (continueAfter) {
      await renderForm(null);   // 空の登録画面を開き直す
      window.scrollTo(0, 0);
    } else {
      // replace を使うと、戻るボタンで登録画面に戻ってしまうのを防げる
      location.replace('#/book/' + book.id);
    }
  }

  /* =================================================================
   * 6. 設定画面
   * ================================================================= */

  async function renderSettings() {
    state.books = await DB.getAllBooks();
    const proxyUrl = await DB.getSetting('proxyUrl', '');
    const lastBackup = await DB.getSetting('lastBackupAt', null);
    const lastBackupKind = await DB.getSetting('lastBackupKind', '');

    // ジャンルごとの冊数を数える
    const counts = {};
    state.books.forEach((b) => { if (b.genre) counts[b.genre] = (counts[b.genre] || 0) + 1; });

    const genreRows = state.genres.length
      ? state.genres.map((g) => `
          <li class="genre-row" data-genre="${Util.esc(g)}">
            <span class="spine"${spineStyle(g)}></span>
            <span class="genre-name">${Util.esc(g)}</span>
            <span class="genre-count">${counts[g] || 0} 冊</span>
            <button type="button" class="link-btn" data-act="rename">名前変更</button>
            <button type="button" class="link-btn link-danger" data-act="delete">削除</button>
          </li>`).join('')
      : '<li class="note">ジャンルはまだありません。下の欄から追加できます。</li>';

    view.innerHTML = `
      ${barHtml({ title: '設定', backHref: '#/', backLabel: '一覧' })}
      <div class="settings">

        <section class="panel">
          <h2>ジャンル</h2>
          <ul class="genre-list" id="genreList">${genreRows}</ul>
          <div class="inline-form">
            <input type="text" id="newGenre" placeholder="新しいジャンル名" aria-label="新しいジャンル名" autocomplete="off">
            <button type="button" id="addGenre" class="btn">追加</button>
          </div>
        </section>

        <section class="panel">
          <h2>バックアップ</h2>
          <p>本の情報と写真は、この端末のブラウザ内にだけ保存されています。Safari のデータ消去や機種変更に備えて、定期的に書き出してください。</p>
          <p class="note">最後の書き出し：${lastBackup
            ? Util.formatDate(lastBackup) + (lastBackupKind === 'light' ? '（写真なし）' : lastBackupKind === 'full' ? '（写真あり）' : '')
            : 'まだ書き出していません'}</p>
          <div class="btn-row">
            <button type="button" id="exportBtn" class="btn btn-primary btn-solid">写真ごと書き出す</button>
            <button type="button" id="exportLightBtn" class="btn btn-secondary">書誌情報のみ書き出す（写真なし）</button>
          </div>
          <p class="note">「写真ごと」は全てを復元できますが、ファイルが大きくなります。「書誌情報のみ」は題名・作者・ジャンル・シリーズ・メモなどの文字の情報だけを書き出すので、ファイルが小さく済みます。</p>
          <div class="btn-row">
            <button type="button" id="importBtn" class="btn">バックアップを読み込む</button>
          </div>
          <div id="importPanel" class="import-panel" hidden></div>
        </section>

        <section class="panel">
          <h2>書誌検索</h2>
          <p>通常は空欄のままで使います。ISBN からの書誌取得が毎回「接続できませんでした」になる場合だけ、中継プログラムの URL を入力してください。</p>
          <p><a href="#/help/proxy">中継プログラムの作り方を見る</a></p>
          <label class="field">
            <span class="field-label">中継URL</span>
            <input type="url" id="proxyUrl" value="${Util.esc(proxyUrl)}" placeholder="https://…" autocomplete="off" autocapitalize="off">
          </label>
          <button type="button" id="saveProxy" class="btn">中継URL を保存</button>
        </section>

        <section class="panel">
          <h2>保存容量</h2>
          <p id="storageInfo" class="note">計算しています…</p>
        </section>

        <section class="panel">
          <h2>このアプリについて</h2>
          <p>このアプリは、書誌情報（題名・よみがな・作者・出版社など）の取得に
            <a href="https://ndlsearch.ndl.go.jp/" target="_blank" rel="noopener">国立国会図書館サーチ（NDLサーチ）</a>の API を利用しています。</p>
          <p class="note">バーコードの読み取りには ZXing（Apache License 2.0）を使用しています。</p>
        </section>

        <section class="panel">
          <h2>データの削除</h2>
          <button type="button" id="clearAll" class="btn btn-danger">すべてのデータを削除</button>
        </section>
      </div>
    `;

    // ----- ジャンルの追加 -----
    const addGenre = async () => {
      const input = $('#newGenre');
      const name = input.value.trim();
      if (!name) return;
      if (state.genres.includes(name)) {
        toast('同じ名前のジャンルがあります');
        return;
      }
      state.genres.push(name);
      await DB.setSetting('genres', state.genres);
      await renderSettings();
      $('#newGenre').focus();
    };
    $('#addGenre').addEventListener('click', addGenre);
    $('#newGenre').addEventListener('keydown', (e) => {
      // 日本語入力の変換確定の Enter では追加しない
      if (e.key === 'Enter' && !e.isComposing) addGenre();
    });

    // ----- ジャンルの名前変更・削除 -----
    $('#genreList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const oldName = btn.closest('.genre-row').dataset.genre;
      const affected = state.books.filter((b) => b.genre === oldName);

      if (btn.dataset.act === 'rename') {
        const newName = (prompt('新しい名前を入力してください', oldName) || '').trim();
        if (!newName || newName === oldName) return;
        if (state.genres.includes(newName)) {
          toast('同じ名前のジャンルがあります');
          return;
        }
        // 一覧の名前を置き換え、そのジャンルの本も新しい名前に付け替える
        state.genres = state.genres.map((g) => (g === oldName ? newName : g));
        affected.forEach((b) => { b.genre = newName; });
      } else {
        const message = affected.length
          ? `ジャンル「${oldName}」を削除します。このジャンルの ${affected.length} 冊は「未分類」になります。`
          : `ジャンル「${oldName}」を削除します。`;
        if (!confirm(message)) return;
        state.genres = state.genres.filter((g) => g !== oldName);
        affected.forEach((b) => { b.genre = ''; });
      }
      await DB.setSetting('genres', state.genres);
      if (affected.length) await DB.putBooks(affected);
      await renderSettings();
    });

    // ----- バックアップの書き出し -----
    // withImages が true なら写真ごと、false なら書誌情報のみ（写真なし）で書き出す
    const runExport = async (withImages) => {
      try {
        const count = await Backup.exportToFile(withImages);
        if (count === null) return; // 共有画面を閉じた場合
        await DB.setSetting('lastBackupAt', Date.now());
        await DB.setSetting('lastBackupKind', withImages ? 'full' : 'light');
        toast(`${count} 冊分のバックアップを書き出しました${withImages ? '' : '（写真なし）'}`);
        await renderSettings();
      } catch (err) {
        console.error(err);
        toast('バックアップを書き出せませんでした');
      }
    };
    $('#exportBtn').addEventListener('click', () => runExport(true));
    $('#exportLightBtn').addEventListener('click', () => runExport(false));

    // ----- バックアップの読み込み（ファイル選択を開く。続きは onBackupChosen） -----
    $('#importBtn').addEventListener('click', () => $('#backupInput').click());

    // ----- 中継URL の保存 -----
    $('#saveProxy').addEventListener('click', async () => {
      const url = $('#proxyUrl').value.trim();
      if (url && !/^https:\/\//.test(url)) {
        toast('中継URL は https:// から始まる必要があります');
        return;
      }
      await DB.setSetting('proxyUrl', url);
      toast(url ? '中継URL を保存しました' : '中継URL を空にしました');
    });

    // ----- 全データの削除（取り返しがつかないので 2 回確認する） -----
    $('#clearAll').addEventListener('click', async () => {
      if (!confirm('すべての本・写真・設定を削除します。元に戻せません。')) return;
      if (!confirm('本当に削除しますか？ バックアップを書き出していない場合、データは失われます。')) return;
      await DB.clearAll();
      state.genres = [];
      state.series = [];
      state.sort = 'yomi';
      state.query = '';
      toast('すべてのデータを削除しました');
      await renderSettings();
    });

    showStorageInfo();
  }

  /* ---------------------------------------------------------------
   * このアプリが使っている保存容量を表示する。
   * あわせて、ブラウザに「データを勝手に消さないでほしい」と依頼済みかも表示する。
   * --------------------------------------------------------------- */
  async function showStorageInfo() {
    const el = $('#storageInfo');
    if (!el) return;
    try {
      if (!navigator.storage || !navigator.storage.estimate) {
        el.textContent = 'この環境では使用量を取得できません。';
        return;
      }
      const estimate = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!$('#storageInfo')) return;
      $('#storageInfo').textContent =
        `使用中：約 ${Util.formatBytes(estimate.usage)}（本 ${state.books.length} 冊）。` +
        (persisted ? 'データの保護：有効' : 'データの保護：未設定（ホーム画面に追加して使うと消えにくくなります）');
    } catch (err) {
      el.textContent = '使用量を取得できませんでした。';
    }
  }

  /* ---------------------------------------------------------------
   * バックアップファイルが選ばれたときの処理。
   * 中身を確かめ、「追加する／置き換える／やめる」を選ぶ欄を表示する。
   * --------------------------------------------------------------- */
  async function onBackupChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    const panel = $('#importPanel');
    if (!file || !panel) return;

    let data;
    try {
      data = await Backup.readFile(file);
    } catch (err) {
      toast(err.message);
      return;
    }

    const when = data.exportedAt ? Util.formatDate(Date.parse(data.exportedAt)) : '日付不明';
    // 写真なしのバックアップかどうか（includesImages が false のもの）
    const light = data.includesImages === false;
    const summary = light
      ? `本 ${data.books.length} 冊、写真なし`
      : `本 ${data.books.length} 冊、写真 ${(data.images || []).length} 枚`;
    const lightNote = light
      ? '<p class="note">写真を含まないバックアップです。この端末に同じ本の写真が残っている場合、その写真は消さずにそのまま使います。</p>'
      : '';
    panel.hidden = false;
    panel.innerHTML = `
      <p>${when} に書き出したバックアップです（${summary}）。読み込み方を選んでください。</p>
      ${lightNote}
      <div class="btn-row">
        <button type="button" class="btn" data-mode="merge">今のデータに追加する</button>
        <button type="button" class="btn btn-danger" data-mode="replace">今のデータと置き換える</button>
        <button type="button" class="btn" data-mode="cancel">やめる</button>
      </div>`;

    panel.onclick = async (ev) => {
      const btn = ev.target.closest('[data-mode]');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === 'cancel') {
        panel.hidden = true;
        return;
      }
      if (mode === 'replace' && !confirm('今のデータをすべて消して、バックアップの内容に置き換えます。よろしいですか？')) {
        return;
      }
      try {
        await Backup.restore(data, mode);
        // 設定（ジャンル・並べ替え）を読み直してから画面を描き直す
        state.genres = await DB.getSetting('genres', []);
        state.series = await DB.getSetting('seriesList', []);
        state.sort = await DB.getSetting('sort', 'yomi');
        await removeAutoSeries(); // 古い版のバックアップに含まれる、自動入力されたシリーズ名を取り除く
        toast('バックアップを読み込みました');
        await renderSettings();
      } catch (err) {
        console.error(err);
        toast('読み込めませんでした。端末の空き容量を確認してください。');
      }
    };
  }

  /* =================================================================
   * 7. 起動処理
   * ================================================================= */

  async function init() {
    // ----- 保存してある設定を読み込む -----
    try {
      state.genres = await DB.getSetting('genres', []);
      state.series = await DB.getSetting('seriesList', []);
      state.sort = await DB.getSetting('sort', 'yomi');
      await removeAutoSeries(); // 以前の版で自動入力されたシリーズ名を取り除く
    } catch (err) {
      console.error(err);
      view.innerHTML = '<p class="empty">データの保存場所を開けませんでした。Safari のプライベートブラウズでは使えません。通常のタブで開いてください。</p>';
      return;
    }

    // ----- どの画面でも共通の操作を登録する -----
    $('#photoInput').addEventListener('change', onPhotosChosen);
    $('#backupInput').addEventListener('change', onBackupChosen);
    $('#scanClose').addEventListener('click', closeScanner);
    setupViewerGestures();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeScanner(); closeViewer(); }
      // 拡大表示中は、←→キーで前後の写真へ移る
      if (viewer.open && e.key === 'ArrowLeft') viewerStep(-1);
      if (viewer.open && e.key === 'ArrowRight') viewerStep(1);
    });

    // ----- 画面の切り替えを開始する -----
    window.addEventListener('hashchange', route);
    await route();

    // ----- ブラウザに「このサイトのデータを自動で消さないでほしい」と依頼する -----
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    // ----- サービスワーカーの登録（電波が無くてもアプリを開けるようにする仕組み） -----
    // https:// または localhost で開いているときだけ使える
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('サービスワーカーを登録できませんでした:', err);
      });
    }
  }

  /* =================================================================
   * 8. シリーズ画面
   *
   * シリーズは利用者が自分で名前を付けて作る「本のまとまり」。
   * データの持ち方：
   *   ・シリーズ名の一覧 … 設定の 'seriesList' に保存（本が 0 冊のシリーズも残すため）
   *   ・どの本がどのシリーズか … 各本の series にシリーズ名を入れる（1 冊につき 1 シリーズ）
   * ================================================================= */

  /** 全てのシリーズ名を返す。利用者が自分で作成したシリーズだけが対象 */
  function allSeries() {
    return state.series.slice();
  }

  /* ---------------------------------------------------------------
   * 利用者が作成していないシリーズ名を、本から取り除く。
   *
   * 以前の版では、書誌データに含まれるシリーズ名（「〇〇文庫」などの
   * レーベル名）を自動で本に入力していた。現在はシリーズを利用者が
   * 自分で作成して本を入れる方式なので、自動で入った名前は不要になる。
   * そこで「作成済みシリーズの一覧に無い名前」が付いている本を探し、
   * シリーズなしの状態に戻す。
   * 起動時と、バックアップを読み込んだ直後に実行する。
   * --------------------------------------------------------------- */
  async function removeAutoSeries() {
    const books = await DB.getAllBooks();
    const targets = books.filter((b) => b.series && !state.series.includes(b.series));
    if (targets.length === 0) return;
    targets.forEach((b) => { b.series = ''; });
    await DB.putBooks(targets);
  }

  /** シリーズのページへのリンク先を作る。名前に記号が入っていても URL が壊れないよう変換する */
  function seriesHref(name) {
    return '#/series/' + encodeURIComponent(name);
  }

  /** 巻数の順に比べる（巻数が同じ・無い場合は五十音順） */
  function compareVolume(a, b) {
    return collator.compare(a.volume || '', b.volume || '') || compareYomi(a, b);
  }

  /* ---------------------------------------------------------------
   * シリーズの一覧画面。シリーズ名と冊数を並べ、新しいシリーズを作れる。
   * --------------------------------------------------------------- */
  async function renderSeriesList() {
    state.books = await DB.getAllBooks();
    const names = allSeries().sort(collator.compare);

    const rows = names.length
      ? names.map((name) => {
          const count = state.books.filter((b) => b.series === name).length;
          return `
            <li class="row">
              <a class="row-link series-link" href="${seriesHref(name)}">
                <span class="row-title">${Util.esc(name)}</span>
                <span class="group-count">${count} 冊</span>
              </a>
            </li>`;
        }).join('')
      : '';

    view.innerHTML = `
      ${barHtml({ title: 'シリーズ', backHref: '#/', backLabel: '一覧' })}
      <div class="series-new">
        <div class="inline-form">
          <input type="text" id="newSeries" placeholder="新しいシリーズの名前" aria-label="新しいシリーズの名前" autocomplete="off">
          <button type="button" id="addSeries" class="btn btn-primary">作成</button>
        </div>
      </div>
      ${names.length
        ? `<ul class="rows series-rows">${rows}</ul>`
        : '<p class="empty">シリーズはまだありません。上の欄に名前を入力して作成してください。</p>'}
    `;

    // 新しいシリーズを作り、そのシリーズのページ（本を選ぶ入口）へ移動する
    const addSeries = async () => {
      const name = $('#newSeries').value.trim();
      if (!name) return;
      if (allSeries().includes(name)) {
        toast('同じ名前のシリーズがあります');
        return;
      }
      state.series.push(name);
      await DB.setSetting('seriesList', state.series);
      location.hash = seriesHref(name);
    };
    $('#addSeries').addEventListener('click', addSeries);
    $('#newSeries').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) addSeries();
    });
  }

  /* ---------------------------------------------------------------
   * シリーズ 1 つ分の画面。そのシリーズの本を巻数順に並べる。
   * 名前の変更、入れる本の選択、シリーズの削除ができる。
   * --------------------------------------------------------------- */
  async function renderSeriesDetail(name) {
    state.books = await DB.getAllBooks();
    if (!allSeries().includes(name)) {
      view.innerHTML =
        barHtml({ title: 'シリーズ', backHref: '#/series', backLabel: 'シリーズ' }) +
        '<p class="empty">このシリーズは見つかりませんでした。</p>';
      return;
    }
    const books = state.books.filter((b) => b.series === name).sort(compareVolume);

    view.innerHTML = `
      ${barHtml({ title: 'シリーズ', backHref: '#/series', backLabel: 'シリーズ' })}
      <div class="series-head">
        <h2 class="detail-title">${Util.esc(name)}</h2>
        <p class="note">${books.length} 冊</p>
        <div class="btn-row">
          <a class="btn btn-primary" href="${seriesHref(name)}/pick">本を選ぶ</a>
          <button type="button" id="renameSeries" class="btn">名前を変更</button>
          <button type="button" id="deleteSeries" class="btn btn-danger">シリーズを削除</button>
        </div>
      </div>
      ${books.length
        ? `<ul class="rows series-rows">${books.map((b) => rowHtml(b, false)).join('')}</ul>`
        : '<p class="empty">このシリーズにはまだ本がありません。「本を選ぶ」から追加してください。</p>'}
    `;

    // このシリーズの本の並びを覚える（詳細画面での前後移動が、シリーズの中の順番になる）
    state.navIds = books.map((b) => b.id);

    // 名前の変更：シリーズ名の一覧と、そのシリーズの本の両方を書き換える
    $('#renameSeries').addEventListener('click', async () => {
      const newName = (prompt('新しい名前を入力してください', name) || '').trim();
      if (!newName || newName === name) return;
      if (allSeries().includes(newName)) {
        toast('同じ名前のシリーズがあります');
        return;
      }
      state.series = state.series.filter((s) => s !== name).concat(newName);
      books.forEach((b) => { b.series = newName; });
      await DB.setSetting('seriesList', state.series);
      if (books.length) await DB.putBooks(books);
      location.replace(seriesHref(newName));
    });

    // シリーズの削除：まとまりだけを消す。本そのものは削除しない
    $('#deleteSeries').addEventListener('click', async () => {
      if (!confirm(`シリーズ「${name}」を削除します。\n本は削除されず、シリーズに入っていない状態に戻ります。`)) return;
      state.series = state.series.filter((s) => s !== name);
      books.forEach((b) => { b.series = ''; });
      await DB.setSetting('seriesList', state.series);
      if (books.length) await DB.putBooks(books);
      toast('シリーズを削除しました');
      location.replace('#/series');
    });
  }

  /* ---------------------------------------------------------------
   * シリーズに入れる本を選ぶ画面。
   * 全ての本をチェック欄付きで並べ、チェックを付けた本をそのシリーズに入れる。
   * 「保存」を押すまでは何も変更されない。
   * --------------------------------------------------------------- */
  async function renderSeriesPick(name) {
    state.books = await DB.getAllBooks();
    const books = state.books.slice().sort(compareYomi);

    const rows = books.map((b) => {
      // 別のシリーズに入っている本は、そのことを表示する（チェックすると、こちらのシリーズへ移る）
      const other = b.series && b.series !== name ? `「${Util.esc(b.series)}」に入っています` : '';
      const sub = [Util.esc(b.author || ''), other].filter(Boolean).join('　');
      // data-search：絞り込み用に、題名・よみ・作者をそろえた文字列を持たせておく
      const search = [b.title, b.titleYomi, b.author].map(Util.searchText).join('\u0001');
      return `
        <li class="row" data-search="${Util.esc(search)}">
          <label class="row-link pick-row">
            <input type="checkbox" value="${b.id}"${b.series === name ? ' checked' : ''}>
            <span class="row-text">
              <span class="row-title">${titleHtml(b)}</span>
              ${sub ? `<span class="row-sub">${sub}</span>` : ''}
            </span>
          </label>
        </li>`;
    }).join('');

    view.innerHTML = `
      ${barHtml({ title: '本を選ぶ', backHref: seriesHref(name), backLabel: '戻る' })}
      <div class="tools">
        <p class="note">「${Util.esc(name)}」に入れる本にチェックを付けて、下の「保存する」を押してください。</p>
        <input type="search" id="pickQ" class="search" placeholder="題名・作者で絞り込み" aria-label="本を絞り込み" autocomplete="off">
      </div>
      ${books.length
        ? `<ul class="rows" id="pickRows">${rows}</ul>`
        : '<p class="empty">本がまだ登録されていません。</p>'}
      <button type="button" id="savePick" class="fab">保存する</button>
    `;

    // 絞り込み：一致しない行を隠すだけ（隠れた行のチェック状態はそのまま残る）
    $('#pickQ').addEventListener('input', (e) => {
      const q = Util.searchText(e.target.value);
      document.querySelectorAll('#pickRows .row').forEach((li) => {
        li.hidden = Boolean(q) && !li.dataset.search.includes(q);
      });
    });

    // 保存：チェックの状態と今の所属を比べ、変わった本だけを書き換える
    $('#savePick').addEventListener('click', async () => {
      const changed = [];
      document.querySelectorAll('#pickRows input[type="checkbox"]').forEach((box) => {
        const book = state.books.find((b) => b.id === box.value);
        if (!book) return;
        if (box.checked && book.series !== name) {
          book.series = name;          // このシリーズに入れる
          changed.push(book);
        } else if (!box.checked && book.series === name) {
          book.series = '';            // このシリーズから外す
          changed.push(book);
        }
      });
      try {
        if (!state.series.includes(name)) {
          state.series.push(name);
          await DB.setSetting('seriesList', state.series);
        }
        if (changed.length) await DB.putBooks(changed);
      } catch (err) {
        console.error(err);
        toast('保存できませんでした');
        return;
      }
      toast('シリーズの本を保存しました');
      location.replace(seriesHref(name));
    });
  }

  /* =================================================================
   * 9. 説明ページ（中継プログラムの作り方）
   *
   * 設定画面の「中継プログラムの作り方を見る」から開くページ。
   * iPhone では同梱の README を読めないため、同じ内容をアプリの中で読めるようにしている。
   * 貼り付けるプログラム（proxy/ndl-proxy.gs）もこのページに表示し、
   * ボタン 1 つでコピーできるようにしている。
   * ================================================================= */
  async function renderHelpProxy() {
    view.innerHTML = `
      ${barHtml({ title: '中継プログラムの作り方', backHref: '#/settings', backLabel: '設定' })}
      <article class="help">
        <section class="panel">
          <h2>中継プログラムとは</h2>
          <p>ブラウザの安全上の決まりにより、このアプリから国立国会図書館サーチ（NDLサーチ）へ直接問い合わせても、結果を読めない場合があります。中継プログラムは、アプリの代わりに NDLサーチへ問い合わせて、結果をアプリに返す役目をします。</p>
          <p>「書誌を検索」が毎回「NDLサーチに接続できませんでした」になる場合だけ必要です。Google アカウントがあれば無料で作れます。</p>
          <p class="note">文字の貼り付けが多いので、パソコンでの作業をおすすめします。その場合は、パソコンでこのアプリの同じページを開くと、下のプログラムをコピーできます。</p>
        </section>

        <section class="panel">
          <h2>作り方</h2>
          <ol class="steps">
            <li>
              <p>下の「プログラムをコピー」を押して、貼り付けるプログラムをコピーします。</p>
              <button type="button" id="copyCode" class="btn btn-primary">プログラムをコピー</button>
              <textarea id="proxyCode" class="code" rows="8" readonly aria-label="中継プログラムの内容">読み込んでいます…</textarea>
            </li>
            <li>
              <p><a href="https://script.google.com/" target="_blank" rel="noopener">Google Apps Script（script.google.com）</a>を開き、Google アカウントでログインして「新しいプロジェクト」を押します。</p>
            </li>
            <li>
              <p>最初から入っている文字（function myFunction … ）をすべて消し、コピーしたプログラムを貼り付けて、保存します。</p>
            </li>
            <li>
              <p>右上の「デプロイ」→「新しいデプロイ」を押し、種類の選択（歯車のマーク）で「ウェブアプリ」を選びます。</p>
            </li>
            <li>
              <p>「次のユーザーとして実行」を「自分」、「アクセスできるユーザー」を「全員」にして、「デプロイ」を押します。</p>
              <p class="note">初回は「アクセスを承認」の画面が出ます。自分のアカウントを選び、警告が出た場合は「詳細」から先へ進んで許可してください。自分で作ったプログラムに対する確認です。</p>
            </li>
            <li>
              <p>表示された「ウェブアプリ」の URL（https://script.google.com/macros/s/ … /exec）をコピーします。</p>
            </li>
            <li>
              <p>このアプリの設定画面に戻り、「書誌検索」の「中継URL」に貼り付けて、「中継URL を保存」を押します。</p>
              <a class="btn" href="#/settings">設定画面に戻る</a>
            </li>
          </ol>
        </section>

        <section class="panel">
          <h2>確認の方法</h2>
          <p>「本を登録」で ISBN を入力して「書誌を検索」を押し、題名などが自動で入れば成功です。</p>
          <p class="note">Google の画面の表記は変更されることがあります。同じ名前の項目が見つからない場合は、近い名前の項目を探してください。</p>
        </section>
      </article>
    `;

    // 貼り付けるプログラムの中身を、アプリに同梱しているファイルから読み込んで表示する
    const codeBox = $('#proxyCode');
    try {
      const res = await fetch('proxy/ndl-proxy.gs');
      if (!res.ok) throw new Error('読み込み失敗');
      const text = await res.text();
      if ($('#proxyCode')) $('#proxyCode').value = text;
    } catch (err) {
      console.warn(err);
      codeBox.value = '';
      codeBox.placeholder = 'プログラムを読み込めませんでした。電波の状況を確認して、ページを開き直してください。';
      $('#copyCode').disabled = true;
    }

    // コピーボタン：プログラム全体をクリップボードに入れる
    $('#copyCode').addEventListener('click', async () => {
      const box = $('#proxyCode');
      try {
        await navigator.clipboard.writeText(box.value);
        toast('プログラムをコピーしました');
      } catch (err) {
        // クリップボード機能を使えない環境では、全体を選択状態にして手動でコピーしてもらう
        box.focus();
        box.select();
        toast('全体を選択しました。「コピー」を押してください');
      }
    });
  }

  init();

  return { state };
})();
