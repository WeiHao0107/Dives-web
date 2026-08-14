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
      if (t.type !== 'SELL') {          // BUY 與 STOCK_DIV(配股,零成本)皆累加
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

    const divBySym = {};
    for (const d of S.getDividends()) divBySym[d.symbol] = (divBySym[d.symbol] || 0) + (d.amount || 0);

    const out = [];
    const todayIso = U.isoDate();
    for (const sym in bySym) {
      const { shares, avgCost } = computeAvgCostPosition(bySym[sym]);
      if (shares <= 1e-9) continue;
      const cost = shares * avgCost;
      const meta = mmap[sym];
      const pd = prices[sym];
      const price = pd ? pd.price : null;
      const mv = (price != null ? price : avgCost) * shares;
      const unreal = price != null ? mv - cost : 0;
      // 當日損益（原幣）：今日買入以買入價為基準（不把跳空缺口算進當日），
      // 昨日已持有股數以昨收為基準；同日買後又賣 → 視為先賣昨日持股
      let dayPnl = 0;
      if (pd && price != null) {
        let buyShares = 0, buyCost = 0;
        for (const t of bySym[sym]) {
          if (t.type === 'BUY' && U.isoDate(new Date(t.time)) === todayIso) { buyShares += t.shares; buyCost += t.shares * t.price; }
        }
        const oldShares = Math.max(0, shares - buyShares);
        const newHeld = shares - oldShares;
        dayPnl = (pd.dailyChange || 0) * oldShares + (newHeld > 1e-9 ? (price - buyCost / buyShares) * newHeld : 0);
      }
      out.push({
        symbol: sym,
        name: meta ? meta.name : sym,
        shares, cost, avgCost,
        lastPrice: price,
        dailyChange: pd ? pd.dailyChange : null,
        dailyChangePct: (pd && pd.prevClose) ? (pd.dailyChange / pd.prevClose) * 100 : null,
        dayPnl,
        unrealizedPnl: unreal,
        marketValue: mv,
        dividend: divBySym[sym] || 0,
        market: meta ? meta.market : U.guessMarketBySymbol(sym),
      });
    }
    return out;
  }

  // 投資組合彙總（美股以匯率換算 TWD）
  function buildSummary(positions) {
    const rate = S.getFxRate() || 31.5;
    const mmap = S.metaMap();
    // 當日漲跌計算方式：twday 模式下，台股白天(美股尚未開盤)美股當日貢獻 0（凌晨那盤歸昨天）；
    // 台股則在平日 09:00 開盤後才計入（開盤前/週末歸零，不顯示前一交易日漲跌）
    const usDayOn = S.getDayMode() !== 'twday' || U.usCountsTowardToday();
    const twDayOn = S.getDayMode() !== 'twday' || U.twCountsTowardToday();
    const s = {
      twMarketValue: 0, usMarketValueTwd: 0, cryptoMarketValueTwd: 0,
      twCostBasis: 0, usCostBasisTwd: 0, cryptoCostBasisTwd: 0,
      twUnrealizedPnl: 0, usUnrealizedPnlTwd: 0, cryptoUnrealizedPnlTwd: 0,
      twRealizedPnl: 0, usRealizedPnlTwd: 0, cryptoRealizedPnlTwd: 0,
      twDayPnl: 0, usDayPnlTwd: 0, cryptoDayPnlTwd: 0,
      cashBalance: 0,
    };
    for (const p of positions) {
      const mv = p.lastPrice != null ? p.lastPrice * p.shares : p.cost;
      const market = U.normalizeMarketKey(p.market);
      if (market === U.Market.crypto) {
        s.cryptoMarketValueTwd += mv * rate;
        s.cryptoCostBasisTwd += p.cost * rate;
        s.cryptoUnrealizedPnlTwd += p.unrealizedPnl * rate;
        s.cryptoDayPnlTwd += (p.dayPnl || 0) * rate;
      } else if (market === U.Market.us) {
        s.usMarketValueTwd += mv * rate;
        s.usCostBasisTwd += p.cost * rate;
        s.usUnrealizedPnlTwd += p.unrealizedPnl * rate;
        s.usDayPnlTwd += (usDayOn ? (p.dayPnl || 0) : 0) * rate;
      } else {
        s.twMarketValue += mv;
        s.twCostBasis += p.cost;
        s.twUnrealizedPnl += p.unrealizedPnl;
        s.twDayPnl += twDayOn ? (p.dayPnl || 0) : 0;
      }
    }
    for (const rt of S.getRealized()) {
      const market = U.normalizeMarketKey(mmap[rt.symbol]?.market || U.guessMarketBySymbol(rt.symbol));
      if (market === U.Market.crypto) s.cryptoRealizedPnlTwd += rt.realizedPnl * rate;
      else if (market === U.Market.us) s.usRealizedPnlTwd += rt.realizedPnl * rate;
      else s.twRealizedPnl += rt.realizedPnl;
    }
    const acc = S.getAccount();
    if (acc.initialCash != null) {
      const txs = S.getTransactions();
      const spent = txs.filter(t => t.type === 'BUY').reduce((a, t) => a + (t.shares * t.price + t.fee), 0);
      const recv = txs.filter(t => t.type === 'SELL').reduce((a, t) => a + (t.shares * t.price - t.fee), 0);
      s.cashBalance = acc.initialCash - spent + recv;
    }
    // 衍生（含加密）
    s.totalMarketValueTwd = s.twMarketValue + s.usMarketValueTwd + s.cryptoMarketValueTwd;
    s.totalCostBasisTwd = s.twCostBasis + s.usCostBasisTwd + s.cryptoCostBasisTwd;
    s.twTotalPnl = s.twUnrealizedPnl + s.twRealizedPnl;
    s.usTotalPnlTwd = s.usUnrealizedPnlTwd + s.usRealizedPnlTwd;
    s.cryptoTotalPnlTwd = s.cryptoUnrealizedPnlTwd + s.cryptoRealizedPnlTwd;
    s.totalUnrealizedPnl = s.twUnrealizedPnl + s.usUnrealizedPnlTwd + s.cryptoUnrealizedPnlTwd;
    s.totalRealizedPnl = s.twRealizedPnl + s.usRealizedPnlTwd + s.cryptoRealizedPnlTwd;
    s.totalPnl = s.twTotalPnl + s.usTotalPnlTwd + s.cryptoTotalPnlTwd;
    s.dayPnl = s.twDayPnl + s.usDayPnlTwd + s.cryptoDayPnlTwd;
    s.netAsset = s.totalMarketValueTwd + s.cashBalance;
    s.twUnrealizedPnlPct = s.twCostBasis > 1e-9 ? (s.twUnrealizedPnl / s.twCostBasis) * 100 : null;
    s.usUnrealizedPnlPct = s.usCostBasisTwd > 1e-9 ? (s.usUnrealizedPnlTwd / s.usCostBasisTwd) * 100 : null;
    s.totalUnrealizedPnlPct = s.totalCostBasisTwd > 1e-9 ? (s.totalUnrealizedPnl / s.totalCostBasisTwd) * 100 : null;
    s.totalReturnPct = s.totalCostBasisTwd > 1e-9 ? (s.totalPnl / s.totalCostBasisTwd) * 100 : null;
    s.totalDividendTwd = dividendsTotalTwd();
    s.totalPnlWithDiv = s.totalPnl + s.totalDividendTwd;
    s.totalReturnWithDivPct = s.totalCostBasisTwd > 1e-9 ? (s.totalPnlWithDiv / s.totalCostBasisTwd) * 100 : null;
    return s;
  }

  // 新增交易（SELL 同步寫入已實現損益）；回傳 {ok, msg}
  // market/name 為選填覆寫（例：從建議清單選了加密貨幣時傳入 'crypto'）
  // accountId 為選填現金帳戶：買入自動扣款、賣出自動存入
  // time 為選填成交時間(ms，供指定日期/定期定額回補)；source 標記來源(例：'dca')
  function addTransaction({ symbolInput, type, shares, price, fee, market, name, accountId, time, source }) {
    const symbol = U.sanitizeSymbol(symbolInput);
    if (!symbol || shares <= 0 || price <= 0) return { ok: false, msg: '請輸入正確的代碼/股數/價格' };
    fee = Math.round((fee || 0) * 100) / 100; // 手續費一律存到小數點第 2 位
    const ts = time || Date.now();

    // 確保 meta 存在（有明確 market 覆寫時優先採用）
    const mmap = S.metaMap();
    if (market) {
      S.upsertMeta([{ code: symbol, name: name || (mmap[symbol] && mmap[symbol].name) || symbol, market: U.normalizeMarketKey(market) }]);
    } else {
      const guessed = U.guessMarketBySymbol(symbol);
      const existing = mmap[symbol];
      if (!existing) {
        S.upsertMeta([{ code: symbol, name: symbol, market: guessed }]);
      } else if (guessed === U.Market.us && existing.market !== U.Market.us && existing.market !== U.Market.crypto) {
        S.upsertMeta([{ code: symbol, name: existing.name, market: U.Market.us }]);
      }
    }

    const txs = S.getTransactions();
    if (type === 'SELL') {
      const symbolTxs = txs.filter(t => t.symbol === symbol);
      const { shares: posShares, avgCost } = computeAvgCostPosition(symbolTxs);
      if (posShares <= 1e-9) return { ok: false, msg: '目前沒有持倉，無法賣出' };
      if (shares > posShares + 1e-9) return { ok: false, msg: '賣出股數超過持倉（持倉：' + U.formatShares(posShares) + '）' };
      const realized = shares * price - shares * avgCost - fee;
      const rz = S.getRealized();
      rz.push({ id: S.uuid(), symbol, shares, sellPrice: price, avgCost, realizedPnl: realized, time: ts });
      S.setRealized(rz);
    }

    const newTx = { id: S.uuid(), symbol, type, shares, price, fee, time: ts };
    if (accountId) newTx.accountId = accountId;
    if (source) newTx.source = source;
    txs.push(newTx);
    S.setTransactions(txs);
    // 現金帳戶連動：買入扣款、賣出存入（帳戶原幣別金額）
    if (accountId) S.adjustCashBalance(accountId, txCashDelta(newTx));
    return { ok: true, symbol };
  }

  // 交易對現金帳戶的影響（原幣別）：BUY = −(金額+費)、SELL = +(金額−費)
  function txCashDelta(tx) {
    const amt = tx.shares * tx.price;
    return tx.type === 'BUY' ? -(amt + tx.fee) : (amt - tx.fee);
  }

  // 更新交易並重算該代碼的已實現損益（現金效果：先沖銷舊值再套用新值）
  function updateTransaction(id, { type, shares, price, fee, time }) {
    if (shares <= 0 || price <= 0) return { ok: false, msg: '請輸入正確的股數/價格' };
    fee = Math.round((fee || 0) * 100) / 100; // 手續費一律存到小數點第 2 位
    const txs = S.getTransactions();
    const tx = txs.find(t => t.id === id);
    if (!tx) return { ok: false, msg: '找不到交易' };
    if (tx.accountId) S.adjustCashBalance(tx.accountId, -txCashDelta(tx)); // 沖銷舊
    tx.type = type; tx.shares = shares; tx.price = price; tx.fee = fee; tx.time = time;
    if (tx.accountId) S.adjustCashBalance(tx.accountId, txCashDelta(tx));  // 套用新
    S.setTransactions(txs);
    recomputeRealized(tx.symbol);
    return { ok: true, symbol: tx.symbol };
  }

  function deleteTransaction(id) {
    let txs = S.getTransactions();
    const tx = txs.find(t => t.id === id);
    if (!tx) return;
    if (tx.accountId) S.adjustCashBalance(tx.accountId, -txCashDelta(tx)); // 沖銷現金效果
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
      if (t.type !== 'SELL') {          // BUY 與 STOCK_DIV 皆累加
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

  // 股票股利(配股)：新增一筆 STOCK_DIV 交易(零成本加股)；走現有持倉/成本引擎
  function addStockDividend({ symbolInput, market, name, shares, date }) {
    const symbol = U.sanitizeSymbol(symbolInput);
    if (!symbol || !(shares > 0)) return { ok: false, msg: '請輸入正確的代碼與配股股數' };
    const mk = market ? U.normalizeMarketKey(market) : U.guessMarketBySymbol(symbol);
    const mmap = S.metaMap();
    if (!mmap[symbol] || market) S.upsertMeta([{ code: symbol, name: name || (mmap[symbol] && mmap[symbol].name) || symbol, market: mk }]);
    const txs = S.getTransactions();
    const time = date ? new Date(date + 'T12:00:00+08:00').getTime() : Date.now();
    txs.push({ id: S.uuid(), symbol, type: 'STOCK_DIV', shares, price: 0, fee: 0, time });
    S.setTransactions(txs);
    return { ok: true, symbol };
  }

  // 股利換算 TWD 的共用判斷
  function _divIsUsd(sym) { const mmap = S.metaMap(); const m = U.normalizeMarketKey((mmap[sym] && mmap[sym].market) || U.guessMarketBySymbol(sym)); return m === U.Market.us || m === U.Market.crypto; }

  // 全部股利淨額 → TWD（美股以目前匯率換算）
  function dividendsTotalTwd() {
    const rate = S.getFxRate() || 31.5;
    let sum = 0;
    for (const d of S.getDividends()) sum += (d.amount || 0) * (_divIsUsd(d.symbol) ? rate : 1);
    return sum;
  }

  // 期間股利統計（TWD）：{total, tw, us, count}；含頭尾 ISO 日期過濾
  function dividendsBetween(from, to) {
    const rate = S.getFxRate() || 31.5;
    const inWin = dt => (!from || dt >= from) && (!to || dt <= to);
    let total = 0, tw = 0, us = 0, count = 0;
    for (const d of S.getDividends()) {
      if (!inWin(d.date)) continue;
      const usd = _divIsUsd(d.symbol);
      const v = (d.amount || 0) * (usd ? rate : 1);
      total += v; count++;
      if (usd) us += v; else tw += v;
    }
    return { total, tw, us, count };
  }

  // 指定日期（不含當日）之前某標的的持股（供台股股利依除息日持股自動計算）
  function sharesHeldBefore(symbol, dateIso) {
    const txs = S.getTransactions().filter(t => t.symbol === symbol && U.isoDate(new Date(t.time)) < dateIso);
    return computeAvgCostPosition(txs).shares;
  }

  // 累計股利（TWD）至指定日期（含）；dateIso 為空 → 全部。美股以目前匯率換算（供報表歷史含息報酬）
  function dividendsUpTo(dateIso) {
    const rate = S.getFxRate() || 31.5;
    let sum = 0;
    for (const d of S.getDividends()) if (!dateIso || d.date <= dateIso) sum += (d.amount || 0) * (_divIsUsd(d.symbol) ? rate : 1);
    return sum;
  }

  // 現金股利：寫入帳本；有 accountId 則入帳(原幣別)。回傳 {ok, id?}
  function addDividend({ symbolInput, market, name, amount, date, accountId, note, exDate }) {
    const symbol = U.sanitizeSymbol(symbolInput);
    if (!symbol || !(amount > 0)) return { ok: false, msg: '請輸入正確的代碼與金額' };
    const mk = market ? U.normalizeMarketKey(market) : U.guessMarketBySymbol(symbol);
    const mmap = S.metaMap();
    if (!mmap[symbol] || market) S.upsertMeta([{ code: symbol, name: name || (mmap[symbol] && mmap[symbol].name) || symbol, market: mk }]);
    const list = S.getDividends();
    const rec = { id: S.uuid(), symbol, market: mk, amount, date: date || U.isoDate(), createdAt: Date.now() };
    if (accountId) rec.accountId = accountId;
    if (note) rec.note = note;
    if (exDate) rec.exDate = exDate; // 除息日,供自動掃描去重
    list.push(rec);
    S.setDividends(list);
    if (accountId) S.adjustCashBalance(accountId, amount);
    return { ok: true, symbol, id: rec.id };
  }

  function updateDividend(id, { amount, date, accountId, note }) {
    const list = S.getDividends();
    const rec = list.find(d => d.id === id);
    if (!rec) return { ok: false, msg: '找不到股利' };
    if (!(amount > 0)) return { ok: false, msg: '請輸入正確金額' };
    if (rec.accountId) S.adjustCashBalance(rec.accountId, -rec.amount);   // 沖銷舊
    rec.amount = amount; rec.date = date || rec.date;
    rec.accountId = accountId || undefined; rec.note = note || undefined;
    if (rec.accountId) S.adjustCashBalance(rec.accountId, rec.amount);    // 套用新
    S.setDividends(list);
    return { ok: true };
  }

  function deleteDividend(id) {
    const list = S.getDividends();
    const rec = list.find(d => d.id === id);
    if (!rec) return;
    if (rec.accountId) S.adjustCashBalance(rec.accountId, -rec.amount);
    S.setDividends(list.filter(d => d.id !== id));
  }

  // 刪除某代碼所有資料（含沖銷各交易的現金帳戶效果）
  function deleteSymbol(symbolInput) {
    const sym = U.sanitizeSymbol(symbolInput);
    for (const t of S.getTransactions()) {
      if (t.symbol === sym && t.accountId) S.adjustCashBalance(t.accountId, -txCashDelta(t));
    }
    S.setTransactions(S.getTransactions().filter(t => t.symbol !== sym));
    S.setRealized(S.getRealized().filter(r => r.symbol !== sym));
    for (const d of S.getDividends()) { if (d.symbol === sym && d.accountId) S.adjustCashBalance(d.accountId, -d.amount); }
    S.setDividends(S.getDividends().filter(d => d.symbol !== sym));
    const p = S.getPrices(); delete p[sym]; S.setPrices(p);
    // 群組對應一併移除
    const gm = S.getGroupMap();
    if (gm[sym]) { delete gm[sym]; S.setGroupMap(gm); }
  }

  // 資產頁彙總：淨資產 = 流動資金 + 投資市值 − 負債（USD 帳戶以匯率換算）
  function assetsSummary() {
    const rate = S.getFxRate() || 31.5;
    const toTwd = a => (a.currency === 'USD' ? (a.balance || 0) * rate : (a.balance || 0));
    const cashTwd = S.getCashAccounts().reduce((s, a) => s + toTwd(a), 0);
    const liabTwd = S.getLiabilities().reduce((s, a) => s + toTwd(a), 0);
    const inv = buildSummary(buildPositions());
    return {
      cashTwd, liabTwd,
      investTwd: inv.totalMarketValueTwd,
      netWorth: cashTwd + inv.totalMarketValueTwd - liabTwd,
      invSummary: inv,
    };
  }

  // 現金帳戶 / 負債 台幣總額（美金 ×匯率）
  function cashLiabTwd() {
    const rate = S.getFxRate() || 31.5;
    const toTwd = a => (a.currency === 'USD' ? (a.balance || 0) * rate : (a.balance || 0));
    return {
      cashTwd: S.getCashAccounts().reduce((s, a) => s + toTwd(a), 0),
      liabTwd: S.getLiabilities().reduce((s, a) => s + toTwd(a), 0),
    };
  }

  // 儲存今日快照（覆蓋同日）
  function saveTodaySnapshot() {
    const summary = buildSummary(buildPositions());
    const date = U.isoDate();
    const { cashTwd, liabTwd } = cashLiabTwd();
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
      cryptoMarketValueTwd: summary.cryptoMarketValueTwd,
      totalMarketValueTwd: summary.totalMarketValueTwd,
      twCostBasis: summary.twCostBasis,
      usCostBasisTwd: summary.usCostBasisTwd,
      cryptoCostBasisTwd: summary.cryptoCostBasisTwd,
      totalCostBasisTwd: summary.totalCostBasisTwd,
      twUnrealizedPnl: summary.twUnrealizedPnl,
      usUnrealizedPnlTwd: summary.usUnrealizedPnlTwd,
      cryptoUnrealizedPnlTwd: summary.cryptoUnrealizedPnlTwd,
      twRealizedPnl: summary.twRealizedPnl,
      usRealizedPnlTwd: summary.usRealizedPnlTwd,
      cryptoRealizedPnlTwd: summary.cryptoRealizedPnlTwd,
      twTotalPnl: summary.twTotalPnl,
      usTotalPnlTwd: summary.usTotalPnlTwd,
      cryptoTotalPnlTwd: summary.cryptoTotalPnlTwd,
      twReturnPct: summary.twUnrealizedPnlPct || 0,
      usReturnPct: summary.usUnrealizedPnlPct || 0,
      totalReturnPct: summary.totalReturnPct || 0,
      // 資產頁分項：流動資金 / 負債 / 淨資產（= 投資市值 + 現金 − 負債）
      cashAccountsTwd: cashTwd,
      liabilitiesTwd: liabTwd,
      netWorth: summary.totalMarketValueTwd + cashTwd - liabTwd,
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

  // 由原始累計值組出完整快照（補齊衍生欄位，含加密）
  function makeSnapshot(date, s) {
    const cMV = s.cryptoMarketValueTwd || 0, cCost = s.cryptoCostBasisTwd || 0;
    const cUnr = s.cryptoUnrealizedPnlTwd || 0, cRel = s.cryptoRealizedPnlTwd || 0;
    const totalMV = s.twMarketValue + s.usMarketValueTwd + cMV;
    const totalCost = s.twCostBasis + s.usCostBasisTwd + cCost;
    const twTotal = s.twUnrealizedPnl + s.twRealizedPnl;
    const usTotal = s.usUnrealizedPnlTwd + s.usRealizedPnlTwd;
    const cTotal = cUnr + cRel;
    const totalPnl = twTotal + usTotal + cTotal;
    const cash = s.cashBalance || 0;
    return {
      date,
      marketValue: totalMV, cashBalance: cash, netAsset: totalMV + cash,
      unrealizedPnl: s.twUnrealizedPnl + s.usUnrealizedPnlTwd + cUnr,
      realizedPnl: s.twRealizedPnl + s.usRealizedPnlTwd + cRel,
      totalPnl, dayPnl: 0,
      twMarketValue: s.twMarketValue, usMarketValueTwd: s.usMarketValueTwd, cryptoMarketValueTwd: cMV, totalMarketValueTwd: totalMV,
      twCostBasis: s.twCostBasis, usCostBasisTwd: s.usCostBasisTwd, cryptoCostBasisTwd: cCost, totalCostBasisTwd: totalCost,
      twUnrealizedPnl: s.twUnrealizedPnl, usUnrealizedPnlTwd: s.usUnrealizedPnlTwd, cryptoUnrealizedPnlTwd: cUnr,
      twRealizedPnl: s.twRealizedPnl, usRealizedPnlTwd: s.usRealizedPnlTwd, cryptoRealizedPnlTwd: cRel,
      twTotalPnl: twTotal, usTotalPnlTwd: usTotal, cryptoTotalPnlTwd: cTotal,
      twReturnPct: s.twCostBasis > 1e-9 ? s.twUnrealizedPnl / s.twCostBasis * 100 : 0,
      usReturnPct: s.usCostBasisTwd > 1e-9 ? s.usUnrealizedPnlTwd / s.usCostBasisTwd * 100 : 0,
      totalReturnPct: totalCost > 1e-9 ? totalPnl / totalCost * 100 : 0,
      // 重建時以「目前」現金/負債回填（歷史餘額無從得知）
      cashAccountsTwd: s._cashTwd || 0,
      liabilitiesTwd: s._liabTwd || 0,
      netWorth: totalMV + (s._cashTwd || 0) - (s._liabTwd || 0),
      createdAt: Date.now(),
    };
  }

  // 用交易紀錄 + 歷史收盤，回推每一天的快照（重建歷史走勢）
  // hist: { code: [{date:'YYYY-MM-DD', close:number}, ...] }（已升序，含台股與美股）
  // 無歷史價的代碼則以成本估算
  function rebuildSnapshots(hist, fxRate) {
    const txs = S.getTransactions().slice().sort((a, b) => a.time - b.time);
    if (!txs.length) return 0;
    const rate = fxRate || S.getFxRate() || 31.5;
    const clNow = cashLiabTwd(); // 現金/負債以目前值回填
    const mmap = S.metaMap();
    const acc = S.getAccount();
    const realized = S.getRealized();
    const txDate = t => U.isoDate(new Date(t.time));

    const firstDate = txDate(txs[0]);
    const today = U.isoDate();
    const start = new Date(firstDate + 'T00:00:00+08:00');
    const end = new Date(today + 'T00:00:00+08:00');

    // 各檔 carry-forward 指標（台股 + 美股）
    const codes = Object.keys(hist);
    const ptr = {}, last = {};
    codes.forEach(c => { ptr[c] = 0; last[c] = null; });

    const snaps = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = U.isoDate(d);
      codes.forEach(c => {
        const arr = hist[c];
        while (ptr[c] < arr.length && arr[ptr[c]].date <= ds) { last[c] = arr[ptr[c]].close; ptr[c]++; }
      });

      const bySym = {};
      for (const t of txs) { if (txDate(t) <= ds) (bySym[t.symbol] = bySym[t.symbol] || []).push(t); }

      const s = { twMarketValue: 0, usMarketValueTwd: 0, cryptoMarketValueTwd: 0, twCostBasis: 0, usCostBasisTwd: 0, cryptoCostBasisTwd: 0, twUnrealizedPnl: 0, usUnrealizedPnlTwd: 0, cryptoUnrealizedPnlTwd: 0, twRealizedPnl: 0, usRealizedPnlTwd: 0, cryptoRealizedPnlTwd: 0, cashBalance: 0 };
      for (const sym in bySym) {
        const { shares, avgCost } = computeAvgCostPosition(bySym[sym]);
        if (shares <= 1e-9) continue;
        const cost = shares * avgCost;
        const market = U.normalizeMarketKey(mmap[sym] ? mmap[sym].market : U.guessMarketBySymbol(sym));
        const price = last[sym] != null ? last[sym] : avgCost; // 歷史收盤（無則用成本）
        const mv = price * shares;
        if (market === U.Market.crypto) {
          s.cryptoMarketValueTwd += mv * rate; s.cryptoCostBasisTwd += cost * rate; s.cryptoUnrealizedPnlTwd += (mv - cost) * rate;
        } else if (market === U.Market.us) {
          s.usMarketValueTwd += mv * rate; s.usCostBasisTwd += cost * rate; s.usUnrealizedPnlTwd += (mv - cost) * rate;
        } else {
          s.twMarketValue += mv; s.twCostBasis += cost; s.twUnrealizedPnl += (mv - cost);
        }
      }
      for (const rt of realized) {
        if (U.isoDate(new Date(rt.time)) > ds) continue;
        const market = U.normalizeMarketKey(mmap[rt.symbol] ? mmap[rt.symbol].market : U.guessMarketBySymbol(rt.symbol));
        if (market === U.Market.crypto) s.cryptoRealizedPnlTwd += rt.realizedPnl * rate;
        else if (market === U.Market.us) s.usRealizedPnlTwd += rt.realizedPnl * rate;
        else s.twRealizedPnl += rt.realizedPnl;
      }
      if (acc.initialCash != null) {
        let spent = 0, recv = 0;
        for (const t of txs) { if (txDate(t) > ds) continue; if (t.type === 'BUY') spent += t.shares * t.price + t.fee; else recv += t.shares * t.price - t.fee; }
        s.cashBalance = acc.initialCash - spent + recv;
      }
      s._cashTwd = clNow.cashTwd; s._liabTwd = clNow.liabTwd;
      snaps.push(makeSnapshot(ds, s));
    }
    S.setSnapshots(snaps);
    return snaps.length;
  }

  // 手續費防呆（SPEC I7）：fee > 成交金額 25% 視為異常
  // 背景：fee 計入成本(computeAvgCostPosition)，被誤填成天文數字會毒掉整份報表/重建歷史
  function findAbsurdFees(txs) {
    const out = [];
    for (const t of txs || []) {
      const amt = (t.shares || 0) * (t.price || 0);
      if (amt > 1e-9 && (t.fee || 0) > amt * 0.25) out.push({ symbol: t.symbol, fee: t.fee, amount: amt, time: t.time });
    }
    return out;
  }

  // 自動修正舊版編輯 bug 造成的異常手續費。
  // 舊 bug：編輯交易時把「已存的絕對金額 fee」當成費率% 重算 → fee = amount×(oldFee/100)，
  // 使 fee 遠大於成交金額。合法手續費永遠遠小於成交金額，故「fee > 成交金額」必為受損資料，
  // 可精確反推：oldFee = fee×100/amount（多次儲存會複利，迭代還原至 ≤ 成交金額即為原值）。
  // 僅動「fee > 成交金額」者 → 零誤傷（真實手續費不可能超過整筆成交金額）。
  function repairFees() {
    const txs = S.getTransactions();
    const mmap = S.metaMap();
    const fixed = [], affected = new Set();
    for (const t of txs) {
      const amt = (t.shares || 0) * (t.price || 0);
      if (amt <= 1e-9) continue;
      let fee = t.fee || 0;
      if (fee <= amt) continue;               // 正常：手續費 ≤ 成交金額 → 不動
      const before = fee;
      let guard = 0;
      while (fee > amt && guard < 8) { fee = fee * 100 / amt; guard++; } // 逐次還原每次誤存
      if (!isFinite(fee) || fee < 0 || fee > amt) {
        // 極小額交易未收斂 → 以標準費率估回（台股 0.1425% / 美股 0.08% / 加密 0.1%）
        const mk = U.normalizeMarketKey((mmap[t.symbol] && mmap[t.symbol].market) || U.guessMarketBySymbol(t.symbol));
        const rate = mk === U.Market.us ? 0.0008 : mk === U.Market.crypto ? 0.001 : 0.001425;
        fee = amt * rate;
      }
      fee = Math.round(fee * 100) / 100;
      t.fee = fee;
      fixed.push({ symbol: t.symbol, before, after: fee, time: t.time });
      affected.add(t.symbol);
    }
    if (fixed.length) {
      S.setTransactions(txs);
      for (const sym of affected) recomputeRealized(sym); // 重算已實現損益（fee 影響賣出損益與成本）
    }
    return { fixed };
  }

  // 淨資產長條圖分桶（純函式；SPEC §6）。gran ∈ day|week|month|year
  //  - nwOf 回填舊快照；同桶(週/月/年)取最後一筆
  //  - change：有前一桶→跨期差；無前一桶(最早/唯一)→期間內漲幅(期末−期初)，避免顯示 0
  //  - 視窗：day=7 / week=5 / month=12 / year=10；空快照→[]
  function netWorthBuckets(snapshots, gran, cashLiab, noWindow) {
    const cl = cashLiab || { cashTwd: 0, liabTwd: 0 };
    const nwOf = s => (s.netWorth != null ? s.netWorth
      : (s.totalMarketValueTwd != null ? s.totalMarketValueTwd : (s.netAsset || 0)) + (cl.cashTwd || 0) - (cl.liabTwd || 0));
    const snaps = (snapshots || []).filter(s => s && s.date).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    if (!snaps.length) return [];
    const series = snaps.map(s => ({ date: s.date, nw: nwOf(s) }));
    const md = iso => { const p = iso.split('-'); return (+p[1]) + '/' + (+p[2]); };
    const weekKey = iso => { // 回到當週週一（以 UTC 正午計算日曆星期，與行程時區無關）
      const p = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      return dt.toISOString().slice(0, 10);
    };
    let buckets;
    if (gran === 'day') {
      buckets = series.map(d => ({ date: d.date, nw: d.nw, first: d.nw, label: md(d.date), full: d.date }));
    } else {
      const keyOf = iso => gran === 'week' ? weekKey(iso) : gran === 'month' ? iso.slice(0, 7) : iso.slice(0, 4);
      const map = new Map();
      for (const d of series) {
        const k = keyOf(d.date);
        if (!map.has(k)) map.set(k, { first: d, last: d });
        else map.get(k).last = d;
      }
      buckets = [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([, o]) => ({
        date: o.last.date, nw: o.last.nw, first: o.first.nw,
        label: gran === 'week' ? md(o.last.date) : gran === 'month' ? (+o.last.date.slice(5, 7)) + '月' : o.last.date.slice(0, 4),
        full: gran === 'week' ? ('週 ' + md(o.last.date)) : gran === 'month' ? o.last.date.slice(0, 7) : o.last.date.slice(0, 4),
      }));
    }
    const withChange = buckets.map((b, i) => Object.assign({}, b, { change: i > 0 ? b.nw - buckets[i - 1].nw : b.nw - b.first }));
    const N = gran === 'day' ? 7 : gran === 'week' ? 5 : gran === 'month' ? 12 : 10;
    return noWindow ? withChange : withChange.slice(-N); // 指定區間(YTD/自選)→ 顯示全部桶，不套最後N筆視窗
  }

  // 群組每日市值序列（依交易 + 成員歷史收盤回推；美股/加密 ×匯率）
  // symbols: 群組成員代碼；hist: { code:[{date,close}] }；回傳 [{date, mv}]（升冪、延伸到今天）
  function buildGroupSeries(symbols, hist, fxRate) {
    const set = new Set(symbols || []);
    const txs = S.getTransactions().filter(t => set.has(t.symbol)).sort((a, b) => a.time - b.time);
    if (!txs.length) return [];
    const rate = fxRate || S.getFxRate() || 31.5;
    const mmap = S.metaMap();
    const codes = [...set];
    const txDate = t => U.isoDate(new Date(t.time));
    const isUsd = sym => { const m = U.normalizeMarketKey(mmap[sym] ? mmap[sym].market : U.guessMarketBySymbol(sym)); return m === U.Market.us || m === U.Market.crypto; };
    const ptr = {}, last = {};
    codes.forEach(c => { ptr[c] = 0; last[c] = null; });
    const start = new Date(txDate(txs[0]) + 'T00:00:00+08:00');
    const end = new Date(U.isoDate() + 'T00:00:00+08:00');
    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = U.isoDate(d);
      for (const c of codes) { const arr = hist[c] || []; while (ptr[c] < arr.length && arr[ptr[c]].date <= ds) { last[c] = arr[ptr[c]].close; ptr[c]++; } }
      const bySym = {};
      for (const t of txs) { if (txDate(t) <= ds) (bySym[t.symbol] = bySym[t.symbol] || []).push(t); }
      let mv = 0, cost = 0;
      for (const sym in bySym) {
        const { shares, avgCost } = computeAvgCostPosition(bySym[sym]);
        if (shares <= 1e-9) continue;
        const price = last[sym] != null ? last[sym] : avgCost; // 無歷史價 → 成本估算
        const conv = isUsd(sym) ? rate : 1;
        mv += price * shares * conv;
        cost += avgCost * shares * conv;
      }
      out.push({ date: ds, mv, cost });
    }
    return out;
  }

  // 統計頁：區間獲利之最（日/週/月/年）、單筆交易之最、目前持倉之最（SPEC §10）
  function tradingStats() {
    const snaps = S.getSnapshots().slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const rate = S.getFxRate() || 31.5;
    const weekKey = iso => { const p = iso.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    const keyOf = (iso, g) => g === 'day' ? iso : g === 'week' ? weekKey(iso) : g === 'month' ? iso.slice(0, 7) : iso.slice(0, 4);
    // 區間 totalPnl 變化的極值（獲利取正、虧損取負；否則 null）
    // 忽略初始失真：(1) 重建歷史時前幾天無報價 → totalPnl=0 的成本基準，其到首個真實值
    //   的跳變會灌爆單期損益；(2) 第一個真實期間仍以初始為基準。故從「首個非零之後再跳一期」起算。
    const periodExtremes = (subset, g) => {
      const map = new Map();
      for (const s of subset) map.set(keyOf(s.date, g), s); // 同桶取最後（chronological）
      const arr = [...map.values()];
      let firstReal = arr.findIndex(s => (s.totalPnl || 0) !== 0); // 略過開頭 0 基準
      if (firstReal < 0) firstReal = arr.length;
      const start = Math.max(2, firstReal + 1); // +1 跳過 0→首值的假峰；≥2 再忽略第一個期間
      let best = null, worst = null;
      for (let i = start; i < arr.length; i++) {
        const chg = (arr[i].totalPnl || 0) - (arr[i - 1].totalPnl || 0);
        if (chg > 0 && (!best || chg > best.amount)) best = { date: arr[i].date, amount: chg };
        if (chg < 0 && (!worst || chg < worst.amount)) worst = { date: arr[i].date, amount: chg };
      }
      return { best, worst };
    };
    const periodsFor = (subset, grans) => { const o = {}; for (const g of grans) o[g] = periodExtremes(subset, g); return o; };
    const curYear = U.isoDate().slice(0, 4);
    const thisYearSnaps = snaps.filter(s => s.date.slice(0, 4) === curYear);

    // 單筆交易之最（最賺取正、最賠取負；含成交股數/價格）
    const mmap = S.metaMap();
    let bestTrade = null, worstTrade = null;
    for (const r of S.getRealized()) {
      const rec = { symbol: r.symbol, amount: r.realizedPnl, date: U.isoDate(new Date(r.time)),
        shares: r.shares, price: r.sellPrice,
        market: U.normalizeMarketKey((mmap[r.symbol] && mmap[r.symbol].market) || U.guessMarketBySymbol(r.symbol)) };
      if (r.realizedPnl > 0 && (!bestTrade || r.realizedPnl > bestTrade.amount)) bestTrade = rec;
      if (r.realizedPnl < 0 && (!worstTrade || r.realizedPnl < worstTrade.amount)) worstTrade = rec;
    }

    // 目前持倉之最（未實現，換算 TWD；獲利王取正、虧損王取負）
    const isUsd = m => { const k = U.normalizeMarketKey(m); return k === U.Market.us || k === U.Market.crypto; };
    let topGain = null, topLoss = null, topPct = null;
    for (const p of buildPositions()) {
      if (p.lastPrice == null) continue; // 無報價不列
      const amt = p.unrealizedPnl * (isUsd(p.market) ? rate : 1);
      const pct = p.cost > 1e-9 ? p.unrealizedPnl / p.cost * 100 : 0;
      const rec = { symbol: p.symbol, name: p.name, amount: amt, pct };
      if (amt > 0 && (!topGain || amt > topGain.amount)) topGain = rec;
      if (amt < 0 && (!topLoss || amt < topLoss.amount)) topLoss = rec;
      if (!topPct || pct > topPct.pct) topPct = rec;
    }

    return {
      period: {
        thisYear: periodsFor(thisYearSnaps, ['day', 'week', 'month']),
        all: periodsFor(snaps, ['day', 'week', 'month', 'year']),
      },
      bestTrade, worstTrade, topGain, topLoss, topPct,
    };
  }

  // ===== XIRR 年化報酬率（資金加權）=====
  // 解 Σ amountᵢ/(1+r)^yearsᵢ = 0 的 r（年 = 365.25 天）。
  // flows: [{time(ms), amount}]，負=投入、正=收回。Newton 快速收斂,失敗退二分法。
  // 無解（全同號 / <2 筆 / 超出 −99.99%~+1000%）→ null。
  function xirrRate(flows) {
    if (!flows || flows.length < 2) return null;
    let hasNeg = false, hasPos = false, t0 = Infinity;
    for (const f of flows) {
      if (f.amount < 0) hasNeg = true;
      if (f.amount > 0) hasPos = true;
      if (f.time < t0) t0 = f.time;
    }
    if (!hasNeg || !hasPos) return null;
    const YEAR_MS = 365.25 * 86400000;
    const npv = r => { let s = 0; for (const f of flows) s += f.amount / Math.pow(1 + r, (f.time - t0) / YEAR_MS); return s; };
    const sane = r => (isFinite(r) && r > -0.9999 && r < 10) ? r : null;

    // Newton-Raphson（數值微分）
    let r = 0.1;
    for (let i = 0; i < 60; i++) {
      const v = npv(r);
      if (Math.abs(v) < 1e-7) return sane(r);
      const h = 1e-6;
      const d = (npv(r + h) - v) / h;
      if (!isFinite(d) || Math.abs(d) < 1e-12) break;
      const nr = r - v / d;
      if (!isFinite(nr) || nr <= -0.9999 || nr > 1e6) break;
      if (Math.abs(nr - r) < 1e-10) return sane(nr);
      r = nr;
    }
    // 二分法備援（需區間端點異號）
    let lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-7 || (hi - lo) < 1e-10) return sane(mid);
      if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return null;
  }

  // 組合現金流：BUY −(股數×價+費)、SELL +(股數×價−費)、現金股利 +淨額、終值 +目前市值。
  // STOCK_DIV(配股)無現金流（價值反映在終值）。美股/加密以現行匯率換 TWD（FX 中性慣例）。
  function buildXirrFlows(nowMs) {
    const now = nowMs || Date.now();
    const rate = S.getFxRate() || 31.5;
    const flows = [];
    for (const t of S.getTransactions()) {
      if (t.type === 'STOCK_DIV') continue;
      const conv = _divIsUsd(t.symbol) ? rate : 1;
      const amt = t.type === 'SELL'
        ? (t.shares * t.price - (t.fee || 0))
        : -(t.shares * t.price + (t.fee || 0));
      flows.push({ time: t.time, amount: amt * conv });
    }
    for (const d of S.getDividends()) {
      const time = d.date ? new Date(d.date + 'T12:00:00+08:00').getTime() : (d.createdAt || now);
      const amt = (d.amount || 0) * (_divIsUsd(d.symbol) ? rate : 1);
      if (amt > 0) flows.push({ time: Math.min(time, now), amount: amt });
    }
    let mv = 0;
    for (const p of buildPositions()) {
      const v = (p.lastPrice != null ? p.lastPrice : p.avgCost) * p.shares;
      mv += v * (_divIsUsd(p.symbol) ? rate : 1);
    }
    if (mv > 1e-9) flows.push({ time: now, amount: mv });
    return flows;
  }

  // 全組合 XIRR：回 {rate(%), days(自首筆投入), since('YYYY-MM-DD')}；不足以計算 → null
  function portfolioXirr(nowMs) {
    const now = nowMs || Date.now();
    const flows = buildXirrFlows(now);
    if (flows.length < 2) return null;
    const r = xirrRate(flows);
    if (r == null) return null;
    let first = Infinity;
    for (const f of flows) if (f.time < first) first = f.time;
    return { rate: r * 100, days: Math.floor((now - first) / 86400000), since: U.isoDate(new Date(first)) };
  }

  // 指定時間範圍的統計（報表鑽取用）：區間損益 + 區間獲利之最（各粒度）+ 該區間單筆交易之最
  //   from/to：ISO 日期含頭尾；grans：要計算的期間粒度。以區間前一筆快照為基準算首期變化。
  function scopedStats(from, to, grans) {
    const allSnaps = S.getSnapshots().slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const weekKey = iso => { const p = iso.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    const keyOf = (iso, g) => g === 'day' ? iso : g === 'week' ? weekKey(iso) : g === 'month' ? iso.slice(0, 7) : iso.slice(0, 4);

    const inRange = allSnaps.filter(s => (!from || s.date >= from) && (!to || s.date <= to));
    const base = from ? (allSnaps.filter(s => s.date < from).pop() || null) : null;
    const subset = base ? [base, ...inRange] : inRange;

    const periodExtremes = g => {
      const map = new Map();
      for (const s of subset) map.set(keyOf(s.date, g), s); // 同桶取最後
      const arr = [...map.values()];
      let start;
      if (base) start = 1; // arr[0] 為區間前基準桶，從第一個區間內桶起算
      else { let fr = arr.findIndex(s => (s.totalPnl || 0) !== 0); if (fr < 0) fr = arr.length; start = Math.max(2, fr + 1); }
      let best = null, worst = null;
      for (let i = start; i < arr.length; i++) {
        const chg = (arr[i].totalPnl || 0) - (arr[i - 1].totalPnl || 0);
        if (chg > 0 && (!best || chg > best.amount)) best = { date: arr[i].date, amount: chg };
        if (chg < 0 && (!worst || chg < worst.amount)) worst = { date: arr[i].date, amount: chg };
      }
      return { best, worst };
    };
    const period = {};
    for (const g of (grans || ['day', 'week', 'month'])) period[g] = periodExtremes(g);

    // 區間損益 = 區間最後一筆 totalPnl − 基準 totalPnl（含息 = 再加上區間收到的股息）
    let periodPnl = null, periodReturnPct = null, periodDividend = 0, periodReturnWithDivPct = null;
    if (inRange.length) {
      const last = inRange[inRange.length - 1];
      periodPnl = (last.totalPnl || 0) - (base ? (base.totalPnl || 0) : 0);
      const cost = last.totalCostBasisTwd || 0;
      periodReturnPct = cost > 1e-9 ? periodPnl / cost * 100 : 0;
      periodDividend = dividendsBetween(from, to).total; // 區間股息(TWD)
      periodReturnWithDivPct = cost > 1e-9 ? (periodPnl + periodDividend) / cost * 100 : 0;
    }

    // 該區間單筆交易之最（已實現，依成交日過濾）
    const mmap = S.metaMap();
    let bestTrade = null, worstTrade = null;
    for (const r of S.getRealized()) {
      const d = U.isoDate(new Date(r.time));
      if ((from && d < from) || (to && d > to)) continue;
      const rec = { symbol: r.symbol, amount: r.realizedPnl, date: d, shares: r.shares, price: r.sellPrice,
        market: U.normalizeMarketKey((mmap[r.symbol] && mmap[r.symbol].market) || U.guessMarketBySymbol(r.symbol)) };
      if (r.realizedPnl > 0 && (!bestTrade || r.realizedPnl > bestTrade.amount)) bestTrade = rec;
      if (r.realizedPnl < 0 && (!worstTrade || r.realizedPnl < worstTrade.amount)) worstTrade = rec;
    }

    return { period, periodPnl, periodReturnPct, periodDividend, periodReturnWithDivPct, bestTrade, worstTrade };
  }

  // ===== 定期定額 / 定期繳款（排程為純函式，可測試）=====
  // 以「日曆日期字串」運算，不涉時區；day 對月頻為 1..31(超過月底自動夾到當月最後一天)、
  // 對週/雙週頻為 0..6(週日..週六)。
  function _ymd(iso) { const p = (iso || '').split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function _pad(n) { return n < 10 ? '0' + n : '' + n; }
  function _mkIso(y, m, d) { return y + '-' + _pad(m) + '-' + _pad(d); }
  function _daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m:1..12
  function _isoWeekday(iso) { const p = _ymd(iso); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  function isoAddDays(iso, n) { const p = _ymd(iso); const dt = new Date(Date.UTC(p.y, p.m - 1, p.d)); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
  function _monthlyOcc(y, m, day) { return _mkIso(y, m, Math.min(day, _daysInMonth(y, m))); }
  function _addMonth(y, m, k) { const idx = (m - 1) + k; const ny = y + Math.floor(idx / 12); const nm = ((idx % 12) + 12) % 12 + 1; return { y: ny, m: nm }; }

  // 計畫在 (lastRun, today] 且 ≤ endDate 之間、所有「已到期未執行」的排程日期(升序)
  function recurringDueDates(plan, today) {
    if (!plan || !plan.startDate || !today) return [];
    const start = plan.startDate;
    const after = plan.lastRun || null;              // 僅回傳嚴格晚於 lastRun 者
    const end = plan.endDate || null;
    const limit = end && end < today ? end : today;  // 不超過今天，也不超過結束日
    if (limit < start) return [];
    const out = [];
    const freq = plan.freq || 'monthly';
    if (freq === 'monthly') {
      const day = plan.day || _ymd(start).d;
      let { y, m } = _ymd(start);
      let occ = _monthlyOcc(y, m, day);
      if (occ < start) { const nx = _addMonth(y, m, 1); y = nx.y; m = nx.m; occ = _monthlyOcc(y, m, day); }
      let guard = 0;
      while (occ <= limit && guard < 1200) {
        if (!after || occ > after) out.push(occ);
        const nx = _addMonth(y, m, 1); y = nx.y; m = nx.m; occ = _monthlyOcc(y, m, day);
        guard++;
      }
    } else {
      const step = freq === 'weekly' ? 7 : 14;
      const wd = (plan.day != null) ? plan.day : _isoWeekday(start);
      let occ = start, g0 = 0;
      while (_isoWeekday(occ) !== wd && g0 < 7) { occ = isoAddDays(occ, 1); g0++; }
      let guard = 0;
      while (occ <= limit && guard < 4000) {
        if (occ >= start && (!after || occ > after)) out.push(occ);
        occ = isoAddDays(occ, step);
        guard++;
      }
    }
    return out;
  }

  // 從升序日線 series 取「≤ dateIso 最近一筆」的價(basis: 'open'|'close')；假日/休市自動用前一交易日
  function priceOnOrBefore(series, dateIso, basis) {
    if (!series || !series.length) return null;
    let chosen = null;
    for (const r of series) { if (r.date <= dateIso) chosen = r; else break; }
    if (!chosen) return null;
    const v = (basis === 'open' && chosen.open != null) ? chosen.open : chosen.close;
    return (v > 0) ? v : null;
  }

  // 依計畫費率/固定手續費算單筆手續費(存到小數第 2 位)；amount = 該期投入金額
  function planFee(plan, amount) {
    const mode = plan && plan.feeMode || 'none';
    let fee = 0;
    if (mode === 'rate') fee = (amount || 0) * ((+plan.feeVal || 0) / 100);
    else if (mode === 'fixed') fee = (+plan.feeVal || 0);
    return Math.round(fee * 100) / 100;
  }

  // 期間實際投入（TWD，FX 中性）：直接由「交易」計算，不用快照的成本基礎差
  //   背景：usCostBasisTwd 以「當日匯率」換算，會隨匯率漂移；用 Δ成本 當「本期投入」會在
  //   沒有任何交易的期間出現假投入（重建歷史因全程用同一匯率才剛好歸零）。改由交易直接算：
  //   買入 +（股數×價＋手續費）；賣出 −（股數×賣出時均價，即移除的成本）；美股/加密以目前匯率換算。
  //   from 為前一期日期（不含），to 為本期日期（含）；from 為 null → 自始累計。
  function investedBetween(from, to) {
    if (!to) return 0;
    const rate = S.getFxRate() || 31.5;
    const mmap = S.metaMap();
    const isUsd = sym => { const m = U.normalizeMarketKey((mmap[sym] && mmap[sym].market) || U.guessMarketBySymbol(sym)); return m === U.Market.us || m === U.Market.crypto; };
    const inWin = d => (!from || d > from) && d <= to;
    let sum = 0;
    for (const t of S.getTransactions()) {
      if (t.type !== 'BUY') continue;
      if (!inWin(U.isoDate(new Date(t.time)))) continue;
      sum += (t.shares * t.price + (t.fee || 0)) * (isUsd(t.symbol) ? rate : 1);
    }
    for (const r of S.getRealized()) {
      if (!inWin(U.isoDate(new Date(r.time)))) continue;
      sum -= (r.shares * r.avgCost) * (isUsd(r.symbol) ? rate : 1);
    }
    return sum;
  }

  // 期間手續費統計（TWD）：{total, buy, sell, count}
  //   from/to 為含頭尾的 ISO 日期（皆選填；空 = 不限）；美股/加密手續費以目前匯率換算 TWD
  function feesSummary(from, to) {
    const rate = S.getFxRate() || 31.5;
    const mmap = S.metaMap();
    const isUsd = sym => { const m = U.normalizeMarketKey((mmap[sym] && mmap[sym].market) || U.guessMarketBySymbol(sym)); return m === U.Market.us || m === U.Market.crypto; };
    const inWin = d => (!from || d >= from) && (!to || d <= to);
    let total = 0, buy = 0, sell = 0, count = 0;
    for (const t of S.getTransactions()) {
      if (!inWin(U.isoDate(new Date(t.time)))) continue;
      if (t.type === 'STOCK_DIV') continue;         // 配股非交易,不計手續費/筆數
      const f = (t.fee || 0) * (isUsd(t.symbol) ? rate : 1);
      total += f; count++;
      if (t.type === 'BUY') buy += f; else sell += f;
    }
    return { total, buy, sell, count };
  }

  // 對負債套用一期繳款：餘額扣 pay(不超付/不為負)，若指定現金帳戶則同幣別同步扣款
  function applyLiabilityPayment(liabilityId, amount, accountId) {
    const list = S.getLiabilities();
    const liab = list.find(l => l.id === liabilityId);
    if (!liab) return { ok: false, paid: 0 };
    const bal = liab.balance || 0;
    const pay = Math.min(Math.max(0, +amount || 0), bal); // 不超付、不為負
    if (pay <= 0) return { ok: false, paid: 0 };
    liab.balance = Math.round((bal - pay) * 100) / 100;
    S.setLiabilities(list);
    if (accountId) S.adjustCashBalance(accountId, -pay);
    return { ok: true, paid: pay };
  }


  // 槓桿比例 = 曝險市值 / (資產 - 負債)
  // 曝險市值：每支持倉市值 × 使用者設定的曝險倍數（正二=2，原形=1）
  // 資產 - 負債 = 流動資金 + 投資市值 - 負債
  function computeLeverageRatio() {
    const rate = S.getFxRate() || 31.5;
    const positions = buildPositions();
    const expMap = S.getExposureMap();
    const toTwd = a => (a.currency === 'USD' ? (a.balance || 0) * rate : (a.balance || 0));
    const cashTwd = S.getCashAccounts().reduce((s, a) => s + toTwd(a), 0);
    const liabTwd = S.getLiabilities().reduce((s, a) => s + toTwd(a), 0);
    let investTwd = 0, exposureTwd = 0;
    for (const p of positions) {
      const mk = U.normalizeMarketKey(p.market);
      const mv = (mk === U.Market.us || mk === U.Market.crypto) ? p.marketValue * rate : p.marketValue;
      const mul = expMap[p.symbol] || 1;
      investTwd += mv;
      exposureTwd += mv * mul;
    }
    const netAssets = cashTwd + investTwd - liabTwd;
    const ratio = netAssets > 1e-9 ? exposureTwd / netAssets : null;
    return { ratio, exposureTwd, netAssets, investTwd, cashTwd, liabTwd };
  }

  return {
    computeAvgCostPosition, buildPositions, buildSummary,
    addTransaction, updateTransaction, deleteTransaction, recomputeRealized,
    addStockDividend, dividendsTotalTwd, dividendsBetween, dividendsUpTo, addDividend, updateDividend, deleteDividend, sharesHeldBefore,
    deleteSymbol, saveTodaySnapshot, rebuildSnapshots, assetsSummary, txCashDelta, cashLiabTwd,
    netWorthBuckets, findAbsurdFees, repairFees, buildGroupSeries, tradingStats, scopedStats, xirrRate, buildXirrFlows, portfolioXirr,
    recurringDueDates, isoAddDays, priceOnOrBefore, planFee, applyLiabilityPayment, investedBetween, feesSummary,
    computeLeverageRatio,
  };
})();
