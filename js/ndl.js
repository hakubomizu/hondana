/* =====================================================================
 * ndl.js ― 国立国会図書館サーチ（NDLサーチ）API で書誌情報を取得する
 *
 * ISBN を渡すと、題名・よみがな・作者・出版社などを調べて返します。
 * 使っているのは NDLサーチの「OpenSearch」という検索用 API で、
 * 結果は XML（RSS 形式）で返ってきます。
 *
 *   リクエスト例：
 *   https://ndlsearch.ndl.go.jp/api/opensearch?isbn=9784832203655&cnt=20
 *
 * 【通信経路について】
 *   ブラウザには「別のサイトへの通信は、相手側が許可している場合だけ
 *   結果を読める」という安全上の決まり（CORS）があります。
 *   NDLサーチがこの許可を出していない場合、アプリから直接は読めません。
 *   そのときは設定画面で「中継URL」を登録すると、
 *   中継プログラム（proxy フォルダ参照）を経由して取得します。
 *     中継URL が未設定 … NDLサーチへ直接問い合わせる
 *     中継URL が設定済 … 中継URL へ問い合わせる
 * ===================================================================== */

const NDL = (() => {
  const ENDPOINT = 'https://ndlsearch.ndl.go.jp/api/opensearch';
  const TIMEOUT_MS = 15000; // 15 秒待って返事が無ければあきらめる

  // XML の中で使われている「名前空間」。dc:title などの「dc:」の正式名称にあたる。
  const NS = {
    dc: 'http://purl.org/dc/elements/1.1/',
    dcndl: 'http://ndl.go.jp/dcndl/terms/',
    dcterms: 'http://purl.org/dc/terms/'
  };

  /* ---------------------------------------------------------------
   * XML の 1 件分（item）から、指定した項目の文字を全て取り出す。
   * 例：values(item, 'dc', 'creator') → 作者名の配列
   * --------------------------------------------------------------- */
  function values(item, prefix, name) {
    const nodes = item.getElementsByTagNameNS(NS[prefix], name);
    const result = [];
    for (const node of nodes) {
      const text = (node.textContent || '').trim();
      if (text) result.push(text);
    }
    return result;
  }

  /* ---------------------------------------------------------------
   * 作者名の表記を整える。
   * NDL の書誌では「夏目, 漱石, 1867-1916」のように
   * 「姓, 名, 生没年」の形で入っていることがあるため、
   *   ・生没年など数字を含む部分を取り除く
   *   ・日本語名は「夏目漱石」とつなげる
   *   ・アルファベットを含む名前は「名 姓」の順にして空白でつなぐ
   * という整形を行う。
   * --------------------------------------------------------------- */
  function cleanCreator(raw) {
    const parts = raw
      .split(/[,，]\s*/)
      .map((p) => p.trim())
      .filter((p) => p && !/\d{3,4}/.test(p));
    if (parts.length <= 1) return parts[0] || raw.trim();
    const hasLatin = parts.some((p) => /[A-Za-z]/.test(p));
    return hasLatin ? parts.slice().reverse().join(' ') : parts.join('');
  }

  /* ---------------------------------------------------------------
   * XML の 1 件分（item）を、アプリで扱いやすい形に変換する。
   * --------------------------------------------------------------- */
  function parseItem(item) {
    const creators = values(item, 'dc', 'creator').map(cleanCreator);
    const linkNode = item.getElementsByTagName('link')[0];
    return {
      title: values(item, 'dc', 'title')[0] || '',
      titleYomi: Util.cleanYomi(values(item, 'dcndl', 'titleTranscription')[0] || ''),
      // 同じ名前が重複して入っていることがあるので、重複を除いて「、」でつなぐ
      author: Array.from(new Set(creators)).join('、'),
      publisher: values(item, 'dc', 'publisher')[0] || '',
      volume: values(item, 'dcndl', 'volume')[0] || '',
      series: values(item, 'dcndl', 'seriesTitle')[0] || '',
      link: linkNode ? (linkNode.textContent || '').trim() : ''
    };
  }

  /* ---------------------------------------------------------------
   * 候補の「情報の充実度」を点数化する。
   * 1 つの ISBN に対して、国会図書館の蔵書データ・出版社由来のデータなど
   * 複数の候補が返ることがあるため、最も情報がそろっているものを選ぶ。
   * よみがなは並べ替えに必要なので配点を高くしている。
   * --------------------------------------------------------------- */
  function score(c) {
    let s = 0;
    if (c.title) s += 1;
    if (c.titleYomi) s += 4;
    if (c.author) s += 2;
    if (c.publisher) s += 2;
    // 「R100000002」は国立国会図書館自身の蔵書目録を表す番号。整理された書誌なので少し優先する
    if (c.link.indexOf('R100000002') !== -1) s += 1;
    return s;
  }

  /* ---------------------------------------------------------------
   * 受け取った XML 文字列を解析して、書誌情報 1 件にまとめる。
   * 見つからなかった場合は null を返す。
   * --------------------------------------------------------------- */
  function parseXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('書誌データの形式を読み取れませんでした');
    }
    const items = Array.from(doc.getElementsByTagName('item'));
    if (items.length === 0) return null;

    // 点数の高い順に並べ、先頭を採用する
    const candidates = items.map(parseItem).sort((a, b) => score(b) - score(a));
    const best = Object.assign({}, candidates[0]);

    // 採用した候補に空欄があれば、他の候補の値で補う
    ['title', 'titleYomi', 'author', 'publisher', 'volume', 'series'].forEach((key) => {
      if (!best[key]) {
        const other = candidates.find((c) => c[key]);
        if (other) best[key] = other[key];
      }
    });
    delete best.link;
    return best.title ? best : null;
  }

  /* ---------------------------------------------------------------
   * ISBN（13 桁）から書誌情報を取得する。この機能の入口。
   *
   * 戻り値：
   *   { status: 'found',    book: { title, titleYomi, author, publisher, volume, series } }
   *   { status: 'notfound' }                … 通信はできたが該当する本が無い
   *   { status: 'error', reason: 'network' } … 通信できなかった（圏外・CORS など）
   *   { status: 'error', reason: 'server'  } … 相手のサーバーがエラーを返した
   * --------------------------------------------------------------- */
  async function lookup(isbn13) {
    const proxyUrl = (await DB.getSetting('proxyUrl', '')).trim();
    const query = 'isbn=' + encodeURIComponent(isbn13) + '&cnt=20';
    let url;
    if (proxyUrl) {
      // 中継URL にすでに「?」が含まれている場合は「&」でつなぐ
      url = proxyUrl + (proxyUrl.indexOf('?') === -1 ? '?' : '&') + query;
    } else {
      url = ENDPOINT + '?' + query;
    }

    // 一定時間で通信を打ち切るための仕組み
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return { status: 'error', reason: 'server' };
      const text = await res.text();
      const book = parseXml(text);
      return book ? { status: 'found', book } : { status: 'notfound' };
    } catch (err) {
      // fetch が失敗する主な原因：圏外、時間切れ、CORS による遮断
      console.warn('NDLサーチへの問い合わせに失敗:', err);
      return { status: 'error', reason: 'network', viaProxy: Boolean(proxyUrl) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { lookup, parseXml };
})();
