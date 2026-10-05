/* =========================================================================
 * charts.js — 輕量 SVG 圖表（走勢面積圖 + 長條圖），無外部相依
 * ======================================================================= */
window.App = window.App || {};

App.Charts = (function () {
  const NS = 'http://www.w3.org/2000/svg';

  // 漂亮刻度（含 0）
  function niceTicks(min, max, count) {
    count = count || 4;
    if (min === max) { min -= 1; max += 1; }
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    const span = max - min;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  // 走勢圖用動態刻度：不強制含 0（波動才看得出來），步距取 1/2/2.5/5 × 10ⁿ；
  // 資料最低點離 0 不遠（< 範圍的一半）時仍從 0 起，免得一點點起伏被誇大成斷崖
  function niceRange(min, max, count) {
    count = count || 4;
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min > max) { const t = min; min = max; max = t; }
    if (min === max) { const pad = Math.abs(min) * 0.05 || 1; min -= pad; max += pad; }
    if (min > 0 && min <= (max - min) * 0.5) min = 0;
    if (max < 0 && -max <= (max - min) * 0.5) max = 0;
    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step * 0.5; v += step) ticks.push(Math.round(v / step) * step);
    return ticks.map(v => Math.round(v * 1e6) / 1e6);
  }
  // 刻度標籤：同一軸統一單位（億/萬/元），小數位數依步距決定 → 不會四捨五入成重複
  function axisLabels(ticks) {
    const maxAbs = Math.max(...ticks.map(Math.abs));
    const unit = maxAbs >= 1e8 ? 1e8 : maxAbs >= 1e4 ? 1e4 : 1, suf = unit === 1e8 ? '億' : unit === 1e4 ? '萬' : '';
    const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) / unit : 1;
    let d = 0; while (d < 4 && Math.abs(Math.round(step * Math.pow(10, d)) - step * Math.pow(10, d)) > 1e-6) d++;
    return ticks.map(v => {
      const x = v / unit;
      if (v === 0) return '0';
      if (unit === 1) return Math.round(x).toLocaleString('en-US');
      return (+x.toFixed(d)).toString() + suf;
    });
  }

  function fmtAxis(v) {
    const av = Math.abs(v);
    if (av >= 1e8) return (v / 1e8).toFixed(1) + '億';
    if (av >= 1e4) return Math.round(v / 1e4) + '萬';
    return String(Math.round(v));
  }

  // 圖表互動：拖曳掃描即時顯示 tooltip；單擊「釘選」（放開手指仍保留），再次單擊即消失
  function attachInteractive(container, svgEl, cursor, tip, handle) {
    let pinned = false, downX = 0, moved = false;
    const hide = () => { cursor.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; };
    svgEl.addEventListener('pointerdown', e => { downX = e.clientX; moved = false; handle(e.clientX); });
    svgEl.addEventListener('pointermove', e => { if (e.buttons) { if (Math.abs(e.clientX - downX) > 6) moved = true; handle(e.clientX); } });
    svgEl.addEventListener('pointerup', () => { if (!moved) { pinned = !pinned; if (!pinned) hide(); } });
    container.addEventListener('pointerleave', () => { if (!pinned) hide(); });
  }

  /* ---- 台股/美股 堆疊區域折線圖（對齊 iOS TwUsFillChart）----
   * 台股(橙)在下、美股(藍)疊上，台股+美股 = 總資產（藍線頂端）
   * points: [{date:Date, values:{tw, us}}]
   * opts: {twKey,usKey,twLabel,usLabel, xLabels:[{idx,label}], valueFmt, height}
   */
  const TW_LINE = '#E8823C', TW_FILL = 'rgba(232,130,60,0.22)';
  const US_LINE = '#4A82C8', US_FILL = 'rgba(74,130,200,0.18)';
  const CR_LINE = '#9B59D0', CR_FILL = 'rgba(155,89,208,0.20)';

  function trend(container, points, opts) {
    container.innerHTML = '';
    if (!points || !points.length) {
      container.innerHTML = '<div class="chart-empty">暫無歷史資料</div>';
      return;
    }
    opts = opts || {};
    const twKey = opts.twKey || 'tw', usKey = opts.usKey || 'us', crKey = opts.cryptoKey || null;
    const twLabel = opts.twLabel || '台股', usLabel = opts.usLabel || '美股', crLabel = opts.cryptoLabel || '加密';
    const valueFmt = opts.valueFmt || (v => App.Util.fmtKMBB(v));
    const H = opts.height || 200;
    const W = container.clientWidth || 340;
    const padL = 46, padR = 10, padT = 10, padB = 22;
    const chartW = W - padL - padR, chartH = H - padT - padB;

    const extras = opts.extraLines || []; // [{key,label,color,dash}] 疊加線（不堆疊）
    const rows = points.map(p => {
      const tw = p.values[twKey] || 0, us = p.values[usKey] || 0;
      const cr = crKey ? (p.values[crKey] || 0) : 0;
      const ex = extras.map(e => p.values[e.key] || 0);
      return { date: p.date, tw, us, cr, ex, total: tw + us + cr };
    });
    const hasCr = rows.some(r => r.cr > 0.5); // 有加密部位才畫第三層
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) { lo = Math.min(lo, r.tw, r.total); hi = Math.max(hi, r.total, r.tw); for (const v of r.ex) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    const ticks = niceRange(lo, hi, 4), labels = axisLabels(ticks);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1);
    const n = rows.length;
    const xAt = i => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;
    const y0 = yAt(Math.max(yLo, Math.min(0, yHi))); // 面積底：0 在軸內用 0，否則用軸底

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg">`;
    ticks.forEach((t, ti) => {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${labels[ti]}</text>`;
    });
    const twPts = rows.map((r, i) => [xAt(i), yAt(r.tw)]);
    const usTopPts = rows.map((r, i) => [xAt(i), yAt(r.tw + r.us)]); // 台股+美股 頂
    const totPts = rows.map((r, i) => [xAt(i), yAt(r.total)]);
    const fwd = pts => pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const bwd = pts => pts.slice().reverse().map(p => 'L' + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

    if (n > 0) {
      // 加密 band（台股+美股 → 總資產）紫色填充
      if (hasCr) svg += `<path d="${fwd(totPts)} ${bwd(usTopPts)} Z" fill="${CR_FILL}"/>`;
      // 美股 band（台股 → 台股+美股）藍色填充
      svg += `<path d="${fwd(usTopPts)} ${bwd(twPts)} Z" fill="${US_FILL}"/>`;
      // 台股 band（0→台股）橙色填充
      svg += `<path d="${fwd(twPts)} L${twPts[n - 1][0].toFixed(1)},${y0} L${twPts[0][0].toFixed(1)},${y0} Z" fill="${TW_FILL}"/>`;
      // 線：總資產（有加密=紫、否則藍）、美股頂（有加密時另畫藍線）、台股橙
      svg += `<path d="${fwd(totPts)}" fill="none" stroke="${hasCr ? CR_LINE : US_LINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
      if (hasCr) svg += `<path d="${fwd(usTopPts)}" fill="none" stroke="${US_LINE}" stroke-width="1.5" stroke-linejoin="round"/>`;
      svg += `<path d="${fwd(twPts)}" fill="none" stroke="${TW_LINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
      // 疊加線（例：淨資產）
      extras.forEach((e, ei) => {
        const pts = rows.map((r, i) => [xAt(i), yAt(r.ex[ei])]);
        svg += `<path d="${fwd(pts)}" fill="none" stroke="${e.color}" stroke-width="1.8" ${e.dash ? 'stroke-dasharray="5 3"' : ''} stroke-linejoin="round"/>`;
      });
    }
    if (opts.xLabels) for (const e of opts.xLabels)
      svg += `<text x="${xAt(e.idx)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#78716c">${e.label}</text>`;

    svg += `<line class="cursor-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg += `</svg>`;

    const legend = `<div class="chart-legend">
      <span class="lg"><i style="background:${TW_LINE}"></i>${twLabel}</span>
      <span class="lg"><i style="background:${US_LINE}"></i>${usLabel}</span>
      ${hasCr ? `<span class="lg"><i style="background:${CR_LINE}"></i>${crLabel}</span>` : ''}
      <span class="lg"><i style="background:${hasCr ? CR_LINE : US_LINE};opacity:.5"></i>總資產</span>
      ${extras.map(e => `<span class="lg"><i style="background:${e.color}"></i>${e.label}</span>`).join('')}
    </div>`;
    container.innerHTML = legend + svg;

    const svgEl = container.querySelector('svg');
    const cursor = container.querySelector('.cursor-line');
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.style.display = 'none';
    container.appendChild(tip);
    function handle(clientX) {
      const rect = svgEl.getBoundingClientRect();
      const sx = (clientX - rect.left) / rect.width * W;
      let idx = Math.round((sx - padL) / (chartW || 1) * (n - 1));
      idx = Math.max(0, Math.min(n - 1, idx));
      const r = rows[idx];
      cursor.setAttribute('x1', xAt(idx)); cursor.setAttribute('x2', xAt(idx));
      cursor.setAttribute('visibility', 'visible');
      tip.innerHTML = `<div class="tip-date">${App.Util.isoDate(r.date)}</div>
        <div><i style="background:${TW_LINE}"></i>${twLabel} <b>${valueFmt(r.tw)}</b></div>
        <div><i style="background:${US_LINE}"></i>${usLabel} <b>${valueFmt(r.us)}</b></div>
        ${hasCr ? `<div><i style="background:${CR_LINE}"></i>${crLabel} <b>${valueFmt(r.cr)}</b></div>` : ''}
        <div><i style="background:${hasCr ? CR_LINE : US_LINE};opacity:.5"></i>總資產 <b>${valueFmt(r.total)}</b></div>
        ${extras.map((e, ei) => `<div><i style="background:${e.color}"></i>${e.label} <b>${valueFmt(r.ex[ei])}</b></div>`).join('')}`;
      tip.style.display = 'block';
      const tipW = tip.offsetWidth || 132;
      const cxPx = xAt(idx) / W * rect.width;
      const left = Math.min(Math.max(cxPx - tipW / 2, 4), Math.max(4, rect.width - tipW - 4));
      tip.style.left = left + 'px'; tip.style.top = '4px';
    }
    attachInteractive(container, svgEl, cursor, tip, handle);
  }

  /* ---- 長條圖（報表用）----
   * items: [{label, value}]
   * opts: {height, colorFn(value)->color, valueFmt, taiwanColor}
   */
  function bars(container, items, opts) {
    container.innerHTML = '';
    if (!items || !items.length) { container.innerHTML = '<div class="chart-empty">暫無資料</div>'; return; }
    opts = opts || {};
    const H = opts.height || 200;
    const W = container.clientWidth || 340;
    const padL = 44, padR = 10, padT = 10, padB = 24;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    const valueFmt = opts.valueFmt || (v => App.Util.fmtKMBB(v));

    let lo = 0, hi = 0;
    for (const it of items) { lo = Math.min(lo, it.value); hi = Math.max(hi, it.value); }
    const ticks = niceTicks(lo, hi, 4);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;
    const bw = Math.min(28, chartW / items.length * 0.6);
    const step = chartW / items.length;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
    for (const t of ticks) {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${fmtAxis(t)}</text>`;
    }
    const y0 = yAt(0);
    items.forEach((it, i) => {
      const cx = padL + step * (i + 0.5);
      const y = yAt(it.value);
      const top = Math.min(y, y0), h = Math.abs(y - y0);
      const color = opts.colorFn ? opts.colorFn(it.value) : '#4A82C8';
      svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" rx="2" fill="${color}" opacity="0.78"><title>${it.label}: ${valueFmt(it.value)}</title></rect>`;
      svg += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#78716c">${it.label}</text>`;
    });
    svg += `</svg>`;
    container.innerHTML = svg;
  }

  /* ---- 報表欄位長條圖（對齊 iOS columnBarChart）----
   * items: [{label, netAsset, newInvestment, periodPnl, periodRealizedPnl, unrealizedPnl}]
   * col: 'netAsset' | 'newInvestment' | 'periodPnl' | 'realizedUnrealized'
   * 顏色：淨資產/本期投入=藍；本期損益=正綠負紅；已實現/未實現=台股慣例(正紅負綠)
   */
  const C_BLUE = '#4A82C8', C_GREEN = '#3DAA6A', C_RED = '#D95555';
  function reportColumn(container, items, col) {
    container.innerHTML = '';
    if (!items || !items.length) { container.innerHTML = '<div class="chart-empty">暫無資料</div>'; return; }
    const H = 200, W = container.clientWidth || 340;
    const padL = 46, padR = 10, padT = 10, padB = 24;
    const chartW = W - padL - padR, chartH = H - padT - padB;

    // 取值範圍
    let lo = 0, hi = 0;
    const vals = it => col === 'realizedUnrealized' ? [it.periodRealizedPnl, it.unrealizedPnl]
      : col === 'netAsset' ? [it.netAsset]
        : col === 'newInvestment' ? [it.newInvestment] : [it.periodPnl];
    for (const it of items) for (const v of vals(it)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const ticks = niceTicks(lo, hi, 4);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;
    const step = chartW / items.length;
    const bw = Math.min(26, step * 0.55);
    const y0 = yAt(0);

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg">`;
    for (const t of ticks) {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${fmtAxis(t)}</text>`;
    }
    function rect(cx, v, color, opacity) {
      const y = yAt(v), top = Math.min(y, y0), h = Math.max(Math.abs(y - y0), 0.5);
      return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}" opacity="${opacity}"/>`;
    }
    function dashRect(cx, v, color) {
      const y = yAt(v), top = Math.min(y, y0), h = Math.max(Math.abs(y - y0), 0.5);
      return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="none" stroke="${color}" stroke-width="1.3" stroke-dasharray="3 2"/>`;
    }
    items.forEach((it, i) => {
      const cx = padL + step * (i + 0.5);
      if (col === 'netAsset') svg += rect(cx, it.netAsset, C_BLUE, 0.72);
      else if (col === 'newInvestment') svg += rect(cx, it.newInvestment, C_BLUE, 0.72);
      else if (col === 'periodPnl') svg += rect(cx, it.periodPnl, it.periodPnl >= 0 ? C_GREEN : C_RED, 0.74);
      else {
        // 已實現(實心) + 未實現(虛線外框)，台股慣例
        svg += rect(cx, it.periodRealizedPnl, it.periodRealizedPnl >= 0 ? C_RED : C_GREEN, 0.7);
        svg += dashRect(cx, it.unrealizedPnl, it.unrealizedPnl >= 0 ? C_RED : C_GREEN);
      }
      svg += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#78716c">${it.label}</text>`;
    });
    svg += `<line class="cursor-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg += `</svg>`;
    container.innerHTML = svg;

    // 點擊顯示 tooltip
    const svgEl = container.querySelector('svg');
    const cursor = container.querySelector('.cursor-line');
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.style.display = 'none';
    container.appendChild(tip);
    const U = App.Util, UI = App.UI;
    function handle(clientX) {
      const rect2 = svgEl.getBoundingClientRect();
      const sx = (clientX - rect2.left) / rect2.width * W;
      let idx = Math.floor((sx - padL) / step);
      idx = Math.max(0, Math.min(items.length - 1, idx));
      const it = items[idx];
      const cx = padL + step * (idx + 0.5);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      let body;
      if (col === 'realizedUnrealized') body =
        `<div><i style="background:${it.unrealizedPnl >= 0 ? C_RED : C_GREEN}"></i>未實現 <b>${U.fmtBannerSigned(it.unrealizedPnl)}</b></div>
         <div><i style="background:${it.periodRealizedPnl >= 0 ? C_RED : C_GREEN}"></i>已實現 <b>${U.fmtBannerSigned(it.periodRealizedPnl)}</b></div>`;
      else {
        const v = col === 'netAsset' ? it.netAsset : col === 'newInvestment' ? it.newInvestment : it.periodPnl;
        const lbl = col === 'netAsset' ? '總倉位' : col === 'newInvestment' ? '本期投入' : '本期損益';
        const txt = col === 'netAsset' ? U.fmtBanner(v) : U.fmtBannerSigned(v);
        body = `<div><b>${txt}</b> ${lbl}</div>`;
      }
      tip.innerHTML = `<div class="tip-date">${it.label}</div>${body}`;
      tip.style.display = 'block';
      const tipW = tip.offsetWidth || 132;
      const cxPx = cx / W * rect2.width;
      const left = Math.min(Math.max(cxPx - tipW / 2, 4), Math.max(4, rect2.width - tipW - 4));
      tip.style.left = left + 'px'; tip.style.top = '4px';
    }
    attachInteractive(container, svgEl, cursor, tip, handle);
  }

  /* ---- 通用多序列折線圖（淨資產 / 流動資金 / 負債等）----
   * points: [{date, values:{...}}]
   * opts: {series: [{key,label,color,fill}], xLabels, valueFmt, height}
   */
  function lineChart(container, points, opts) {
    container.innerHTML = '';
    if (!points || !points.length) { container.innerHTML = '<div class="chart-empty">暫無歷史資料</div>'; return; }
    opts = opts || {};
    const series = opts.series || [];
    const valueFmt = opts.valueFmt || (v => App.Util.fmtKMBB(v));
    const H = opts.height || 200;
    const W = container.clientWidth || 340;
    const padL = 46, padR = 10, padT = 10, padB = 22;
    const chartW = W - padL - padR, chartH = H - padT - padB;

    const rows = points.map(p => ({ date: p.date, vals: series.map(s => p.values[s.key] || 0) }));
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) for (const v of r.vals) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const ticks = niceRange(lo, hi, 4), labels = axisLabels(ticks);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1e-9);
    const n = rows.length;
    const xAt = i => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;
    const y0 = yAt(Math.max(yLo, Math.min(0, yHi))); // 面積底：0 在軸內用 0，否則用軸底
    const fwd = pts => pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg">`;
    ticks.forEach((t, ti) => {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${labels[ti]}</text>`;
    });
    series.forEach((s, si) => {
      const pts = rows.map((r, i) => [xAt(i), yAt(r.vals[si])]);
      if (s.fill && n > 0) {
        svg += `<path d="${fwd(pts)} L${pts[n - 1][0].toFixed(1)},${y0} L${pts[0][0].toFixed(1)},${y0} Z" fill="${s.color}" opacity="0.14"/>`;
      }
      svg += `<path d="${fwd(pts)}" fill="none" stroke="${s.color}" stroke-width="1.8" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round"/>`;
    });
    if (opts.xLabels) for (const e of opts.xLabels)
      svg += `<text x="${xAt(e.idx)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#78716c">${e.label}</text>`;
    svg += `<line class="cursor-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg += `</svg>`;

    const legend = `<div class="chart-legend">${series.map(s => `<span class="lg"><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;
    container.innerHTML = legend + svg;

    const svgEl = container.querySelector('svg');
    const cursor = container.querySelector('.cursor-line');
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.style.display = 'none';
    container.appendChild(tip);
    function handle(clientX) {
      const rect = svgEl.getBoundingClientRect();
      const sx = (clientX - rect.left) / rect.width * W;
      let idx = Math.round((sx - padL) / (chartW || 1) * (n - 1));
      idx = Math.max(0, Math.min(n - 1, idx));
      const r = rows[idx];
      cursor.setAttribute('x1', xAt(idx)); cursor.setAttribute('x2', xAt(idx));
      cursor.setAttribute('visibility', 'visible');
      tip.innerHTML = `<div class="tip-date">${App.Util.isoDate(r.date)}</div>` +
        series.map((s, si) => `<div><i style="background:${s.color}"></i>${s.label} <b>${valueFmt(r.vals[si])}</b></div>`).join('');
      tip.style.display = 'block';
      const tipW = tip.offsetWidth || 132;
      const cxPx = xAt(idx) / W * rect.width;
      const left = Math.min(Math.max(cxPx - tipW / 2, 4), Math.max(4, rect.width - tipW - 4));
      tip.style.left = left + 'px'; tip.style.top = '4px';
    }
    attachInteractive(container, svgEl, cursor, tip, handle);
  }

  /* ---- 通用長條圖（淨資產 / 漲幅；支援負值基線、依值上色）----
   * items: [{label, fullLabel?, value}]
   * opts: {valueFmt, colorOf(value)->color, height}
   */
  function barChart(container, items, opts) {
    container.innerHTML = '';
    if (!items || !items.length) { container.innerHTML = '<div class="chart-empty">暫無資料</div>'; return; }
    opts = opts || {};
    const valueFmt = opts.valueFmt || (v => App.Util.fmtKMBB(v));
    const colorOf = opts.colorOf || (() => C_BLUE);
    const H = opts.height || 220, W = container.clientWidth || 340;
    const padL = 46, padR = 10, padT = 12, padB = 26;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    let lo = 0, hi = 0;
    for (const it of items) { lo = Math.min(lo, it.value); hi = Math.max(hi, it.value); }
    const ticks = niceTicks(lo, hi, 4);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;
    const step = chartW / items.length;
    const bw = Math.min(30, step * 0.6);
    const y0 = yAt(0);

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg">`;
    for (const t of ticks) {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${fmtAxis(t)}</text>`;
    }
    items.forEach((it, i) => {
      const cx = padL + step * (i + 0.5);
      const y = yAt(it.value), top = Math.min(y, y0), h = Math.max(Math.abs(y - y0), 0.5);
      svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${colorOf(it.value)}" opacity="0.82"/>`;
      svg += `<text x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="9" fill="#78716c">${it.label}</text>`;
    });
    svg += `<line class="cursor-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg += `</svg>`;
    container.innerHTML = svg;

    const svgEl = container.querySelector('svg');
    const cursor = container.querySelector('.cursor-line');
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.style.display = 'none';
    container.appendChild(tip);
    function handle(clientX) {
      const rect2 = svgEl.getBoundingClientRect();
      const sx = (clientX - rect2.left) / rect2.width * W;
      let idx = Math.floor((sx - padL) / step);
      idx = Math.max(0, Math.min(items.length - 1, idx));
      const it = items[idx];
      const cx = padL + step * (idx + 0.5);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      tip.innerHTML = `<div class="tip-date">${it.fullLabel || it.label}</div><div><b style="color:${colorOf(it.value)}">${valueFmt(it.value)}</b></div>`;
      tip.style.display = 'block';
      const tipW = tip.offsetWidth || 132;
      const cxPx = cx / W * rect2.width;
      const left = Math.min(Math.max(cxPx - tipW / 2, 4), Math.max(4, rect2.width - tipW - 4));
      tip.style.left = left + 'px'; tip.style.top = '4px';
    }
    attachInteractive(container, svgEl, cursor, tip, handle);
  }

  /* ---- 雙序列疊長條（投入 寬/後 + 損益 窄/前，對齊參考「帳戶改變＋持倉盈虧」）----
   * items: [{label, fullLabel?, a, b}]；opts: {colorA,colorB,labelA,labelB,valueFmt,height}
   */
  function dualBars(container, items, opts) {
    container.innerHTML = '';
    if (!items || !items.length) { container.innerHTML = '<div class="chart-empty">暫無資料</div>'; return; }
    opts = opts || {};
    const valueFmt = opts.valueFmt || (v => App.Util.fmtKMBB(v));
    const cA = opts.colorA || '#4B3F9E', cB = opts.colorB || '#8B7FE0';
    const labelA = opts.labelA || 'A', labelB = opts.labelB || 'B';
    const H = opts.height || 220, W = container.clientWidth || 340;
    const padL = 46, padR = 10, padT = 12, padB = 26;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    let lo = 0, hi = 0;
    for (const it of items) { lo = Math.min(lo, it.a, it.b); hi = Math.max(hi, it.a, it.b); }
    const ticks = niceTicks(lo, hi, 4);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;
    const step = chartW / items.length;
    const wideW = Math.min(30, step * 0.62), narrowW = Math.min(15, step * 0.30);
    const y0 = yAt(0);

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg">`;
    for (const t of ticks) {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${fmtAxis(t)}</text>`;
    }
    const rect = (cx, v, w, color, op) => {
      const y = yAt(v), top = Math.min(y, y0), h = Math.max(Math.abs(y - y0), 0.5);
      return `<rect x="${(cx - w / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}" opacity="${op}"/>`;
    };
    items.forEach((it, i) => {
      const cx = padL + step * (i + 0.5);
      svg += rect(cx, it.a, wideW, cA, 0.9);    // 投入：寬、後
      svg += rect(cx, it.b, narrowW, cB, 0.95); // 損益：窄、前
      svg += `<text x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="9" fill="#78716c">${it.label}</text>`;
    });
    svg += `<line class="cursor-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg += `</svg>`;
    const legend = `<div class="chart-legend"><span class="lg"><i style="background:${cA}"></i>${labelA}</span><span class="lg"><i style="background:${cB}"></i>${labelB}</span></div>`;
    container.innerHTML = legend + svg;

    const svgEl = container.querySelector('svg');
    const cursor = container.querySelector('.cursor-line');
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.style.display = 'none';
    container.appendChild(tip);
    function handle(clientX) {
      const rect2 = svgEl.getBoundingClientRect();
      const sx = (clientX - rect2.left) / rect2.width * W;
      let idx = Math.floor((sx - padL) / step);
      idx = Math.max(0, Math.min(items.length - 1, idx));
      const it = items[idx];
      const cx = padL + step * (idx + 0.5);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      tip.innerHTML = `<div class="tip-date">${it.fullLabel || it.label}</div>
        <div><i style="background:${cA}"></i>${labelA} <b>${valueFmt(it.a)}</b></div>
        <div><i style="background:${cB}"></i>${labelB} <b>${valueFmt(it.b)}</b></div>`;
      tip.style.display = 'block';
      const tipW = tip.offsetWidth || 132;
      const cxPx = cx / W * rect2.width;
      const left = Math.min(Math.max(cxPx - tipW / 2, 4), Math.max(4, rect2.width - tipW - 4));
      tip.style.left = left + 'px'; tip.style.top = '4px';
    }
    attachInteractive(container, svgEl, cursor, tip, handle);
  }

  return { trend, bars, reportColumn, lineChart, barChart, dualBars, niceTicks, niceRange, axisLabels };
})();
