/* =========================================================================
 * api.js — 網路服務（台股/美股報價、匯率、代碼搜尋）
 *
 * 瀏覽器 CORS 對策（皆原生支援 CORS，無需代理）：
 *   台股：FinMind API — TaiwanStockInfo（代碼/名稱/市場）+ TaiwanStockPrice（日收盤+漲跌）。
 *   美股：Finnhub /quote（報價）、/search（搜尋）。
 *   匯率：open.er-api.com（免金鑰）。
 *   後備：任一請求失敗時，自動改走可設定的 CORS proxy。
 *
 * 註：為「日收盤」資料，盤中顯示前一交易日收盤，收盤後更新為當日。
 * ======================================================================= */
window.App = window.App || {};

App.Api = (function () {
  const U = App.Util;
  const S = App.Store;

  const FINNHUB_KEY_DEFAULT = 'd663kahr01qssgeccncgd663kahr01qssgeccnd0';
  function finnhubKey() { return localStorage.getItem('dives_finnhub_key') || FINNHUB_KEY_DEFAULT; }

  // FinMind（台股）— 免金鑰可用，設定 token 可提高速率上限
  const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
  function finmindToken() { return localStorage.getItem('dives_finmind_token') || ''; }
  function fmUrl(params) {
    const u = new URLSearchParams(params);
    const t = finmindToken(); if (t) u.set('token', t);
    return FINMIND + '?' + u.toString();
  }
  function fmMarket(type) {
    if (type === 'twse') return U.Market.tse;
    if (type === 'tpex') return U.Market.otc;
    if (type === 'emerging') return U.Market.rotc;
    return U.Market.tse;
  }

  // 直連失敗（CORS / 網路）時自動改走 proxy
  async function fetchText(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      const proxy = S.getProxy();
      if (!proxy) throw e;
      const r2 = await fetch(proxy + encodeURIComponent(url), { cache: 'no-store' });
      if (!r2.ok) throw new Error('proxy HTTP ' + r2.status);
      return await r2.text();
    }
  }
  async function fetchJson(url) { return JSON.parse(await fetchText(url)); }

  // ---- 台股代碼表（FinMind TaiwanStockInfo）→ {code: {name, market}} ----
  async function loadTwUniverse(force) {
    if (!force && S.twUniverseFresh()) {
      const cached = S.getTwUniverse();
      if (cached) return cached;
    }
    const map = {};
    try {
      const j = await fetchJson(fmUrl({ dataset: 'TaiwanStockInfo' }));
      for (const r of (j.data || [])) {
        const code = (r.stock_id || '').trim();
        if (!code) continue;
        map[code] = { name: r.stock_name || code, market: fmMarket(r.type) };
      }
    } catch (e) { console.warn('FinMind TaiwanStockInfo failed', e); }
    if (Object.keys(map).length) S.setTwUniverse(map);
    return map || {};
  }

  // ---- 台股單檔日收盤（FinMind TaiwanStockPrice）----
  async function fetchTwPrice(code) {
    const start = U.isoDate(new Date(Date.now() - 12 * 86400000)); // 近 12 天，取最後一筆
    try {
      const j = await fetchJson(fmUrl({ dataset: 'TaiwanStockPrice', data_id: code, start_date: start }));
      const rows = j.data || [];
      if (!rows.length) return null;
      const last = rows[rows.length - 1];
      const close = U.parseNum(last.close);
      if (close == null) return null;
      const change = (typeof last.spread === 'number') ? last.spread : 0; // spread = 當日漲跌額
      return { price: close, dailyChange: change, prevClose: close - change };
    } catch (e) { return null; }
  }

  // ---- 台股歷史日線（FinMind，供重建歷史走勢）----
  // 回傳 { code: [{date, close}, ...]（升序）}
  async function fetchTwHistory(codes, startDate) {
    const out = {};
    const queue = [...codes];
    async function worker() {
      while (queue.length) {
        const code = queue.shift();
        try {
          const j = await fetchJson(fmUrl({ dataset: 'TaiwanStockPrice', data_id: code, start_date: startDate }));
          const rows = (j.data || []).map(r => ({ date: r.date, close: U.parseNum(r.close) }))
            .filter(r => r.close != null).sort((a, b) => a.date < b.date ? -1 : 1);
          out[code] = rows;
        } catch (e) { out[code] = []; }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return out;
  }

  // ---- 台股盤中即時（TWSE MIS，經 proxy；可批次多檔）----
  // 回傳 {code: {price, dailyChange, prevClose}}；盤中時段使用
  async function fetchTwRealtime(metas) {
    const exch = metas.map(m => {
      const prefix = U.normalizeMarketKey(m.market) === U.Market.otc ? 'otc' : 'tse';
      return prefix + '_' + m.code + '.tw';
    });
    const out = {};
    for (let i = 0; i < exch.length; i += 50) {
      const chunk = exch.slice(i, i + 50).join('|');
      try {
        const url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=' + encodeURIComponent(chunk);
        const j = await fetchJson(url);
        for (const it of (j.msgArray || [])) {
          const code = (it.c || ((it.key || '').split('_')[1] || '').split('.')[0] || '').trim();
          if (!code) continue;
          let price = U.parseNum(it.z);                       // 最近成交價
          if (price == null) price = U.parseNum(it.pz);       // 無成交→揭示價
          if (price == null) price = U.parseNum(it.o);        // →開盤
          if (price == null) continue;
          const prev = U.parseNum(it.y);                      // 昨收
          out[code] = { price, dailyChange: prev != null ? price - prev : 0, prevClose: prev };
        }
      } catch (e) { console.warn('MIS realtime failed', e); }
    }
    return out;
  }

  // ---- 美股單檔報價（Finnhub）----
  async function fetchUsQuote(symbol) {
    try {
      const j = await fetchJson('https://finnhub.io/api/v1/quote?symbol=' +
        encodeURIComponent(symbol) + '&token=' + encodeURIComponent(finnhubKey()));
      const c = j.c;
      if (!(c > 0)) return null;
      const pc = (typeof j.pc === 'number') ? j.pc : null;
      const d = (typeof j.d === 'number') ? j.d : (pc != null ? c - pc : 0);
      return { price: c, dailyChange: d, prevClose: pc };
    } catch (e) { return null; }
  }

  // ---- 匯率（open.er-api.com，6 小時快取）----
  async function fetchFx() {
    const cached = S.getFxRate(), ts = S.getFxTs();
    if (cached && ts && (Date.now() - ts < 6 * 3600 * 1000)) return cached;
    try {
      const j = await fetchJson('https://open.er-api.com/v6/latest/USD');
      const twd = j && j.rates && j.rates.TWD;
      if (twd > 0) { S.setFxRate(twd); return twd; }
    } catch (e) {}
    try {
      const j = await fetchJson('https://api.exchangerate.host/latest?base=USD&symbols=TWD');
      const twd = j && j.rates && j.rates.TWD;
      if (twd > 0) { S.setFxRate(twd); return twd; }
    } catch (e) {}
    return cached || 31.5;
  }

  // ---- 刷新所有（或指定）持倉報價 ----
  // 回傳更新後的 prices 字典；同時更新匯率與 meta 名稱
  async function refreshPrices(symbols) {
    const txs = S.getTransactions();
    const all = symbols || [...new Set(txs.map(t => t.symbol))];
    if (!all.length) { await fetchFx(); return S.getPrices(); }

    const mmap = S.metaMap();
    const metas = all.map(code => mmap[code] || { code, name: code, market: U.guessMarketBySymbol(code) });
    const twMetas = metas.filter(m => U.normalizeMarketKey(m.market) !== U.Market.us);
    const usMetas = metas.filter(m => U.normalizeMarketKey(m.market) === U.Market.us);

    const prices = S.getPrices();
    const nameUpdates = [];

    // 匯率
    const fxP = fetchFx();

    // 台股：盤中用 MIS 即時，其餘（或非盤中）用 FinMind 日收盤；名稱由代碼表補齊
    if (twMetas.length) {
      const uniP = loadTwUniverse(false).catch(() => ({}));
      // 盤中先抓 MIS 即時
      let realtime = {};
      if (U.shouldUseMisRealtime()) {
        realtime = await fetchTwRealtime(twMetas);
        for (const code in realtime) prices[code] = realtime[code];
      }
      // MIS 沒拿到的（或非盤中）改用 FinMind 日收盤
      const queue = twMetas.filter(m => !realtime[m.code]);
      async function twWorker() {
        while (queue.length) {
          const m = queue.shift();
          const q = await fetchTwPrice(m.code);
          if (q) prices[m.code] = q;
        }
      }
      await Promise.all([twWorker(), twWorker(), twWorker()]);
      const uni = await uniP;
      for (const m of twMetas) {
        const u = uni[m.code];
        if (u && u.name && (!mmap[m.code] || mmap[m.code].name === m.code)) {
          nameUpdates.push({ code: m.code, name: u.name, market: u.market });
        }
      }
    }

    // 美股：Finnhub 並發抓取（限制 5 並發）
    if (usMetas.length) {
      const queue = [...usMetas];
      async function worker() {
        while (queue.length) {
          const m = queue.shift();
          const q = await fetchUsQuote(m.code);
          if (q) prices[m.code] = q;
        }
      }
      await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    }

    await fxP;
    if (nameUpdates.length) S.upsertMeta(nameUpdates);
    S.setPrices(prices);
    return prices;
  }

  // ---- 代碼搜尋（給交易表單自動完成）----
  // 台股：本機全市場表（代碼前綴 或 名稱包含）；美股：Finnhub /search（僅代碼前綴）
  async function searchSymbols(query) {
    const q = (query || '').trim().toUpperCase();
    if (!q) return [];
    const results = [];

    // 台股（本機）
    try {
      const uni = await loadTwUniverse(false);
      for (const code in uni) {
        const u = uni[code];
        if (code.startsWith(q) || (u.name && u.name.toUpperCase().includes(q))) {
          results.push({ code, name: u.name, market: u.market });
          if (results.length >= 20) break;
        }
      }
    } catch (e) {}

    // 美股（Finnhub search，僅代碼前綴）
    try {
      const j = await fetchJson('https://finnhub.io/api/v1/search?q=' +
        encodeURIComponent(q) + '&token=' + encodeURIComponent(finnhubKey()));
      for (const it of (j.result || [])) {
        const sym = (it.symbol || '').toUpperCase();
        if (!sym || sym.includes('.') || sym.length > 5) continue;
        if (!sym.startsWith(q)) continue;
        results.push({ code: sym, name: it.description || sym, market: U.Market.us });
        if (results.length >= 40) break;
      }
    } catch (e) {}

    // 台股優先、權證排後、代碼排序
    results.sort((a, b) => {
      const aw = /[購售]/.test(a.name), bw = /[購售]/.test(b.name);
      if (aw !== bw) return aw ? 1 : -1;
      const au = a.market === U.Market.us, bu = b.market === U.Market.us;
      if (au !== bu) return au ? 1 : -1;
      return a.code < b.code ? -1 : 1;
    });
    return results.slice(0, 30);
  }

  return { fetchText, fetchJson, loadTwUniverse, fetchTwPrice, fetchTwHistory, fetchTwRealtime, fetchUsQuote, fetchFx, refreshPrices, searchSymbols, finnhubKey };
})();
