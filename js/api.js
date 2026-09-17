/* =========================================================================
 * api.js — 網路服務（台股/美股報價、匯率、代碼搜尋）
 *
 * 瀏覽器 CORS 對策（皆原生支援 CORS，無需代理）：
 *   台股：FinMind API — TaiwanStockInfo（代碼/名稱/市場）+ TaiwanStockPrice（日收盤+漲跌）。
 *   美股：有自填 Finnhub 金鑰 → /quote 即時報價、/search 搜尋；無金鑰 → FinMind USStockPrice 收盤價(免金鑰)。
 *   匯率：open.er-api.com（免金鑰）。
 *   後備：任一請求失敗時，自動改走可設定的 CORS proxy。
 *
 * 註：為「日收盤」資料，盤中顯示前一交易日收盤，收盤後更新為當日。
 * ======================================================================= */
window.App = window.App || {};

App.Api = (function () {
  const U = App.Util;
  const S = App.Store;

  // 無內建共用金鑰:使用者可於「設定 → 進階」自填免費 Finnhub 金鑰以取得即時報價;
  // 留空時美股改用 FinMind 收盤價(免金鑰,見 fetchUsQuote)。
  function finnhubKey() { return (localStorage.getItem('dives_finnhub_key') || '').trim(); }

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

  // ---- 美股代碼表（FinMind USStockInfo，免金鑰）→ {TICKER: name}；本機每日快取，供無金鑰時的美股搜尋 ----
  const US_UNI = 'dives_us_universe', US_UNI_TS = 'dives_us_universe_ts';
  function usShortName(n) {
    return String(n || '').replace(/\s+(Common Stock|Common Shares|Ordinary Shares|American Depositary Shares).*$/i, '').trim().slice(0, 44);
  }
  async function loadUsUniverse(force) {
    try {
      if (!force && localStorage.getItem(US_UNI_TS) === U.isoDate()) {
        const c = JSON.parse(localStorage.getItem(US_UNI) || 'null');
        if (c) return c;
      }
    } catch (e) {}
    const map = {};
    try {
      const j = await fetchJson(fmUrl({ dataset: 'USStockInfo' }));
      const best = {}; // 依 stock_id 去重、留市值最大者
      for (const r of (j.data || [])) {
        const id = (r.stock_id || '').trim().toUpperCase();
        if (!/^[A-Z]{1,5}$/.test(id)) continue; // 僅純字母 1–5 碼常見股（排除權證/特殊代碼）
        if (r.Country && r.Country !== 'United States') continue;
        const cap = +r.MarketCap || 0;
        if (!best[id] || cap > best[id].cap) best[id] = { cap, name: usShortName(r.stock_name) || id };
      }
      for (const id in best) map[id] = best[id].name;
    } catch (e) { console.warn('FinMind USStockInfo failed', e); }
    try { if (Object.keys(map).length) { localStorage.setItem(US_UNI, JSON.stringify(map)); localStorage.setItem(US_UNI_TS, U.isoDate()); } } catch (e) {}
    return map;
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

  // ---- 美股歷史日線（FinMind USStockPrice，供重建歷史走勢）----
  async function fetchUsHistory(codes, startDate) {
    const out = {};
    const queue = [...codes];
    async function worker() {
      while (queue.length) {
        const code = queue.shift();
        try {
          const j = await fetchJson(fmUrl({ dataset: 'USStockPrice', data_id: code, start_date: startDate }));
          const rows = (j.data || []).map(r => ({ date: r.date, close: U.parseNum(r.Close) }))
            .filter(r => r.close != null).sort((a, b) => a.date < b.date ? -1 : 1);
          out[code] = rows;
        } catch (e) { out[code] = []; }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return out;
  }

  // ---- 單檔日線（開/收）：供定期定額回補指定日期買入價 ----
  // 回傳升序 [{date, open, close}]；台股/美股走 FinMind、加密走 CoinGecko(無開盤 → open=close)
  async function fetchDailySeries(market, code, startDate) {
    const mk = U.normalizeMarketKey(market);
    try {
      if (mk === U.Market.crypto) {
        const h = await fetchCryptoHistory([code], startDate);
        return (h[code] || []).map(r => ({ date: r.date, open: r.close, close: r.close }));
      }
      const isUs = mk === U.Market.us;
      const ds = isUs ? 'USStockPrice' : 'TaiwanStockPrice';
      const j = await fetchJson(fmUrl({ dataset: ds, data_id: code, start_date: startDate }));
      return (j.data || []).map(r => {
        const close = U.parseNum(isUs ? r.Close : r.close);
        const open = U.parseNum(isUs ? r.Open : r.open);
        return { date: r.date, open: open != null ? open : close, close };
      }).filter(r => r.close != null).sort((a, b) => a.date < b.date ? -1 : 1);
    } catch (e) { return []; }
  }

  // ---- 台股股利政策（FinMind TaiwanStockDividend，免金鑰）供自動帶入 ----
  // 回傳升序事件 [{type:'cash'|'stock', exDate, payDate, perShare}]
  //   cash perShare=現金股利/股(元)；stock perShare=配股/股(面額元,配股率=perShare/10)
  async function fetchTwDividends(code, startDate) {
    try {
      const j = await fetchJson(fmUrl({ dataset: 'TaiwanStockDividend', data_id: code, start_date: startDate || '2015-01-01' }));
      const out = [];
      for (const r of (j.data || [])) {
        const cash = (+r.CashEarningsDistribution || 0) + (+r.CashStatutorySurplus || 0);
        const stock = (+r.StockEarningsDistribution || 0) + (+r.StockStatutorySurplus || 0);
        if (cash > 0 && r.CashExDividendTradingDate) out.push({ type: 'cash', exDate: r.CashExDividendTradingDate, payDate: r.CashDividendPaymentDate || r.CashExDividendTradingDate, perShare: cash });
        if (stock > 0 && r.StockExDividendTradingDate) out.push({ type: 'stock', exDate: r.StockExDividendTradingDate, payDate: r.StockExDividendTradingDate, perShare: stock });
      }
      return out.sort((a, b) => a.exDate < b.exDate ? -1 : 1);
    } catch (e) { return []; }
  }

  // ---- 美股股利（需自填 Finnhub 金鑰才啟用）供自動匯入 ----
  // 主來源 Finnhub /stock/dividend(付費方案才有,含發放日);免費方案無權限 → 自動改用
  // Yahoo chart events(免金鑰,CORS 由 fetchText 的 proxy 備援處理;無發放日 → 以除息日入帳)
  // 回傳升序 [{type:'cash', exDate, payDate, perShare(USD,稅前)}]；無金鑰回 []
  async function fetchUsDividends(symbol, from) {
    if (!finnhubKey()) return [];
    try {
      const to = U.isoDate(new Date(Date.now() + 30 * 864e5)); // 往後 30 天,涵蓋已宣告的未來配息(供除息提醒)
      const j = await fetchJson('https://finnhub.io/api/v1/stock/dividend?symbol=' + encodeURIComponent(symbol) +
        '&from=' + encodeURIComponent(from || '2015-01-01') + '&to=' + to + '&token=' + encodeURIComponent(finnhubKey()));
      const out = (Array.isArray(j) ? j : []).map(r => ({ type: 'cash', exDate: r.date, payDate: r.payDate || r.date, perShare: +r.amount || 0 }))
        .filter(e => e.exDate && e.perShare > 0)
        .sort((a, b) => a.exDate < b.exDate ? -1 : 1);
      if (out.length) return out;
    } catch (e) { /* 落到 Yahoo 後備 */ }
    return fetchUsDividendsYahoo(symbol, from);
  }
  async function fetchUsDividendsYahoo(symbol, from) {
    try {
      const p1 = Math.floor(new Date((from || '2015-01-01') + 'T00:00:00Z').getTime() / 1000);
      const p2 = Math.floor(Date.now() / 1000) + 30 * 86400;
      const j = await fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
        '?period1=' + p1 + '&period2=' + p2 + '&interval=3mo&events=div');
      const divs = ((((j.chart || {}).result || [])[0] || {}).events || {}).dividends || {};
      const out = [];
      for (const k in divs) {
        const v = divs[k] || {};
        const ts = (v.date ? v.date : +k) * 1000; // 內層 date 才是真正除息日
        if (!(ts > 0) || !(v.amount > 0)) continue;
        const exDate = U.isoDate(new Date(ts));
        if (from && exDate < from) continue;
        out.push({ type: 'cash', exDate, payDate: exDate, perShare: +v.amount });
      }
      return out.sort((a, b) => a.exDate < b.exDate ? -1 : 1);
    } catch (e) { return []; }
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

  // ---- 美股單檔報價 ----
  // 有自填 Finnhub 金鑰 → 用 Finnhub 即時報價;否則(或失敗)→ FinMind 收盤價(免金鑰,近日資料、非即時)
  async function fetchUsQuote(symbol) {
    if (finnhubKey()) {
      try {
        const j = await fetchJson('https://finnhub.io/api/v1/quote?symbol=' +
          encodeURIComponent(symbol) + '&token=' + encodeURIComponent(finnhubKey()));
        const c = j.c;
        if (c > 0) {
          const pc = (typeof j.pc === 'number') ? j.pc : null;
          const d = (typeof j.d === 'number') ? j.d : (pc != null ? c - pc : 0);
          return { price: c, dailyChange: d, prevClose: pc };
        }
      } catch (e) { /* 落到 FinMind 後備 */ }
    }
    return fetchUsQuoteFinMind(symbol);
  }
  // 免金鑰後備:FinMind USStockPrice 取最近兩個收盤,回傳 {price=最新收盤, dailyChange, prevClose}
  async function fetchUsQuoteFinMind(symbol) {
    try {
      const start = U.isoDate(new Date(Date.now() - 12 * 864e5)); // 近 ~12 天,涵蓋連假
      const j = await fetchJson(fmUrl({ dataset: 'USStockPrice', data_id: symbol, start_date: start }));
      const rows = (j.data || []).map(r => ({ date: r.date, close: U.parseNum(r.Close) }))
        .filter(r => r.close != null).sort((a, b) => a.date < b.date ? -1 : 1);
      if (!rows.length) return null;
      const c = rows[rows.length - 1].close;
      if (!(c > 0)) return null;
      const pc = rows.length > 1 ? rows[rows.length - 2].close : null;
      return { price: c, dailyChange: pc != null ? c - pc : 0, prevClose: pc };
    } catch (e) { return null; }
  }

  // ---- 虛擬貨幣（CoinGecko，免金鑰、支援 CORS，USD 計價）----
  const CG = 'https://api.coingecko.com/api/v3';
  const CG_IDS_KEY = 'dives_cg_ids'; // {SYMBOL: coingecko id}
  function cgIds() { try { return JSON.parse(localStorage.getItem(CG_IDS_KEY) || '{}'); } catch (e) { return {}; } }
  function cacheCgId(symbol, id) {
    if (!symbol || !id) return;
    const m = cgIds(); m[symbol.toUpperCase()] = id;
    localStorage.setItem(CG_IDS_KEY, JSON.stringify(m));
  }
  // 解析代號 → CoinGecko id（快取優先；miss 時用 search，取 symbol 相符且市值排名最前者）
  async function cgResolve(symbol) {
    const sym = (symbol || '').toUpperCase();
    const cached = cgIds()[sym];
    if (cached) return cached;
    try {
      const j = await fetchJson(CG + '/search?query=' + encodeURIComponent(sym));
      const coins = (j.coins || []).filter(c => (c.symbol || '').toUpperCase() === sym);
      coins.sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9));
      if (coins[0]) { cacheCgId(sym, coins[0].id); return coins[0].id; }
    } catch (e) {}
    return null;
  }

  // 批次報價：codes = ['BTC','ETH'] → {BTC: {price(USD), dailyChange, prevClose}}
  async function fetchCryptoQuotes(codes) {
    const out = {};
    const idMap = {}; // id -> SYMBOL
    for (const c of codes) {
      const id = await cgResolve(c);
      if (id) idMap[id] = c.toUpperCase();
    }
    const ids = Object.keys(idMap);
    if (!ids.length) return out;
    try {
      const j = await fetchJson(CG + '/simple/price?ids=' + encodeURIComponent(ids.join(',')) + '&vs_currencies=usd&include_24hr_change=true');
      for (const id in (j || {})) {
        const price = j[id] && j[id].usd;
        if (!(price > 0)) continue;
        const pct = j[id].usd_24h_change || 0;
        const prev = price / (1 + pct / 100);
        out[idMap[id]] = { price, dailyChange: price - prev, prevClose: prev };
      }
    } catch (e) { console.warn('CoinGecko quotes failed', e); }
    return out;
  }

  // 歷史日線（USD）：{code: [{date, close}]}；免費層最多 365 天
  async function fetchCryptoHistory(codes, startDate) {
    const out = {};
    const days = Math.min(365, Math.ceil((Date.now() - new Date(startDate + 'T00:00:00+08:00').getTime()) / 86400000) + 2);
    for (const c of codes) {
      out[c] = [];
      const id = await cgResolve(c);
      if (!id) continue;
      try {
        const j = await fetchJson(CG + '/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=usd&days=' + days + '&interval=daily');
        const seen = new Set();
        const rows = [];
        for (const [ms, price] of (j.prices || [])) {
          const d = U.isoDate(new Date(ms));
          if (seen.has(d) || !(price > 0)) continue;
          seen.add(d); rows.push({ date: d, close: price });
        }
        rows.sort((a, b) => a.date < b.date ? -1 : 1);
        out[c] = rows;
      } catch (e) { console.warn('CoinGecko history failed', c, e); }
    }
    return out;
  }

  // ---- 台指期貨（FinMind TaiwanFuturesDaily，免金鑰；日盤結算價）----
  async function fetchFuturesDaily(contract, month, startDate) {
    try {
      const j = await fetchJson(fmUrl({ dataset: 'TaiwanFuturesDaily', data_id: contract, start_date: startDate }));
      return App.Futures.parseFuturesDaily(j.data || [], month);
    } catch (e) { return []; }
  }
  // keys: ['TX@202610', …] → { 'TX@202610': [{date, close}] }（同合約只打一次 API）
  async function fetchFuturesHistory(keys, startDate) {
    const out = {};
    const byContract = {};
    for (const k of keys || []) { const [c, m] = k.split('@'); (byContract[c] = byContract[c] || []).push(m); out[k] = []; }
    for (const c in byContract) {
      try {
        const j = await fetchJson(fmUrl({ dataset: 'TaiwanFuturesDaily', data_id: c, start_date: startDate }));
        for (const m of byContract[c]) out[c + '@' + m] = App.Futures.parseFuturesDaily(j.data || [], m);
      } catch (e) { /* 留空 → 重建時以均價估 */ }
    }
    return out;
  }
  // 刷新持有月份的結算價 → prices['FUT:c@m'] = {price, dailyChange, prevClose}（手動價會被成功抓到的價覆蓋）
  async function refreshFutures(prices) {
    if (!App.Futures) return prices;
    const { positions } = App.Futures.replay(App.Futures.getState().trades);
    const byContract = {};
    for (const p of positions) (byContract[p.contract] = byContract[p.contract] || []).push(p.month);
    const start = U.isoDate(new Date(Date.now() - 12 * 864e5));
    for (const c in byContract) {
      let rows = [];
      try { rows = (await fetchJson(fmUrl({ dataset: 'TaiwanFuturesDaily', data_id: c, start_date: start }))).data || []; } catch (e) { continue; }
      for (const m of byContract[c]) {
        const ser = App.Futures.parseFuturesDaily(rows, m);
        if (!ser.length) continue;
        const last = ser[ser.length - 1], prev = ser.length > 1 ? ser[ser.length - 2].close : null;
        prices[App.Futures.priceKey(c, m)] = { price: last.close, dailyChange: prev != null ? last.close - prev : 0, prevClose: prev, date: last.date };
      }
    }
    return prices;
  }
  // 期交所保證金一覽表 → {margin, date} 或 null
  // 期交所直連一定被 CORS 擋 → 先走 r.jina.ai（免金鑰、支援 CORS，回 markdown，parser 也吃）；失敗再試直連／設定的 proxy
  const TAIFEX_MARGIN_URL = 'https://www.taifex.com.tw/cht/5/indexMarging';
  async function fetchTaifexMargins() {
    try {
      const res = await fetch('https://r.jina.ai/' + TAIFEX_MARGIN_URL, { cache: 'no-store' });
      if (res.ok) { const r = App.Futures.parseTaifexMargins(await res.text()); if (r) return r; }
    } catch (e) { /* 下一個來源 */ }
    try { return App.Futures.parseTaifexMargins(await fetchText(TAIFEX_MARGIN_URL)); } catch (e) { return null; }
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
    if (!all.length) { await fetchFx(); const p = S.getPrices(); await refreshFutures(p); S.setPrices(p); return p; }

    const mmap = S.metaMap();
    const metas = all.map(code => mmap[code] || { code, name: code, market: U.guessMarketBySymbol(code) });
    const mk = m => U.normalizeMarketKey(m.market);
    const twMetas = metas.filter(m => mk(m) !== U.Market.us && mk(m) !== U.Market.crypto);
    const usMetas = metas.filter(m => mk(m) === U.Market.us);
    const cryptoMetas = metas.filter(m => mk(m) === U.Market.crypto);

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

    // 虛擬貨幣：CoinGecko 批次報價（USD）
    if (cryptoMetas.length) {
      const cq = await fetchCryptoQuotes(cryptoMetas.map(m => m.code));
      for (const code in cq) prices[code] = cq[code];
    }

    await fxP;
    await refreshFutures(prices);
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

    // 美股搜尋:有 Finnhub 金鑰 → Finnhub /search(即時);否則 → FinMind 美股清單(免金鑰、本機每日快取)
    try {
      if (finnhubKey()) {
        const j = await fetchJson('https://finnhub.io/api/v1/search?q=' +
          encodeURIComponent(q) + '&token=' + encodeURIComponent(finnhubKey()));
        for (const it of (j.result || [])) {
          const sym = (it.symbol || '').toUpperCase();
          if (!sym || sym.includes('.') || sym.length > 5) continue;
          if (!sym.startsWith(q)) continue;
          results.push({ code: sym, name: it.description || sym, market: U.Market.us });
          if (results.length >= 40) break;
        }
      } else if (/^[A-Z]/.test(q)) { // 純數字(台股)不查美股
        const uni = await loadUsUniverse(false);
        const hits = [];
        for (const code in uni) if (code.startsWith(q)) hits.push(code);
        hits.sort((a, b) => a.length - b.length || (a < b ? -1 : 1)); // 短代碼(較常見)優先
        for (const code of hits.slice(0, 12)) results.push({ code, name: uni[code], market: U.Market.us });
      }
    } catch (e) {}

    // 虛擬貨幣（CoinGecko search，代號前綴，取市值前幾名）
    try {
      const j = await fetchJson(CG + '/search?query=' + encodeURIComponent(q));
      const coins = (j.coins || []).filter(c => (c.symbol || '').toUpperCase().startsWith(q))
        .sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9)).slice(0, 5);
      for (const c of coins) {
        results.push({ code: (c.symbol || '').toUpperCase(), name: c.name || c.symbol, market: U.Market.crypto, cgid: c.id });
      }
    } catch (e) {}

    // 台股優先、權證排後、美股次之、加密最後、代碼排序
    const ord = m => m === U.Market.crypto ? 2 : m === U.Market.us ? 1 : 0;
    results.sort((a, b) => {
      const aw = /[購售]/.test(a.name), bw = /[購售]/.test(b.name);
      if (aw !== bw) return aw ? 1 : -1;
      if (ord(a.market) !== ord(b.market)) return ord(a.market) - ord(b.market);
      return a.code < b.code ? -1 : 1;
    });
    return results.slice(0, 30);
  }

  return { fetchText, fetchJson, loadTwUniverse, fetchTwPrice, fetchTwHistory, fetchUsHistory, fetchDailySeries, fetchTwDividends, fetchUsDividends, fetchTwRealtime, fetchUsQuote, fetchCryptoQuotes, fetchCryptoHistory, cacheCgId, fetchFx, refreshPrices, searchSymbols, finnhubKey,
    fetchFuturesDaily, fetchFuturesHistory, refreshFutures, fetchTaifexMargins };
})();
