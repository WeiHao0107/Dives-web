/* =========================================================================
 * calc.js — 商業邏輯（持倉/彙總/已實現損益/快照/CSV），對應 iOS StockViewModel
 * ======================================================================= */
window.App = window.App || {};

App.Calc = (function () {
  const U = App.Util;
  const S = App.Store;

  // 加權平均成本：BUY 累加；SELL 按當前均價比例扣成本（不改剩餘均價）
  function computeAvgCostPosition(txs) {
    let shares = 0, cost = 0;
    const sorted = [...txs].sort((a, b) => a.time - b.time);
    for (const t of sorted) {
      if (t.type === 'BUY') {
        shares += t.shares;
        cost += t.shares * t.price + t.fee;
      } else {
        const avg = shares > 1e-9 ? cost / shares : 0;
        const sell = Math.min(t.shares, shares);
        cost = Math.max(0, cost - sell * avg);
        shares = Math.max(0, shares - sell);
      }
    }
    return { shares, avgCost: shares > 1e-9 ? cost / shares : 0 };
  }

  // 由交易紀錄計算目前持倉
  function buildPositions() {
    const txs = S.getTransactions();
    const prices = S.getPrices();
    const mmap = S.metaMap();
    const bySym = {};
    for (const t of txs) (bySym[t.symbol] = bySym[t.symbol] || []).push(t);

    const out = [];
    for (const sym in bySym) {
      const { shares, avgCost } = computeAvgCostPosition(bySym[sym]);
      if (shares <= 1e-9) continue;
      const cost = shares * avgCost;
      const meta = mmap[sym];
      const pd = prices[sym];
      const price = pd ? pd.price : null;
      const mv = (price != null ? price : avgCost) * shares;
      const unreal = price != null ? mv - cost : 0;
      out.push({
        symbol: sym,
        name: meta ? meta.name : sym,
        shares, cost, avgCost,
        lastPrice: price,
        dailyChange: pd ? pd.dailyChange : null,
        dailyChangePct: (pd && pd.prevClose) ? (pd.dailyChange / pd.prevClose) * 100 : null,
        unrealizedPnl: unreal,
        marketValue: mv,
        market: meta ? meta.market : U.guessMarketBySymbol(sym),
      });
    }
    return out;
  }

  // 投資組合彙總（美股以匯率換算 TWD）
  function buildSummary(positions) {
    const rate = S.getFxRate() || 31.5;
    const mmap = S.metaMap();
    const s = {
      twMarketValue: 0, usMarketValueTwd: 0,
      twCostBasis: 0, usCostBasisTwd: 0,
      twUnrealizedPnl: 0, usUnrealizedPnlTwd: 0,
      twRealizedPnl: 0, usRealizedPnlTwd: 0,
      twDayPnl: 0, usDayPnlTwd: 0,
      cashBalance: 0,
    };
    for (const p of positions) {
      const mv = p.lastPrice != null ? p.lastPrice * p.shares : p.cost;
      const market = U.normalizeMarketKey(p.market);
      if (market === U.Market.us) {
        s.usMarketValueTwd += mv * rate;
        s.usCostBasisTwd += p.cost * rate;
        s.usUnrealizedPnlTwd += p.unrealizedPnl * rate;
        s.usDayPnlTwd += (p.dailyChange || 0) * p.shares * rate;
      } else {
        s.twMarketValue += mv;
        s.twCostBasis += p.cost;
        s.twUnrealizedPnl += p.unrealizedPnl;
        s.twDayPnl += (p.dailyChange || 0) * p.shares;
      }
    }
    for (const rt of S.getRealized()) {
      const market = U.normalizeMarketKey(mmap[rt.symbol]?.market || U.guessMarketBySymbol(rt.symbol));
      if (market === U.Market.us) s.usRealizedPnlTwd += rt.realizedPnl * rate;
      else s.twRealizedPnl += rt.realizedPnl;
    }
    const acc = S.getAccount();
    if (acc.initialCash != null) {
      const txs = S.getTransactions();
      const spent = txs.filter(t => t.type === 'BUY').reduce((a, t) => a + (t.shares * t.price + t.fee), 0);
      const recv = txs.filter(t => t.type === 'SELL').reduce((a, t) => a + (t.shares * t.price - t.fee), 0);
      s.cashBalance = acc.initialCash - spent + recv;
    }
    // 衍生
    s.totalMarketValueTwd = s.twMarketValue + s.usMarketValueTwd;
    s.totalCostBasisTwd = s.twCostBasis + s.usCostBasisTwd;
    s.twTotalPnl = s.twUnrealizedPnl + s.twRealizedPnl;
    s.usTotalPnlTwd = s.usUnrealizedPnlTwd + s.usRealizedPnlTwd;
    s.totalUnrealizedPnl = s.twUnrealizedPnl + s.usUnrealizedPnlTwd;
    s.totalRealizedPnl = s.twRealizedPnl + s.usRealizedPnlTwd;
    s.totalPnl = s.twTotalPnl + s.usTotalPnlTwd;
    s.dayPnl = s.twDayPnl + s.usDayPnlTwd;
    s.netAsset = s.totalMarketValueTwd + s.cashBalance;
    s.twUnrealizedPnlPct = s.twCostBasis > 1e-9 ? (s.twUnrealizedPnl / s.twCostBasis) * 100 : null;
    s.usUnrealizedPnlPct = s.usCostBasisTwd > 1e-9 ? (s.usUnrealizedPnlTwd / s.usCostBasisTwd) * 100 : null;
    s.totalUnrealizedPnlPct = s.totalCostBasisTwd > 1e-9 ? (s.totalUnrealizedPnl / s.totalCostBasisTwd) * 100 : null;
    s.totalReturnPct = s.totalCostBasisTwd > 1e-9 ? (s.totalPnl / s.totalCostBasisTwd) * 100 : null;
    return s;
  }

  // 新增交易（SELL 同步寫入已實現損益）；回傳 {ok, msg}
  function addTransaction({ symbolInput, type, shares, price, fee }) {
    const symbol = U.sanitizeSymbol(symbolInput);
    if (!symbol || shares <= 0 || price <= 0) return { ok: false, msg: '請輸入正確的代碼/股數/價格' };

    // 確保 meta 存在
    const guessed = U.guessMarketBySymbol(symbol);
    const mmap = S.metaMap();
    if (!mmap[symbol]) {
      S.upsertMeta([{ code: symbol, name: symbol, market: guessed }]);
    } else if (guessed === U.Market.us && mmap[symbol].market !== U.Market.us) {
      S.upsertMeta([{ code: symbol, name: mmap[symbol].name, market: U.Market.us }]);
    }

    const txs = S.getTransactions();
    if (type === 'SELL') {
      const symbolTxs = txs.filter(t => t.symbol === symbol);
      const { shares: posShares, avgCost } = computeAvgCostPosition(symbolTxs);
      if (posShares <= 1e-9) return { ok: false, msg: '目前沒有持倉，無法賣出' };
      if (shares > posShares + 1e-9) return { ok: false, msg: '賣出股數超過持倉（持倉：' + U.formatShares(posShares) + '）' };
      const realized = shares * price - shares * avgCost - fee;
      const rz = S.getRealized();
      rz.push({ id: S.uuid(), symbol, shares, sellPrice: price, avgCost, realizedPnl: realized, time: Date.now() });
      S.setRealized(rz);
    }

    txs.push({ id: S.uuid(), symbol, type, shares, price, fee, time: Date.now() });
    S.setTransactions(txs);
    return { ok: true, symbol };
  }

  // 更新交易並重算該代碼的已實現損益
  function updateTransaction(id, { type, shares, price, fee, time }) {
    if (shares <= 0 || price <= 0) return { ok: false, msg: '請輸入正確的股數/價格' };
    const txs = S.getTransactions();
    const tx = txs.find(t => t.id === id);
    if (!tx) return { ok: false, msg: '找不到交易' };
    tx.type = type; tx.shares = shares; tx.price = price; tx.fee = fee; tx.time = time;
    S.setTransactions(txs);
    recomputeRealized(tx.symbol);
    return { ok: true, symbol: tx.symbol };
  }

  function deleteTransaction(id) {
    let txs = S.getTransactions();
    const tx = txs.find(t => t.id === id);
    if (!tx) return;
    txs = txs.filter(t => t.id !== id);
    S.setTransactions(txs);
    recomputeRealized(tx.symbol);
  }

  // 重播某代碼所有交易，重建已實現損益
  function recomputeRealized(symbol) {
    let rz = S.getRealized().filter(r => r.symbol !== symbol);
    const txs = S.getTransactions().filter(t => t.symbol === symbol).sort((a, b) => a.time - b.time);
    let shares = 0, cost = 0;
    for (const t of txs) {
      if (t.type === 'BUY') {
        cost += t.shares * t.price + t.fee;
        shares += t.shares;
      } else {
        const avg = shares > 1e-9 ? cost / shares : 0;
        const realized = t.shares * t.price - t.shares * avg - t.fee;
        rz.push({ id: S.uuid(), symbol, shares: t.shares, sellPrice: t.price, avgCost: avg, realizedPnl: realized, time: t.time });
        const costBasis = t.shares * avg;
        shares = Math.max(0, shares - t.shares);
        cost = Math.max(0, cost - costBasis);
      }
    }
    S.setRealized(rz);
  }

  // 刪除某代碼所有資料
  function deleteSymbol(symbolInput) {
    const sym = U.sanitizeSymbol(symbolInput);
    S.setTransactions(S.getTransactions().filter(t => t.symbol !== sym));
    S.setRealized(S.getRealized().filter(r => r.symbol !== sym));
    const p = S.getPrices(); delete p[sym]; S.setPrices(p);
  }

  // 儲存今日快照（覆蓋同日）
  function saveTodaySnapshot() {
    const summary = buildSummary(buildPositions());
    const date = U.isoDate();
    const snap = {
      date,
      marketValue: summary.totalMarketValueTwd,
      cashBalance: summary.cashBalance,
      netAsset: summary.netAsset,
      unrealizedPnl: summary.totalUnrealizedPnl,
      realizedPnl: summary.totalRealizedPnl,
      totalPnl: summary.totalPnl,
      dayPnl: summary.dayPnl,
      twMarketValue: summary.twMarketValue,
      usMarketValueTwd: summary.usMarketValueTwd,
      totalMarketValueTwd: summary.totalMarketValueTwd,
      twCostBasis: summary.twCostBasis,
      usCostBasisTwd: summary.usCostBasisTwd,
      totalCostBasisTwd: summary.totalCostBasisTwd,
      twUnrealizedPnl: summary.twUnrealizedPnl,
      usUnrealizedPnlTwd: summary.usUnrealizedPnlTwd,
      twRealizedPnl: summary.twRealizedPnl,
      usRealizedPnlTwd: summary.usRealizedPnlTwd,
      twTotalPnl: summary.twTotalPnl,
      usTotalPnlTwd: summary.usTotalPnlTwd,
      twReturnPct: summary.twUnrealizedPnlPct || 0,
      usReturnPct: summary.usUnrealizedPnlPct || 0,
      totalReturnPct: summary.totalReturnPct || 0,
      createdAt: Date.now(),
    };
    const all = S.getSnapshots();
    const isNew = !all.some(s => s.date === date);
    let snaps = all.filter(s => s.date !== date);
    snaps.push(snap);
    snaps.sort((a, b) => a.date < b.date ? -1 : 1);
    S.setSnapshots(snaps);
    return isNew; // 是否新增了「新的一天」（供同步判斷）
  }

  return {
    computeAvgCostPosition, buildPositions, buildSummary,
    addTransaction, updateTransaction, deleteTransaction, recomputeRealized,
    deleteSymbol, saveTodaySnapshot,
  };
})();
