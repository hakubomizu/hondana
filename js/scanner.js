/* =====================================================================
 * scanner.js ― カメラで ISBN バーコードを読み取る
 *
 * 端末の背面カメラの映像を <video> に映し、その映像から
 * バーコードを探して読み取ります。
 * 読み取りにはオープンソースのライブラリ「ZXing」（lib/zxing.min.js）を
 * 使っています。iPhone の Safari にはバーコード読み取りの標準機能が
 * 無いため、ライブラリで補っています。
 *
 * 【日本の本のバーコードについて】
 *   裏表紙にはバーコードが上下 2 段あります。
 *     上段：978（または 979）で始まる 13 桁 … これが ISBN
 *     下段：192 で始まる 13 桁           … 分類と価格のコード（ISBN ではない）
 *   このアプリは上段だけを採用し、下段を読んだ場合は案内を出します。
 *
 * 【注意】
 *   カメラは https:// で始まるページ（または localhost）でしか使えません。
 * ===================================================================== */

const Scanner = (() => {
  let reader = null;     // ZXing の読み取り器
  let finished = false;  // 1 回読み取ったら、それ以降の結果を無視するための印

  /** この端末・ページでカメラが使えるかを調べる */
  function isSupported() {
    return Boolean(
      window.ZXing &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    );
  }

  /* ---------------------------------------------------------------
   * 読み取りを開始する。
   *   videoEl  … カメラ映像を映す <video> 要素
   *   handlers … 状況ごとに呼ばれる関数をまとめたもの
   *     onIsbn(isbn13) … ISBN を読み取れたとき（1 回だけ呼ばれる）
   *     onHint(text)   … ISBN 以外のバーコードを読んだときの案内
   *     onError(text)  … カメラを起動できなかったとき
   * --------------------------------------------------------------- */
  async function start(videoEl, handlers) {
    stop(); // 念のため、前回の読み取りが残っていれば止める
    finished = false;

    if (!isSupported()) {
      handlers.onError('このページではカメラを使えません。ISBN を手入力してください。');
      return;
    }

    // 読み取る対象を EAN-13（書籍 JAN コードの規格）だけに絞る。
    // 対象を絞ると読み取りが速くなり、誤認識も減る。
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]);
    // 注意：TRY_HARDER（より念入りに探す指定）は付けないこと。
    // 付けると、バーコードが映っていないコマで内部エラーになり、連続読み取りが止まってしまう。
    // 第 2 引数は「次の読み取りを試すまでの間隔（ミリ秒）」
    reader = new ZXing.BrowserMultiFormatReader(hints, 200);

    // 背面カメラを、できるだけ細かい映像で使うよう指定する
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    try {
      await reader.decodeFromConstraints(constraints, videoEl, (result) => {
        // バーコードが見つからないコマでは result が空で呼ばれるので、何もしない
        if (!result || finished) return;
        const code = result.getText();

        if (/^97[89]/.test(code) && Util.isValidIsbn13(code)) {
          finished = true;
          stop();
          handlers.onIsbn(code);
        } else if (/^19/.test(code)) {
          handlers.onHint('それは下段のバーコードです。上段（978 から始まる方）を映してください。');
        } else {
          handlers.onHint('ISBN ではないバーコードです。978 から始まるバーコードを映してください。');
        }
      });
    } catch (err) {
      console.warn('カメラの起動に失敗:', err);
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      handlers.onError(
        denied
          ? 'カメラの使用が許可されていません。iPhone の「設定」→「Safari」→「カメラ」を確認してください。'
          : 'カメラを起動できませんでした。ISBN を手入力してください。'
      );
    }
  }

  /** 読み取りを止め、カメラを解放する（カメラの使用中ランプが消える） */
  function stop() {
    if (reader) {
      try {
        reader.reset();
      } catch (err) {
        console.warn('カメラの停止に失敗:', err);
      }
      reader = null;
    }
  }

  return { isSupported, start, stop };
})();
