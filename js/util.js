/* =========================================================================
 * util.js — 共用工具函式（格式化、市場判斷、日期）
 * 對應 iOS Models.swift 的全域輔助函式
 * ======================================================================= */
window.App = window.App || {};

App.Util = (function () {
  // ---- 市場類型 ----
  const Market = { tse: 'tse', otc: 'otc', rotc: 'rotc', us: 'us', crypto: 'crypto', unknown: 'unknown' };

  function normalizeMarketKey(market) {
    switch ((market || '').trim().toLowerCase()) {
      case 'tse': case 'twse': case '上市': case 'listed': return Market.tse;
      case 'otc': case 'tpex': case '上櫃': case 'otc_market': return Market.otc;
      case 'rotc': case 'emerging': case '興櫃': return Market.rotc;
      case 'us': case 'usa': case '美股': return Market.us;
      case 'crypto': case 'coin': case '加密': case '虛擬貨幣': return Market.crypto;
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
      case 'crypto': return '加密';
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
    // 最多顯示一位小數；若太小（1 位會變 0，如少量加密貨幣）則保留有效位數
    if (Math.round(v * 10) / 10 === 0) {
      let s = v.toFixed(4);
      while (s.endsWith('0')) s = s.slice(0, -1);
      if (s.endsWith('.')) s = s.slice(0, -1);
      return s;
    }
    return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
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

  // 美東是否夏令時間(EDT, UTC−4)；否則 EST(UTC−5)
  function usEasternIsDst() {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    return Math.round((utc - et) / 3600000) === 4;
  }
  // 美股開盤時間（台北時間，分鐘）；夏令 21:30，冬令 22:30
  function usOpenMinutes() { return usEasternIsDst() ? (21 * 60 + 30) : (22 * 60 + 30); }

  // 「台股今日(09:00 起算)」這個視窗內，美股是否已經開過盤。
  //   台股白天(09:00 ~ 美股開盤前) → 美股當天還沒開 → false（凌晨已收那盤歸昨天）
  //   台北晚上美股開盤後 ~ 隔天 09:00 前 → true（今晚這盤算今日）
  //   parts / usOpenMin 可注入（供測試）；預設取台北現在時間 + 實際 DST
  function usCountsTowardToday(parts, usOpenMin) {
    const p = parts || taipeiParts();
    const mins = p.hour * 60 + p.minute;
    const usOpen = usOpenMin != null ? usOpenMin : usOpenMinutes();
    return !(mins >= 9 * 60 && mins < usOpen);
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function prevWeekday(wd) { const i = WEEKDAYS.indexOf(wd); return i < 0 ? wd : WEEKDAYS[(i + 6) % 7]; }

  // 「台股日」模式下，台股當日漲跌是否計入今日。
  //   一個「台股日」從 09:00（台股開盤）起算，一路持續到「隔天 09:00 開盤」才重置。
  //   → 傍晚美股開盤不歸零；夜間/凌晨(隔天 09:00 前)仍顯示當日漲跌。
  //   09:00 前仍屬前一個台股日，故以「前一天」判定是否交易日(避免週一開盤前顯示上週五)。
  //   該台股日起點為週末(未開盤) → 0（假日/收盤不顯示前一交易日）。
  //   parts 可注入（供測試）；預設取台北現在時間
  function twCountsTowardToday(parts) {
    const p = parts || taipeiParts();
    const mins = p.hour * 60 + p.minute;
    const dayWd = mins >= 9 * 60 ? p.weekday : prevWeekday(p.weekday);
    return dayWd !== 'Sat' && dayWd !== 'Sun';
  }

  // 解析數字字串（處理逗號、空字串、"-"）
  function parseNum(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (!s || s === '-' || s === '--') return null;
    const v = parseFloat(s.replace(/,/g, ''));
    return (!isNaN(v) && v > 0) ? v : null;
  }

  // HTML 跳脫：使用者輸入（帳戶/群組名、別名）與外部 API 名稱塞進 innerHTML 前一律經過這裡
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    esc, Market, normalizeMarketKey, guessMarketBySymbol, marketLabel,
    sanitizeSymbol, canonicalizeTwCode,
    fmtWhole, formatShares, formatPrice, fmtKMBB, fmtBanner, fmtBannerSigned, fmtPct,
    isoDate, taipeiParts, isWeekend, shouldUseMisRealtime, usOpenMinutes, usCountsTowardToday, twCountsTowardToday, parseNum
  };
})();
