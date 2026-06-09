/* =========================================================================
 * store.js — 本機資料持久層（localStorage），取代 iOS 的 SwiftData
 * 實體：transactions / meta / realized / snapshots / account / pricesCache
 * ======================================================================= */
window.App = window.App || {};

App.Store = (function () {
  const K = {
    tx: 'dives_transactions',
    meta: 'dives_meta',
    realized: 'dives_realized',
    snapshots: 'dives_snapshots',
    account: 'dives_account',
    prices: 'dives_prices_cache',
    pricesTs: 'dives_prices_ts',
    fxRate: 'dives_fx_rate',
    fxTs: 'dives_fx_ts',
    twUniverse: 'dives_tw_universe',
    twUniverseTs: 'dives_tw_universe_ts',
    proxy: 'dives_cors_proxy',
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ---- Transactions ----  {id, symbol, type, shares, price, fee, time(ms)}
  function getTransactions() { return read(K.tx, []); }
  function setTransactions(arr) { write(K.tx, arr); }

  // ---- Meta ----  {code, name, market}
  function getMeta() { return read(K.meta, []); }
  function setMeta(arr) { write(K.meta, arr); }
  function metaMap() {
    const m = {};
    for (const x of getMeta()) m[x.code] = x;
    return m;
  }
  function upsertMeta(list) {
    const map = metaMap();
    for (const it of list) {
      if (map[it.code]) { map[it.code].name = it.name; map[it.code].market = it.market; }
      else map[it.code] = { code: it.code, name: it.name, market: it.market };
    }
    setMeta(Object.values(map));
  }

  // ---- Realized ----  {id, symbol, shares, sellPrice, avgCost, realizedPnl, time(ms)}
  function getRealized() { return read(K.realized, []); }
  function setRealized(arr) { write(K.realized, arr); }

  // ---- Snapshots ----  {date 'YYYY-MM-DD', ...metrics}
  function getSnapshots() { return read(K.snapshots, []); }
  function setSnapshots(arr) { write(K.snapshots, arr); }

  // ---- Account ----  {initialCash: number|null}
  function getAccount() { return read(K.account, { initialCash: null }); }
  function setAccount(a) { write(K.account, a); }

  // ---- Prices cache ----  {code: {price, dailyChange, prevClose}}
  function getPrices() { return read(K.prices, {}); }
  function setPrices(p) { write(K.prices, p); localStorage.setItem(K.pricesTs, String(Date.now())); }
  function getPricesTs() { const t = +localStorage.getItem(K.pricesTs); return t || null; }

  // ---- FX ----
  function getFxRate() { return read(K.fxRate, null); }
  function setFxRate(r) { write(K.fxRate, r); localStorage.setItem(K.fxTs, String(Date.now())); }
  function getFxTs() { const t = +localStorage.getItem(K.fxTs); return t || null; }

  // ---- TW universe（代碼→{name,market,price,change}）----
  function getTwUniverse() { return read(K.twUniverse, null); }
  function setTwUniverse(u) { write(K.twUniverse, u); localStorage.setItem(K.twUniverseTs, App.Util.isoDate()); }
  function twUniverseFresh() { return localStorage.getItem(K.twUniverseTs) === App.Util.isoDate(); }

  // ---- CORS proxy ----
  function getProxy() {
    return localStorage.getItem(K.proxy) || 'https://corsproxy.io/?url=';
  }
  function setProxy(p) { localStorage.setItem(K.proxy, p || ''); }

  // ---- 清空所有資料（同步清除快照）----
  function clearAll() {
    setTransactions([]);
    setRealized([]);
    setSnapshots([]);
    setAccount({ initialCash: null });
    setPrices({});
  }

  return {
    uuid,
    getTransactions, setTransactions,
    getMeta, setMeta, metaMap, upsertMeta,
    getRealized, setRealized,
    getSnapshots, setSnapshots,
    getAccount, setAccount,
    getPrices, setPrices, getPricesTs,
    getFxRate, setFxRate, getFxTs,
    getTwUniverse, setTwUniverse, twUniverseFresh,
    getProxy, setProxy,
    clearAll,
  };
})();
