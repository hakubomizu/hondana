/* =====================================================================
 * image.js ― 写真の縮小・圧縮
 *
 * iPhone のカメラで撮った写真は 1 枚あたり数 MB あり、
 * そのまま保存すると端末の保存容量をすぐに使い切ってしまいます。
 * そこで保存前に、
 *   1. 長い方の辺が指定の大きさに収まるよう縮小し、
 *   2. JPEG 形式で圧縮して、
 * 1 枚あたり 100〜300 KB 程度まで小さくします。
 *
 * 画像は「データURL」（画像の中身を文字列にしたもの）として扱います。
 * 文字列にしておくと、バックアップのファイル（JSON）にそのまま入れられます。
 * ===================================================================== */

const ImageTool = (() => {
  const MAX_SIDE = 1200;   // 保存する写真の長辺の上限（ピクセル）
  const QUALITY = 0.8;     // JPEG の画質（0〜1。小さいほど容量が減るが粗くなる）
  const THUMB_SIDE = 160;  // 一覧用の小さな画像（サムネイル）の長辺
  const THUMB_QUALITY = 0.7;

  /* ---------------------------------------------------------------
   * 画像の入手元（ファイルまたはデータURL）を <img> 要素として読み込む。
   * <img> として読み込むと、撮影時の向き（縦・横）の情報も
   * ブラウザが自動的に反映してくれる。
   * --------------------------------------------------------------- */
  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const isFile = typeof source !== 'string';
      const url = isFile ? URL.createObjectURL(source) : source;
      img.onload = () => {
        if (isFile) URL.revokeObjectURL(url); // 読み込み用の一時URLを片付ける
        resolve(img);
      };
      img.onerror = () => {
        if (isFile) URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした'));
      };
      img.src = url;
    });
  }

  /* ---------------------------------------------------------------
   * 画像を、長辺が maxSide に収まる大きさで描き直し、
   * JPEG のデータURL として返す。
   * 元の画像が maxSide より小さい場合は拡大せず、そのままの大きさで圧縮する。
   * --------------------------------------------------------------- */
  function resize(img, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // 透過部分のある画像（PNG など）が黒くならないよう、先に白で塗る
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /** 撮影・選択された写真ファイルを、保存用に縮小・圧縮する */
  async function compress(file) {
    const img = await loadImage(file);
    return resize(img, MAX_SIDE, QUALITY);
  }

  /** 保存用の写真（データURL）から、一覧用のサムネイルを作る */
  async function makeThumb(dataUrl) {
    const img = await loadImage(dataUrl);
    return resize(img, THUMB_SIDE, THUMB_QUALITY);
  }

  return { compress, makeThumb };
})();
