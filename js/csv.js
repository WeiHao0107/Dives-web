/* =========================================================================
 * csv.js — 匯出/匯入備份，格式與 iOS app 完全相容（# TRANSACTIONS / # SNAPSHOTS）
 * ======================================================================= */
window.App = window.App || {};

App.Csv = (function () {
  const U = App.Util;
  const S = App.Store;

  const SNAP_HEADER = [
    'Date', 'MarketValue', 'CashBalance', 'NetAsset', 'UnrealizedPnl', 'RealizedPnl',
    'TotalPnl', 'DayPnl', 'TwMarketValue', 'UsMarketValueTwd', 'TotalMarketValueTwd',
    'TwCostBasis', 'UsCostBasisTwd', 'TotalCostBasisTwd', 'TwUnrealizedPnl',
    'UsUnrealizedPnlTwd', 'TwRealizedPnl', 'UsRealizedPnlTwd', 'TwTotalPnl',
    'UsTotalPnlTwd', 'TwReturnPct', 'UsReturnPct', 'TotalReturnPct'
  ];

  function exportCsv() {
    const lines = [];
    const mmap = S.metaMap();

    lines.push('# TRANSACTIONS');
    lines.push('Symbol,Market,Type,Shares,Price,Fee,Time');
    const txs = [...S.getTransactions()].sort((a, b) => a.time - b.time);
    for (const t of txs) {
      const market = mmap[t.symbol]?.market || U.Market.unknown;
      lines.push([t.symbol, market, t.type, t.shares, t.price, t.fee, Math.round(t.time)].join(','));
    }

    lines.push('');
    lines.push('# SNAPSHOTS');
    lines.push(SNAP_HEADER.join(','));
    const snaps = [...S.getSnapshots()].sort((a, b) => a.date < b.date ? -1 : 1);
    for (const s of snaps) {
      lines.push([
        s.date, s.marketValue, s.cashBalance, s.netAsset, s.unrealizedPnl, s.realizedPnl,
        s.totalPnl, s.dayPnl, s.twMarketValue, s.usMarketValueTwd, s.totalMarketValueTwd,
        s.twCostBasis, s.usCostBasisTwd, s.totalCostBasisTwd, s.twUnrealizedPnl,
        s.usUnrealizedPnlTwd, s.twRealizedPnl, s.usRealizedPnlTwd, s.twTotalPnl,
        s.usTotalPnlTwd, s.twReturnPct, s.usReturnPct, s.totalReturnPct
      ].join(','));
    }
    return lines.join('\n');
  }

  // 回傳 {ok, txCount, snapCount, msg}
  function importCsv(content) {
    const txLines = [], snapLines = [];
    let section = 'transactions';
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (line === '# TRANSACTIONS') { section = 'transactions'; continue; }
      if (line === '# SNAPSHOTS') { section = 'snapshots'; continue; }
      if (!line) continue;
      if (section === 'transactions') txLines.push(line); else snapLines.push(line);
    }
    if (!txLines.length) return { ok: false, msg: 'CSV 沒有可匯入資料' };

    // 解析交易
    const h = txLines[0].toLowerCase();
    const hasHeader = h.includes('symbol') && h.includes('type');
    const hasMarket = h.includes('market');
    const dataLines = hasHeader ? txLines.slice(1) : txLines;

    const parsed = [];
    for (const line of dataLines) {
      const p = line.split(',');
      if (hasMarket) {
        if (p.length < 7) continue;
        const sym = U.sanitizeSymbol(p[0]);
        const market = p[1].trim().toLowerCase();
        const type = p[2].trim().toUpperCase();
        const shares = parseFloat(p[3]), price = parseFloat(p[4]);
        if (isNaN(shares) || isNaN(price)) continue;
        const fee = parseFloat(p[5]) || 0;
        const time = parseInt(p[6], 10) || Date.now();
        if (!sym || (type !== 'BUY' && type !== 'SELL')) continue;
        parsed.push({ sym, market, type, shares, price, fee, time });
      } else {
        if (p.length < 6) continue;
        const sym = U.sanitizeSymbol(p[0]);
        const type = p[1].trim().toUpperCase();
        const shares = parseFloat(p[2]), price = parseFloat(p[3]);
        if (isNaN(shares) || isNaN(price)) continue;
        const fee = parseFloat(p[4]) || 0;
        const time = parseInt(p[5], 10) || Date.now();
        if (!sym || (type !== 'BUY' && type !== 'SELL')) continue;
        parsed.push({ sym, market: null, type, shares, price, fee, time });
      }
    }
    if (!parsed.length) return { ok: false, msg: 'CSV 沒有可匯入資料' };

    // 解析快照
    const snaps = [];
    if (snapLines.length) {
      const sh = snapLines[0].toLowerCase();
      const sData = sh.includes('date') ? snapLines.slice(1) : snapLines;
      for (const line of sData) {
        const p = line.split(',');
        if (p.length < 23) continue;
        const d = p[0].trim();
        if (!d || isNaN(parseFloat(p[1]))) continue;
        const n = i => parseFloat(p[i]) || 0;
        snaps.push({
          date: d, marketValue: n(1), cashBalance: n(2), netAsset: n(3),
          unrealizedPnl: n(4), realizedPnl: n(5), totalPnl: n(6), dayPnl: n(7),
          twMarketValue: n(8), usMarketValueTwd: n(9), totalMarketValueTwd: n(10),
          twCostBasis: n(11), usCostBasisTwd: n(12), totalCostBasisTwd: n(13),
          twUnrealizedPnl: n(14), usUnrealizedPnlTwd: n(15), twRealizedPnl: n(16),
          usRealizedPnlTwd: n(17), twTotalPnl: n(18), usTotalPnlTwd: n(19),
          twReturnPct: n(20), usReturnPct: n(21), totalReturnPct: n(22),
          createdAt: Date.now(),
        });
      }
    }

    // 清除現有 → 寫入（meta upsert + 重算已實現）
    S.setTransactions([]); S.setRealized([]); S.setSnapshots([]);

    const sortedTx = [...parsed].sort((a, b) => a.time - b.time);
    const metaUpserts = [];
    const mmap = S.metaMap();
    for (const t of sortedTx) {
      const mk = t.market ? U.normalizeMarketKey(t.market) : U.guessMarketBySymbol(t.sym);
      const name = mmap[t.sym]?.name || t.sym;
      metaUpserts.push({ code: t.sym, name, market: mk });
    }
    S.upsertMeta(metaUpserts);

    const txOut = [], rzOut = [];
    const sharesMap = {}, costMap = {};
    for (const t of sortedTx) {
      const sym = t.sym;
      const sh = sharesMap[sym] || 0, cost = costMap[sym] || 0;
      if (t.type === 'BUY') {
        sharesMap[sym] = sh + t.shares;
        costMap[sym] = cost + t.shares * t.price + t.fee;
      } else if (sh > 0) {
        const avg = cost / sh;
        const sell = Math.min(t.shares, sh);
        rzOut.push({ id: S.uuid(), symbol: sym, shares: sell, sellPrice: t.price, avgCost: avg, realizedPnl: sell * t.price - sell * avg - t.fee, time: t.time });
        sharesMap[sym] = Math.max(0, sh - sell);
        costMap[sym] = Math.max(0, cost - sell * avg);
      }
      txOut.push({ id: S.uuid(), symbol: sym, type: t.type, shares: t.shares, price: t.price, fee: t.fee, time: t.time });
    }
    S.setTransactions(txOut);
    S.setRealized(rzOut);
    if (snaps.length) { snaps.sort((a, b) => a.date < b.date ? -1 : 1); S.setSnapshots(snaps); }

    return { ok: true, txCount: txOut.length, snapCount: snaps.length };
  }

  return { exportCsv, importCsv };
})();
