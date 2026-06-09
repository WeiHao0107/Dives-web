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

  function fmtAxis(v) {
    const av = Math.abs(v);
    if (av >= 1e8) return (v / 1e8).toFixed(1) + '億';
    if (av >= 1e4) return Math.round(v / 1e4) + '萬';
    return String(Math.round(v));
  }

  /* ---- 台股/美股 堆疊區域折線圖（對齊 iOS TwUsFillChart）----
   * 台股(橙)在下、美股(藍)疊上，台股+美股 = 總資產（藍線頂端）
   * points: [{date:Date, values:{tw, us}}]
   * opts: {twKey,usKey,twLabel,usLabel, xLabels:[{idx,label}], valueFmt, height}
   */
  const TW_LINE = '#E8823C', TW_FILL = 'rgba(232,130,60,0.22)';
  const US_LINE = '#4A82C8', US_FILL = 'rgba(74,130,200,0.18)';

  function trend(container, points, opts) {
    container.innerHTML = '';
    if (!points || !points.length) {
      container.innerHTML = '<div class="chart-empty">暫無歷史資料</div>';
      return;
    }
    opts = opts || {};
    const twKey = opts.twKey || 'tw', usKey = opts.usKey || 'us';
    const twLabel = opts.twLabel || '台股', usLabel = opts.usLabel || '美股';
    const valueFmt = opts.valueFmt || (v => App.Util.fmtKMBB(v));
    const H = opts.height || 200;
    const W = container.clientWidth || 340;
    const padL = 46, padR = 10, padT = 10, padB = 22;
    const chartW = W - padL - padR, chartH = H - padT - padB;

    const rows = points.map(p => {
      const tw = p.values[twKey] || 0, us = p.values[usKey] || 0;
      return { date: p.date, tw, us, total: tw + us };
    });
    let hi = 0;
    for (const r of rows) hi = Math.max(hi, r.total, r.tw);
    const ticks = niceTicks(0, hi, 4);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1);
    const n = rows.length;
    const xAt = i => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;
    const y0 = yAt(0);

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg">`;
    for (const t of ticks) {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${fmtAxis(t)}</text>`;
    }
    const twPts = rows.map((r, i) => [xAt(i), yAt(r.tw)]);
    const totPts = rows.map((r, i) => [xAt(i), yAt(r.total)]);
    const fwd = pts => pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const bwd = pts => pts.slice().reverse().map(p => 'L' + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

    if (n > 0) {
      // 美股 band（台股→總資產）藍色填充
      svg += `<path d="${fwd(totPts)} ${bwd(twPts)} Z" fill="${US_FILL}"/>`;
      // 台股 band（0→台股）橙色填充
      svg += `<path d="${fwd(twPts)} L${twPts[n - 1][0].toFixed(1)},${y0} L${twPts[0][0].toFixed(1)},${y0} Z" fill="${TW_FILL}"/>`;
      // 線（總資產=藍、台股=橙）
      svg += `<path d="${fwd(totPts)}" fill="none" stroke="${US_LINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
      svg += `<path d="${fwd(twPts)}" fill="none" stroke="${TW_LINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
    }
    if (opts.xLabels) for (const e of opts.xLabels)
      svg += `<text x="${xAt(e.idx)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#78716c">${e.label}</text>`;

    svg += `<line class="cursor-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg += `</svg>`;

    const legend = `<div class="chart-legend">
      <span class="lg"><i style="background:${TW_LINE}"></i>${twLabel}</span>
      <span class="lg"><i style="background:${US_LINE}"></i>${usLabel}</span>
      <span class="lg"><i style="background:${US_LINE};opacity:.5"></i>總資產</span>
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
        <div><i style="background:${US_LINE};opacity:.5"></i>總資產 <b>${valueFmt(r.total)}</b></div>`;
      tip.style.display = 'block';
      const left = Math.min(Math.max(xAt(idx) / W * rect.width - 60, 4), rect.width - 130);
      tip.style.left = left + 'px'; tip.style.top = '4px';
    }
    svgEl.addEventListener('pointerdown', e => handle(e.clientX));
    svgEl.addEventListener('pointermove', e => { if (e.buttons) handle(e.clientX); });
    container.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
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
        const lbl = col === 'netAsset' ? '淨資產' : col === 'newInvestment' ? '本期投入' : '本期損益';
        const txt = col === 'netAsset' ? U.fmtBanner(v) : U.fmtBannerSigned(v);
        body = `<div><b>${txt}</b> ${lbl}</div>`;
      }
      tip.innerHTML = `<div class="tip-date">${it.label}</div>${body}`;
      tip.style.display = 'block';
      const left = Math.min(Math.max(cx / W * rect2.width - 60, 4), rect2.width - 130);
      tip.style.left = left + 'px'; tip.style.top = '4px';
    }
    svgEl.addEventListener('pointerdown', e => handle(e.clientX));
    svgEl.addEventListener('pointermove', e => { if (e.buttons) handle(e.clientX); });
    container.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  }

  return { trend, bars, reportColumn, niceTicks };
})();
