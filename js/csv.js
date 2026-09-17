/* =========================================================================
 * csv.js — 匯出/匯入備份（單一 CSV 分段格式）
 *   前段（# TRANSACTIONS / # SNAPSHOTS）與 iOS app 相容；
 *   完整備份分段：# ACCOUNTS / # GROUPS / # DIVIDENDS / # RECURRING / # META / # SETTINGS
 *   帳戶/負債連結一律以「名稱」存（匯入時 id 重生）；缺分段不動既有資料（向後相容）。
 *   安全：不匯出 API 金鑰與 App 鎖（憑證/裝置綁定），還原後需自行重設。
 * ======================================================================= */
window.App = window.App || {};

App.Csv = (function () {
  const U = App.Util;
  const S = App.Store;

  // 前 23 欄與 iOS app 相容；後 4 欄為加密分項（附加於尾端，舊版匯入時忽略）
  const SNAP_HEADER = [
    'Date', 'MarketValue', 'CashBalance', 'NetAsset', 'UnrealizedPnl', 'RealizedPnl',
    'TotalPnl', 'DayPnl', 'TwMarketValue', 'UsMarketValueTwd', 'TotalMarketValueTwd',
    'TwCostBasis', 'UsCostBasisTwd', 'TotalCostBasisTwd', 'TwUnrealizedPnl',
    'UsUnrealizedPnlTwd', 'TwRealizedPnl', 'UsRealizedPnlTwd', 'TwTotalPnl',
    'UsTotalPnlTwd', 'TwReturnPct', 'UsReturnPct', 'TotalReturnPct',
    'CryptoMarketValueTwd', 'CryptoCostBasisTwd', 'CryptoUnrealizedPnlTwd', 'CryptoRealizedPnlTwd',
    'CashAccountsTwd', 'LiabilitiesTwd', 'NetWorth'
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
        s.usTotalPnlTwd, s.twReturnPct, s.usReturnPct, s.totalReturnPct,
        s.cryptoMarketValueTwd || 0, s.cryptoCostBasisTwd || 0,
        s.cryptoUnrealizedPnlTwd || 0, s.cryptoRealizedPnlTwd || 0,
        s.cashAccountsTwd || 0, s.liabilitiesTwd || 0,
        s.netWorth != null ? s.netWorth : (s.netAsset || 0)
      ].join(','));
    }

    // ── 現金帳戶 / 負債（名稱中的逗號改為全形，維持簡單分割）──
    const nm = v => String(v == null ? '' : v).replace(/,/g, '，');
    lines.push('');
    lines.push('# ACCOUNTS');
    lines.push('Kind,Name,Currency,Balance');
    for (const a of S.getCashAccounts()) lines.push(['cash', nm(a.name), a.currency || 'TWD', a.balance || 0].join(','));
    for (const a of S.getLiabilities()) lines.push(['liability', nm(a.name), a.currency || 'TWD', a.balance || 0].join(','));

    // ── 投資群組（每行：群組名, 成員代碼；空成員行代表空群組）──
    lines.push('');
    lines.push('# GROUPS');
    lines.push('GroupName,Symbol');
    const gmapX = S.getGroupMap();
    for (const g of S.getGroups()) {
      const members = Object.keys(gmapX).filter(sym => gmapX[sym] === g.id);
      if (!members.length) lines.push([nm(g.name), ''].join(','));
      for (const sym of members) lines.push([nm(g.name), sym].join(','));
    }

    // ── 股利記錄（accountId 不匯出：入帳金額已反映在帳戶餘額；去重靠 Symbol+ExDate）──
    lines.push('');
    lines.push('# DIVIDENDS');
    lines.push('Symbol,Market,Amount,Date,ExDate,Note');
    for (const d of S.getDividends())
      lines.push([d.symbol, d.market || '', d.amount, d.date || '', d.exDate || '', nm(d.note || '')].join(','));

    // ── 定期定額 / 定期繳款（帳戶與負債以「名稱」連結，匯入時 id 會重生）──
    const cashName = {}; for (const a of S.getCashAccounts()) cashName[a.id] = a.name;
    const liabName = {}; for (const l of S.getLiabilities()) liabName[l.id] = l.name;
    lines.push('');
    lines.push('# RECURRING');
    lines.push('Kind,Symbol,Market,Name,Amount,Freq,Day,StartDate,EndDate,Enabled,PriceBasis,FeeMode,FeeVal,LastRun,AccountName,LiabilityName');
    for (const p of S.getRecurringPlans())
      lines.push([
        p.kind || 'dca', p.symbol || '', p.market || '', nm(p.name || ''), p.amount || 0,
        p.freq || 'monthly', p.day != null ? p.day : '', p.startDate || '', p.endDate || '',
        p.enabled === false ? 0 : 1, p.priceBasis || '', p.feeMode || '', p.feeVal != null ? p.feeVal : '',
        p.lastRun || '', nm(cashName[p.accountId] || ''), nm(liabName[p.liabilityId] || ''),
      ].join(','));

    // ── 期貨交易（設定放 # SETTINGS；cash 已反映在帳戶餘額，匯入時不重套）──
    const fst = App.Futures ? App.Futures.getState() : null;
    lines.push('');
    lines.push('# FUTURES');
    lines.push('Contract,Month,Side,Lots,Price,Fee,Tax,Time,RollId,Cash');
    if (fst) for (const t of fst.trades) lines.push([t.contract, t.month, t.side, t.lots, t.price, t.fee || 0, t.tax || 0, Math.round(t.time), t.rollId || '', t.cash != null ? t.cash : ''].join(','));

    // ── 標的名稱/市場（讓匯入後顯示名稱不退化成代碼）──
    lines.push('');
    lines.push('# META');
    lines.push('Symbol,Name,Market');
    for (const m of Object.values(S.metaMap())) lines.push([m.code, nm(m.name || m.code), m.market || ''].join(','));

    // ── 設定（不含 API 金鑰與 App 鎖：金鑰屬憑證、鎖綁裝置，還原後自行重設）──
    lines.push('');
    lines.push('# SETTINGS');
    lines.push('Key,Value');
    const settingRows = [
      ['dayMode', S.getDayMode()],
      ['pctBasis', S.getPctBasis()],
      ['privacy', S.getPrivacy() ? 1 : 0],
      ['autoDiv', S.getAutoDivImport() ? 1 : 0],
      ['autoDivAcctName', nm(cashName[S.getAutoDivAcct()] || '')],
      ['autoDivUs', S.getAutoDivUs() ? 1 : 0],
      ['autoDivAcctUsName', nm(cashName[S.getAutoDivAcctUs()] || '')],
      ['autoDivUsTax', S.getAutoDivUsTax()],
      ['proxy', S.getProxy() || ''],
      ...(fst ? [
        ['futAccountName', nm(cashName[fst.accountId] || '')],
        ['futMargin_TX', fst.margin.TX.init + '/' + fst.margin.TX.maint],
        ['futMargin_MTX', fst.margin.MTX.init + '/' + fst.margin.MTX.maint],
        ['futMargin_TMF', fst.margin.TMF.init + '/' + fst.margin.TMF.maint],
        ['futMarginDate', fst.marginDate || ''], ['futMarginAuto', fst.marginAuto ? 1 : 0],
        ['futFee_TX', fst.feePerLot.TX], ['futFee_MTX', fst.feePerLot.MTX], ['futFee_TMF', fst.feePerLot.TMF],
        ['futAlertExpiry', fst.alerts.expiry ? 1 : 0], ['futAlertRisk', fst.alerts.risk ? 1 : 0],
      ] : []),
    ];
    for (const r of settingRows) lines.push(r.join(','));

    return lines.join('\n');
  }

  // 回傳 {ok, txCount, snapCount, msg}
  function importCsv(content) {
    const txLines = [], snapLines = [], acctLines = [], groupLines = [];
    const divLines = [], recLines = [], metaLines = [], setLines = [], futLines = [];
    let section = 'transactions';
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (line === '# TRANSACTIONS') { section = 'transactions'; continue; }
      if (line === '# SNAPSHOTS') { section = 'snapshots'; continue; }
      if (line === '# ACCOUNTS') { section = 'accounts'; continue; }
      if (line === '# GROUPS') { section = 'groups'; continue; }
      if (line === '# DIVIDENDS') { section = 'dividends'; continue; }
      if (line === '# RECURRING') { section = 'recurring'; continue; }
      if (line === '# META') { section = 'meta'; continue; }
      if (line === '# SETTINGS') { section = 'settings'; continue; }
      if (line === '# FUTURES') { section = 'futures'; continue; }
      if (!line) continue;
      if (section === 'transactions') txLines.push(line);
      else if (section === 'snapshots') snapLines.push(line);
      else if (section === 'accounts') acctLines.push(line);
      else if (section === 'dividends') divLines.push(line);
      else if (section === 'recurring') recLines.push(line);
      else if (section === 'meta') metaLines.push(line);
      else if (section === 'settings') setLines.push(line);
      else if (section === 'futures') futLines.push(line);
      else groupLines.push(line);
    }
    // 任一已知分段有內容即可匯入（純現金/股利備份也成立）；全空才拒絕
    const anySection = txLines.length || snapLines.length || acctLines.length || groupLines.length
      || divLines.length || recLines.length || metaLines.length || setLines.length || futLines.length;
    if (!anySection) return { ok: false, msg: 'CSV 沒有可匯入資料' };

    // 解析交易
    const h = (txLines[0] || '').toLowerCase();
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
        if (!sym || (type !== 'BUY' && type !== 'SELL' && type !== 'STOCK_DIV')) continue;
        parsed.push({ sym, market, type, shares, price, fee, time });
      } else {
        if (p.length < 6) continue;
        const sym = U.sanitizeSymbol(p[0]);
        const type = p[1].trim().toUpperCase();
        const shares = parseFloat(p[2]), price = parseFloat(p[3]);
        if (isNaN(shares) || isNaN(price)) continue;
        const fee = parseFloat(p[4]) || 0;
        const time = parseInt(p[5], 10) || Date.now();
        if (!sym || (type !== 'BUY' && type !== 'SELL' && type !== 'STOCK_DIV')) continue;
        parsed.push({ sym, market: null, type, shares, price, fee, time });
      }
    }
    // 交易可為空（如純現金備份）；但若整份檔案只有交易分段且解析不出任何列 → 視為無效檔
    if (!parsed.length && !(snapLines.length || acctLines.length || groupLines.length
      || divLines.length || recLines.length || metaLines.length || setLines.length || futLines.length))
      return { ok: false, msg: 'CSV 沒有可匯入資料' };

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
          // 加密分項（舊版 CSV 無此欄 → 0）
          cryptoMarketValueTwd: n(23), cryptoCostBasisTwd: n(24),
          cryptoUnrealizedPnlTwd: n(25), cryptoRealizedPnlTwd: n(26),
          cryptoTotalPnlTwd: n(25) + n(26),
          // 現金/負債/淨資產（舊版無此欄 → 淨資產以 netAsset 回填）
          cashAccountsTwd: n(27), liabilitiesTwd: n(28),
          netWorth: p.length > 29 && p[29] !== '' ? n(29) : undefined,
          createdAt: Date.now(),
        });
      }
    }

    // 清除現有 → 寫入（meta upsert + 重算已實現）
    S.setTransactions([]); S.setRealized([]); S.setSnapshots([]);

    const sortedTx = [...parsed].sort((a, b) => a.time - b.time);
    const metaUpserts = [];
    const mmap = S.metaMap();
    const mkOrGuess = (raw, sym) => { const mk = U.normalizeMarketKey(raw || ''); return mk === U.Market.unknown ? U.guessMarketBySymbol(sym) : mk; };
    for (const t of sortedTx) {
      const mk = mkOrGuess(t.market, t.sym); // unknown / 不認得的市場字串 → 依代碼猜，不要原樣存成 unknown
      const name = mmap[t.sym]?.name || t.sym;
      metaUpserts.push({ code: t.sym, name, market: mk });
    }
    S.upsertMeta(metaUpserts);

    const txOut = [], rzOut = [];
    const sharesMap = {}, costMap = {};
    for (const t of sortedTx) {
      const sym = t.sym;
      const sh = sharesMap[sym] || 0, cost = costMap[sym] || 0;
      if (t.type !== 'SELL') {                 // BUY 與 STOCK_DIV(配股,零成本)皆累加
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

    // ── 現金帳戶 / 負債（區段存在才覆蓋）──
    if (acctLines.length) {
      const start = acctLines[0].toLowerCase().includes('kind') ? 1 : 0;
      const cash = [], liab = [];
      for (let i = start; i < acctLines.length; i++) {
        const p = acctLines[i].split(',');
        if (p.length < 4) continue;
        const rec = { id: S.uuid(), name: (p[1] || '').trim(), currency: (p[2] || 'TWD').trim().toUpperCase() === 'USD' ? 'USD' : 'TWD', balance: parseFloat(p[3]) || 0 };
        if (!rec.name) continue;
        if ((p[0] || '').trim().toLowerCase() === 'liability') liab.push(rec); else cash.push(rec);
      }
      S.setCashAccounts(cash); S.setLiabilities(liab);
    }

    // ── 投資群組 ──
    if (groupLines.length) {
      const start = groupLines[0].toLowerCase().includes('groupname') ? 1 : 0;
      const gs = []; const byName = {}; const gm = {};
      for (let i = start; i < groupLines.length; i++) {
        const p = groupLines[i].split(',');
        const name = (p[0] || '').trim(); if (!name) continue;
        if (!byName[name]) { byName[name] = { id: S.uuid(), name }; gs.push(byName[name]); }
        const sym = (p[1] || '').trim(); if (sym) gm[sym] = byName[name].id;
      }
      S.setGroups(gs); S.setGroupMap(gm);
    }

    // 名稱→id（帳戶/負債匯入後 id 重生，備份內一律以名稱連結；名稱經全形逗號正規化後比對）
    const nmKey = v => String(v == null ? '' : v).replace(/,/g, '，').trim();
    const cashIdByName = {}; for (const a of S.getCashAccounts()) cashIdByName[nmKey(a.name)] = a.id;
    const liabIdByName = {}; for (const l of S.getLiabilities()) liabIdByName[nmKey(l.name)] = l.id;

    // ── 股利記錄（區段存在才覆蓋；不動帳戶餘額——入帳結果已在 ACCOUNTS 餘額內）──
    let divCount = 0;
    if (divLines.length) {
      const start = divLines[0].toLowerCase().includes('symbol') ? 1 : 0;
      const divs = [];
      for (let i = start; i < divLines.length; i++) {
        const p = divLines[i].split(',');
        if (p.length < 4) continue;
        const symbol = U.sanitizeSymbol(p[0]);
        const amount = parseFloat(p[2]);
        if (!symbol || !(amount > 0)) continue;
        const rec = { id: S.uuid(), symbol, market: U.normalizeMarketKey((p[1] || '').trim() || U.guessMarketBySymbol(symbol)), amount, date: (p[3] || '').trim(), createdAt: Date.now() };
        if ((p[4] || '').trim()) rec.exDate = p[4].trim();
        if ((p[5] || '').trim()) rec.note = p[5].trim();
        divs.push(rec);
      }
      S.setDividends(divs);
      divCount = divs.length;
    }

    // ── 定期定額 / 定期繳款（區段存在才覆蓋）──
    let planCount = 0;
    if (recLines.length) {
      const start = recLines[0].toLowerCase().includes('kind') ? 1 : 0;
      const plans = [];
      for (let i = start; i < recLines.length; i++) {
        const p = recLines[i].split(',');
        if (p.length < 14) continue;
        const kind = (p[0] || 'dca').trim().toLowerCase() === 'liability' ? 'liability' : 'dca';
        const amount = parseFloat(p[4]);
        if (!(amount > 0)) continue;
        const plan = {
          id: S.uuid(), kind, amount,
          freq: ['weekly', 'biweekly'].includes((p[5] || '').trim()) ? (p[5] || '').trim() : 'monthly',
          day: isNaN(parseInt(p[6], 10)) ? null : parseInt(p[6], 10), // 0 = 星期日，不能用 `|| 1`；空白 → 由開始日推算
          startDate: (p[7] || '').trim() || null,
          endDate: (p[8] || '').trim() || null,
          enabled: (p[9] || '1').trim() !== '0',
          lastRun: (p[13] || '').trim() || null,
          accountId: cashIdByName[nmKey(p[14])] || null,
          createdAt: Date.now(),
        };
        if (kind === 'dca') {
          plan.symbol = U.sanitizeSymbol(p[1]);
          if (!plan.symbol) continue;
          plan.market = U.normalizeMarketKey((p[2] || '').trim() || U.guessMarketBySymbol(plan.symbol));
          plan.name = (p[3] || '').trim() || plan.symbol;
          plan.priceBasis = (p[10] || 'close').trim() || 'close';
          plan.feeMode = (p[11] || 'none').trim() || 'none';
          plan.feeVal = parseFloat(p[12]) || 0;
        } else {
          plan.liabilityId = liabIdByName[nmKey(p[15])] || null;
          if (!plan.liabilityId) continue; // 找不到同名負債 → 略過(避免無效計畫)
        }
        plans.push(plan);
      }
      S.setRecurringPlans(plans);
      planCount = plans.length;
    }

    // ── 期貨交易（區段存在才覆蓋；cash 已反映在 ACCOUNTS 餘額，不再套用）──
    let futCount = 0;
    if (futLines.length && App.Futures) {
      const start = futLines[0].toLowerCase().includes('contract') ? 1 : 0;
      const trades = [];
      for (let i = start; i < futLines.length; i++) {
        const p = futLines[i].split(',');
        if (p.length < 8) continue;
        const contract = (p[0] || '').trim().toUpperCase(), month = (p[1] || '').trim();
        const lots = parseFloat(p[3]), price = parseFloat(p[4]);
        if (!App.Futures.MULT[contract] || !/^\d{6}$/.test(month) || !(lots > 0) || !(price > 0)) continue;
        const t = { id: S.uuid(), contract, month, side: (p[2] || '').trim().toUpperCase() === 'SELL' ? 'SELL' : 'BUY', lots, price,
          fee: parseFloat(p[5]) || 0, tax: parseFloat(p[6]) || 0, time: parseInt(p[7], 10) || Date.now() };
        if ((p[8] || '').trim()) t.rollId = p[8].trim();
        if ((p[9] || '').trim() !== '') t.cash = parseFloat(p[9]) || 0;
        trades.push(t);
      }
      App.Futures.patchState({ trades });
      futCount = trades.length;
    }

    // ── 標的名稱/市場（補回顯示名稱；晚於交易匯入,名稱以 META 為準）──
    if (metaLines.length) {
      const start = metaLines[0].toLowerCase().includes('symbol') ? 1 : 0;
      const ups = [];
      for (let i = start; i < metaLines.length; i++) {
        const p = metaLines[i].split(',');
        const code = U.sanitizeSymbol(p[0]); if (!code) continue;
        ups.push({ code, name: (p[1] || '').trim() || code, market: mkOrGuess((p[2] || '').trim(), code) });
      }
      if (ups.length) S.upsertMeta(ups);
    }

    // ── 設定（值以「第一個逗號」後全取,proxy URL 內含逗號也安全）──
    if (setLines.length) {
      for (const line of setLines) {
        const idx = line.indexOf(',');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key.toLowerCase() === 'key') continue; // header
        switch (key) {
          case 'dayMode': S.setDayMode(val); break;
          case 'pctBasis': S.setPctBasis(val); break;
          case 'privacy': S.setPrivacy(val === '1'); break;
          case 'autoDiv': S.setAutoDivImport(val === '1'); break;
          case 'autoDivUs': S.setAutoDivUs(val === '1'); break;
          case 'autoDivUsTax': { const n = parseFloat(val); if (!isNaN(n)) S.setAutoDivUsTax(n); break; }
          case 'autoDivAcctName': S.setAutoDivAcct(cashIdByName[nmKey(val)] || null); break;
          case 'autoDivAcctUsName': S.setAutoDivAcctUs(cashIdByName[nmKey(val)] || null); break;
          case 'proxy': S.setProxy(val); break;
          // 期貨設定
          case 'futAccountName': if (App.Futures) App.Futures.patchState({ accountId: cashIdByName[nmKey(val)] || null }); break;
          case 'futMargin_TX': case 'futMargin_MTX': case 'futMargin_TMF': {
            const c = key.slice(10); const [i, m] = val.split('/').map(Number);
            if (App.Futures && i > 0 && m > 0) { const st = App.Futures.getState(); st.margin[c] = { init: i, maint: m }; App.Futures.saveState(st); }
            break;
          }
          case 'futMarginDate': if (App.Futures) App.Futures.patchState({ marginDate: val || null }); break;
          case 'futMarginAuto': if (App.Futures) App.Futures.patchState({ marginAuto: val === '1' }); break;
          case 'futFee_TX': case 'futFee_MTX': case 'futFee_TMF': {
            const c = key.slice(7); const n = parseFloat(val);
            if (App.Futures && !isNaN(n)) { const st = App.Futures.getState(); st.feePerLot[c] = n; App.Futures.saveState(st); }
            break;
          }
          case 'futAlertExpiry': case 'futAlertRisk': {
            if (App.Futures) { const st = App.Futures.getState(); st.alerts[key === 'futAlertExpiry' ? 'expiry' : 'risk'] = val === '1'; App.Futures.saveState(st); }
            break;
          }
        }
      }
    }

    // 手續費防呆（SPEC I7）：異常手續費會毒掉成本與報表，回報給呼叫端警告
    const feeWarnSymbols = [...new Set(App.Calc.findAbsurdFees(txOut).map(b => b.symbol))];

    return { ok: true, txCount: txOut.length, snapCount: snaps.length, divCount, planCount, futCount, feeWarnSymbols };
  }

  return { exportCsv, importCsv };
})();
