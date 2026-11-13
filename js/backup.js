/* =====================================================================
 * backup.js ― バックアップの書き出し・読み込み
 *
 * データは iPhone のブラウザ内にだけ保存されているため、
 * Safari のデータ消去や機種変更で失われる可能性があります。
 * その対策として、全データ（本・写真・設定）を 1 つのファイルに
 * まとめて書き出し、あとで読み込んで復元できるようにします。
 *
 * ファイルの形式は JSON（文字だけで構成されたデータ形式）です。
 * 写真もデータURL（文字列）として中に含まれます。
 * ===================================================================== */

const Backup = (() => {
  const APP_ID = 'hondana';  // このアプリのバックアップであることを示す目印
  const FORMAT_VERSION = 1;  // バックアップ形式の版

  /* ---------------------------------------------------------------
   * 全データをファイルに書き出す。
   *
   * iPhone では、ホーム画面から起動したアプリの中だと通常のダウンロードが
   * うまく動かない場合があるため、まず「共有」機能（ファイルに保存、
   * AirDrop などを選べる画面）を試し、使えない環境では通常のダウンロードを行う。
   *
   * 戻り値：書き出した本の冊数
   * --------------------------------------------------------------- */
  async function exportToFile() {
    const data = await DB.exportAll();
    const payload = {
      app: APP_ID,
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      books: data.books,
      images: data.images,
      settings: data.settings
    };

    // ファイル名に日付を入れる（例：hondana-backup-20261113.json）
    const d = new Date();
    const stamp =
      d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    const fileName = `hondana-backup-${stamp}.json`;

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const file = new File([blob], fileName, { type: 'application/json' });

    // 方法 1：共有機能（iPhone 向け）
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '本棚のバックアップ' });
        return data.books.length;
      } catch (err) {
        // 利用者が共有画面を閉じた場合は、何もせず終了する
        if (err && err.name === 'AbortError') return null;
        // それ以外の失敗は、下の通常ダウンロードを試す
        console.warn('共有に失敗したためダウンロードに切り替え:', err);
      }
    }

    // 方法 2：通常のダウンロード（パソコン向け）
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return data.books.length;
  }

  /* ---------------------------------------------------------------
   * 選ばれたファイルを読み、このアプリのバックアップとして正しいかを確かめる。
   * 正しければ中身（オブジェクト）を返し、そうでなければエラーにする。
   * 実際の書き戻しは、利用者が「置き換え／追加」を選んだあとに restore() で行う。
   * --------------------------------------------------------------- */
  async function readFile(file) {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('ファイルを読み取れませんでした。バックアップのファイルか確認してください。');
    }
    if (!data || data.app !== APP_ID || !Array.isArray(data.books)) {
      throw new Error('このアプリのバックアップファイルではありません。');
    }
    if (data.version > FORMAT_VERSION) {
      throw new Error('新しい版のアプリで作られたバックアップのため、読み込めません。');
    }
    return data;
  }

  /* ---------------------------------------------------------------
   * バックアップの中身をデータベースへ書き戻す。
   *   mode = 'replace' … 今のデータを消して、バックアップの内容に置き換える
   *   mode = 'merge'   … 今のデータに、バックアップの内容を追加する
   * --------------------------------------------------------------- */
  async function restore(data, mode) {
    // 名前の一覧を持つ設定（ジャンル一覧・シリーズ一覧）
    const LIST_KEYS = ['genres', 'seriesList'];

    // 追加の場合は、今ある一覧を先に控えておく
    const current = {};
    if (mode === 'merge') {
      for (const key of LIST_KEYS) {
        current[key] = await DB.getSetting(key, []);
      }
    }

    await DB.importAll(data, mode);

    if (mode === 'merge') {
      // 一覧は「今のもの」と「バックアップのもの」を合わせて保存し直す
      for (const key of LIST_KEYS) {
        const row = (data.settings || []).find((s) => s.key === key);
        const fromBackup = row && Array.isArray(row.value) ? row.value : [];
        const merged = Array.from(new Set(current[key].concat(fromBackup)));
        await DB.setSetting(key, merged);
      }
    }
  }

  return { exportToFile, readFile, restore };
})();
