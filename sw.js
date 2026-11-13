/* =====================================================================
 * sw.js ― サービスワーカー（電波が無くてもアプリを開けるようにする仕組み）
 *
 * サービスワーカーは、ページとは別に裏側で動く小さなプログラムで、
 * アプリのファイル（HTML・CSS・JavaScript・アイコン）を端末に控えておきます。
 *
 * 方針：「まず通信、だめなら控え」
 *   ・電波があるとき … サーバーから最新のファイルを取得し、控えも更新する。
 *                       → ファイルを更新すれば、次に開いたとき自動で新しくなる。
 *   ・電波がないとき … 控えておいたファイルを使う。
 *
 * 対象は「このアプリ自身のファイル」だけです。
 * NDLサーチなど外部への通信には手を加えません。
 * 本のデータや写真は IndexedDB に入っているので、ここでは扱いません。
 * ===================================================================== */

const CACHE_NAME = 'hondana-v1'; // 控えの名前

// 最初にまとめて控えておくファイルの一覧
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/util.js',
  'js/db.js',
  'js/ndl.js',
  'js/image.js',
  'js/scanner.js',
  'js/backup.js',
  'js/app.js',
  'lib/zxing.min.js',
  'proxy/ndl-proxy.gs', // 説明ページで表示する中継プログラム
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// 導入時：ファイルをまとめて控える
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

// 有効化時：古い名前の控えが残っていれば削除する
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// 通信が発生するたびに呼ばれる
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const sameOrigin = new URL(request.url).origin === self.location.origin;

  // 外部（NDLサーチ・中継URL）への通信や、読み取り以外の通信はそのまま通す
  if (request.method !== 'GET' || !sameOrigin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // 取得できたら控えを更新してから、その内容を返す
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // 通信できなかったら控えを返す
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
