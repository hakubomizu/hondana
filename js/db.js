/* =====================================================================
 * db.js ― データの保存と読み出し（IndexedDB）
 *
 * IndexedDB はブラウザに内蔵されているデータベースで、
 * 端末（iPhone）の中にデータを保存します。サーバーには送られません。
 *
 * 保存場所（オブジェクトストア）は 3 つあります。
 *   books    … 本 1 冊ごとの情報（題名・作者・出版社・ジャンルなど）
 *   images   … 撮影した写真（1 枚ごと。どの本の写真かを bookId で持つ）
 *   settings … ジャンルの一覧、並べ替えの選択などの設定
 *
 * 写真を books と分けている理由：
 *   一覧を表示するたびに全ての写真を読み込むと遅くなるため。
 *   一覧では books だけを読み、写真は詳細ページを開いたときに読む。
 * ===================================================================== */

const DB = (() => {
  const DB_NAME = 'hondana';   // データベース名
  const DB_VERSION = 1;        // 構造を変えるときはこの数字を上げる
  let dbPromise = null;        // 開いたデータベースを使い回すための入れ物

  /* ---------------------------------------------------------------
   * データベースを開く。
   * 初めて開いたとき（または版が上がったとき）は onupgradeneeded が呼ばれ、
   * そこで保存場所（ストア）を作成する。
   * --------------------------------------------------------------- */
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          // ISBN から本を探せるようにする（重複チェック用）
          books.createIndex('isbn', 'isbn', { unique: false });
        }
        if (!db.objectStoreNames.contains('images')) {
          const images = db.createObjectStore('images', { keyPath: 'id' });
          // 本の ID からその本の写真を探せるようにする
          images.createIndex('bookId', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  /* ---------------------------------------------------------------
   * IndexedDB の「リクエスト」を Promise に変換する補助関数。
   * これで await を使って結果を受け取れるようになる。
   * --------------------------------------------------------------- */
  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /* ---------------------------------------------------------------
   * 取引（トランザクション）が最後まで完了するのを待つ補助関数。
   * 複数の書き込みをまとめて行うときに使う。
   * --------------------------------------------------------------- */
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
    });
  }

  /* ===================== 本（books） ===================== */

  /** 全ての本を配列で取得する（一覧表示用） */
  async function getAllBooks() {
    const db = await open();
    return promisify(db.transaction('books').objectStore('books').getAll());
  }

  /** ID を指定して本を 1 冊取得する（詳細ページ用） */
  async function getBook(id) {
    const db = await open();
    return promisify(db.transaction('books').objectStore('books').get(id));
  }

  /** 本を保存する。同じ ID があれば上書き、無ければ新規追加になる */
  async function putBook(book) {
    const db = await open();
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(book);
    return txDone(tx);
  }

  /** 複数の本をまとめて保存する（好きな順番の並べ替え結果の保存に使う） */
  async function putBooks(books) {
    const db = await open();
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    books.forEach((b) => store.put(b));
    return txDone(tx);
  }

  /** 本を削除する。その本の写真も一緒に削除する */
  async function deleteBook(id) {
    const db = await open();
    const tx = db.transaction(['books', 'images'], 'readwrite');
    tx.objectStore('books').delete(id);
    // その本に紐づく写真のキーを調べて、1 枚ずつ削除する
    const index = tx.objectStore('images').index('bookId');
    const keysReq = index.getAllKeys(id);
    keysReq.onsuccess = () => {
      keysReq.result.forEach((key) => tx.objectStore('images').delete(key));
    };
    return txDone(tx);
  }

  /* ===================== 写真（images） ===================== */

  /** ある本の写真を全て取得し、撮影（追加）した順に並べて返す */
  async function getImagesByBook(bookId) {
    const db = await open();
    const list = await promisify(
      db.transaction('images').objectStore('images').index('bookId').getAll(bookId)
    );
    return list.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  /**
   * ある本の写真を「渡された一覧の内容」に置き換える。
   * 編集画面で写真を追加・削除した結果をまとめて反映するための処理。
   * 一覧に無くなった写真は削除し、残っているもの・新しいものは保存する。
   */
  async function replaceImages(bookId, images) {
    const db = await open();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const keepIds = new Set(images.map((img) => img.id));
    const keysReq = store.index('bookId').getAllKeys(bookId);
    keysReq.onsuccess = () => {
      keysReq.result.forEach((key) => {
        if (!keepIds.has(key)) store.delete(key);
      });
      images.forEach((img, i) => {
        store.put({ id: img.id, bookId, order: i, dataUrl: img.dataUrl });
      });
    };
    return txDone(tx);
  }

  /* ===================== 設定（settings） ===================== */

  /** 設定値を取得する。保存されていなければ fallback を返す */
  async function getSetting(key, fallback) {
    const db = await open();
    const row = await promisify(db.transaction('settings').objectStore('settings').get(key));
    return row ? row.value : fallback;
  }

  /** 設定値を保存する */
  async function setSetting(key, value) {
    const db = await open();
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    return txDone(tx);
  }

  /* ===================== バックアップ用 ===================== */

  /** 全データ（本・写真・設定）を 1 つのオブジェクトにまとめて取り出す */
  async function exportAll() {
    const db = await open();
    const tx = db.transaction(['books', 'images', 'settings']);
    const [books, images, settings] = await Promise.all([
      promisify(tx.objectStore('books').getAll()),
      promisify(tx.objectStore('images').getAll()),
      promisify(tx.objectStore('settings').getAll())
    ]);
    return { books, images, settings };
  }

  /**
   * バックアップのデータを書き戻す。
   *   mode = 'replace' … 今のデータを全て消してから書き戻す（完全に置き換え）
   *   mode = 'merge'   … 今のデータを残したまま追加する（同じ ID は上書き）
   * 1 つの取引で行うので、途中で失敗した場合は全て元に戻る。
   */
  async function importAll(data, mode) {
    const db = await open();
    const tx = db.transaction(['books', 'images', 'settings'], 'readwrite');
    const books = tx.objectStore('books');
    const images = tx.objectStore('images');
    const settings = tx.objectStore('settings');

    if (mode === 'replace') {
      books.clear();
      images.clear();
      settings.clear();
    }
    (data.books || []).forEach((b) => books.put(b));
    (data.images || []).forEach((img) => images.put(img));
    (data.settings || []).forEach((s) => {
      // 追加（merge）のときは、今の設定を上書きしない。
      // ただしジャンル一覧だけは、後で画面側が両方を合わせて保存し直す。
      if (mode === 'replace') settings.put(s);
    });
    return txDone(tx);
  }

  /** 全データを削除する（設定画面の「すべてのデータを削除」用） */
  async function clearAll() {
    const db = await open();
    const tx = db.transaction(['books', 'images', 'settings'], 'readwrite');
    tx.objectStore('books').clear();
    tx.objectStore('images').clear();
    tx.objectStore('settings').clear();
    return txDone(tx);
  }

  // このファイルの外から使える関数を公開する
  return {
    getAllBooks, getBook, putBook, putBooks, deleteBook,
    getImagesByBook, replaceImages,
    getSetting, setSetting,
    exportAll, importAll, clearAll
  };
})();
