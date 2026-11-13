/* =====================================================================
 * ndl-proxy.gs ― NDLサーチへの中継プログラム（Google Apps Script 用）
 *
 * 【これは何か】
 *   ブラウザの安全上の決まり（CORS）により、本棚アプリから NDLサーチへ
 *   直接問い合わせても結果を読めない場合があります。
 *   このプログラムは、アプリの代わりに NDLサーチへ問い合わせ、
 *   受け取った結果をそのままアプリへ返す「中継役」です。
 *
 *     本棚アプリ →（ISBN）→ この中継プログラム →（ISBN）→ NDLサーチ
 *     本棚アプリ ←（書誌）← この中継プログラム ←（書誌）← NDLサーチ
 *
 * 【必要になる場合】
 *   アプリで「書誌を検索」をしても、毎回「NDLサーチに接続できませんでした」
 *   と表示される場合だけ使います。直接取得できているなら不要です。
 *
 * 【設置方法】README.md の「中継プログラムの設置」を参照してください。
 * ===================================================================== */

/**
 * この中継プログラムの URL にアクセスがあると呼ばれる関数。
 * 例：https://script.google.com/macros/s/xxxx/exec?isbn=9784832203655
 */
function doGet(e) {
  // 受け取った ISBN から、数字と X 以外の文字を取り除く
  var isbn = String((e && e.parameter && e.parameter.isbn) || '').replace(/[^0-9Xx]/g, '');

  // ISBN の形（13 桁、または 10 桁）でなければ問い合わせない。
  // ISBN 検索以外の目的でこの中継プログラムを使われないようにするための確認。
  if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
    return ContentService
      .createTextOutput('<error>ISBN を指定してください</error>')
      .setMimeType(ContentService.MimeType.XML);
  }

  // NDLサーチの検索用 API（OpenSearch）へ問い合わせる
  var url = 'https://ndlsearch.ndl.go.jp/api/opensearch?cnt=20&isbn=' + isbn;
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  // 受け取った XML をそのまま返す
  return ContentService
    .createTextOutput(response.getContentText('UTF-8'))
    .setMimeType(ContentService.MimeType.XML);
}
