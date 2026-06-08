/* =========================================================================
 * util.js — 共用工具函式（格式化、市場判斷、日期）
 * 對應 iOS Models.swift 的全域輔助函式
 * ======================================================================= */
window.App = window.App || {};

App.Util = (function () {
  // ---- 市場類型 ----
  const Market = { tse: 'tse', otc: 'otc', rotc: 'rotc', us: 'us', unknown: 'unknown' };

  function normalizeMarketKey(market) {
    switch ((market || '').trim().toLowerCase()) {
      case 'tse': case 'twse': case '上市': case 'listed': return Market.tse;
      case 'otc': case 'tpex': case '上櫃': case 'otc_market': return Market.otc;
      case 'rotc': case 'emerging': case '興櫃': return Market.rotc;
      case 'us': case 'usa': case '美股': return Market.us;
      default: return Market.unknown;
    }
  }

  // 由代碼格式猜測市場：含英文字母 → 美股（例外 4 碼數字+1 字母 = 台股 ETF/債券）
  function guessMarketBySymbol(symbol) {
    const s = (symbol || '').trim().toUpperCase();
    const hasLetter = /[A-Z]/.test(s);
    if (hasLetter) {
      const letters = (s.match(/[A-Z]/g) || []).length;
      const digits = (s.match(/[0-9]/g) || []).length;
      if (digits >= 4 && letters === 1) return Market.tse;
      return Market.us;
    }
    if (s.length >= 4 && s.length <= 6 && /^[0-9]+$/.test(s)) return Market.tse;
    return Market.unknown;
  }

  function marketLabel(market) {
    switch ((market || '').toLowerCase()) {
      case 'tse': return '上市';
      case 'otc': return '上櫃';
      case 'rotc': return '興櫃';
      case 'us': return '美股';
      default: return '未知';
    }
  }

  // 清理輸入代碼：取第一段、大寫、去後綴、純數字補零至 4 碼
  function sanitizeSymbol(input) {
    let s = (input || '').trim().split(/\s+/)[0].toUpperCase();
    for (const suf of ['.TW', '.TWO', '.TWSE', '.TPEX']) {
      if (s.endsWith(suf)) s = s.slice(0, -suf.length);
    }
    s = s.replace(/\s/g, '').replace(/[^A-Z0-9.\-]/g, '');
    if (/^[0-9]+$/.test(s) && s.length >= 1 && s.length <= 3) {
      s = s.padStart(4, '0');
    }
    return s;
  }

  function canonicalizeTwCode(raw) {
    let s = (raw || '').trim().toUpperCase();
    for (const suf of ['.TW', '.TWO', '.TWSE', '.TPEX']) {
      if (s.endsWith(suf)) s = s.slice(0, -suf.length);
    }
    for (const pre of ['TSE_', 'OTC_']) {
      if (s.startsWith(pre)) s = s.slice(pre.length);
    }
    if (/^[0-9]+$/.test(s) && s.length >= 1 && s.length <= 3) s = s.padStart(4, '0');
    return s;
  }

  // ---- 數字格式化 ----
  const _grp = new Intl.NumberFormat('en-US');

  function fmtWhole(v) { return _grp.format(Math.round(v || 0)); }

  function formatShares(v) {
    v = v || 0;
    if (Math.abs(v - Math.round(v)) < 1e-9) return _grp.format(Math.round(v));
    let s = v.toFixed(4);
    while (s.endsWith('0')) s = s.slice(0, -1);
    if (s.endsWith('.')) s = s.slice(0, -1);
    return s;
  }

  function formatPrice(v) {
    return (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // 大數縮寫（萬 / 億）
  function fmtKMBB(v) {
    v = v || 0;
    const av = Math.abs(v);
    if (av >= 1e8) return (v / 1e8).toFixed(2) + '億';
    if (av >= 1e4) {
      const wan = v / 1e4;
      if (av >= 1e7) return Math.round(wan) + '萬';
      let s = wan.toFixed(1);
      if (s.endsWith('.0')) s = s.slice(0, -2);
      return s + '萬';
    }
    return fmtWhole(v);
  }

  // 報表用：億 / 萬 / 完整
  function fmtBanner(v) {
    v = v || 0;
    const av = Math.abs(v);
    if (av >= 1e8) return (v / 1e8).toFixed(2) + '億';
    if (av >= 1e4) {
      const wan = v / 1e4;
      if (av >= 1e7) return Math.round(wan) + '萬';
      let s = wan.toFixed(1);
      if (s.endsWith('.0')) s = s.slice(0, -2);
      return s + '萬';
    }
    return fmtWhole(v);
  }

  function fmtBannerSigned(v) {
    v = v || 0;
    return (v >= 0 ? '+' : '-') + fmtBanner(Math.abs(v));
  }

  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  // ---- 日期（台北時區）----
  function isoDate(d) {
    d = d || new Date();
    // en-CA 產生 YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
  }

  function taipeiParts(d) {
    d = d || new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
    }).formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value;
    return {
      year: +get('year'), month: +get('month'), day: +get('day'),
      hour: +get('hour') % 24, minute: +get('minute'), weekday: get('weekday')
    };
  }

  function isWeekend(d) {
    const wd = taipeiParts(d).weekday;
    return wd === 'Sat' || wd === 'Sun';
  }

  // 是否台股盤中 09:00–14:30
  function shouldUseMisRealtime() {
    const p = taipeiParts();
    const mins = p.hour * 60 + p.minute;
    return mins >= 9 * 60 && mins < 14 * 60 + 30;
  }

  // 解析數字字串（處理逗號、空字串、"-"）
  function parseNum(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (!s || s === '-' || s === '--') return null;
    const v = parseFloat(s.replace(/,/g, ''));
    return (!isNaN(v) && v > 0) ? v : null;
  }

  return {
    Market, normalizeMarketKey, guessMarketBySymbol, marketLabel,
    sanitizeSymbol, canonicalizeTwCode,
    fmtWhole, formatShares, formatPrice, fmtKMBB, fmtBanner, fmtBannerSigned, fmtPct,
    isoDate, taipeiParts, isWeekend, shouldUseMisRealtime, parseNum
  };
})();
