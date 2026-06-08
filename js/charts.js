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

  /* ---- 走勢面積圖 ----
   * points: [{date:Date, values:{tw,us,total}}]
   * opts: {keys:[{key,color,label,fill}], xLabels:[{idx,label}], valueFmt, height}
   * 互動：點擊顯示最近資料點 tooltip
   */
  function trend(container, points, opts) {
    container.innerHTML = '';
    if (!points || !points.length) {
      container.innerHTML = '<div class="chart-empty">暫無歷史資料</div>';
      return;
    }
    const keys = opts.keys;
    const valueFmt = opts.valueFmt || (v => App.Util.fmtKMBB(v));
    const H = opts.height || 200;
    const W = container.clientWidth || 340;
    const padL = 44, padR = 10, padT = 10, padB = 22;
    const chartW = W - padL - padR, chartH = H - padT - padB;

    let lo = Infinity, hi = -Infinity;
    for (const p of points) for (const k of keys) {
      const v = p.values[k.key]; if (v == null) continue;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const ticks = niceTicks(lo, hi, 4);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1], ySpan = Math.max(yHi - yLo, 1);
    const n = points.length;
    const xAt = i => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
    const yAt = v => padT + (1 - (v - yLo) / ySpan) * chartH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg">`;
    // Y 格線 + 標籤
    for (const t of ticks) {
      const y = yAt(t);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${t === 0 ? '#d6d3d1' : '#eee'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'}/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#78716c">${fmtAxis(t)}</text>`;
    }
    // 面積 + 線
    for (const k of keys) {
      const pts = points.map((p, i) => [xAt(i), p.values[k.key] != null ? yAt(p.values[k.key]) : null]).filter(p => p[1] != null);
      if (pts.length < 1) continue;
      const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      if (k.fill) {
        const baseY = yAt(Math.max(yLo, 0));
        const area = line + ` L${pts[pts.length - 1][0].toFixed(1)},${baseY} L${pts[0][0].toFixed(1)},${baseY} Z`;
        svg += `<path d="${area}" fill="${k.color}" opacity="0.12"/>`;
      }
      svg += `<path d="${line}" fill="none" stroke="${k.color}" stroke-width="1.8" stroke-linejoin="round"/>`;
    }
    // X 軸標籤
    if (opts.xLabels) {
      for (const e of opts.xLabels) {
        svg += `<text x="${xAt(e.idx)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#78716c">${e.label}</text>`;
      }
    }
    // 互動圖層
    svg += `<line class="cursor-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg += `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" fill="transparent" class="hit"/>`;
    svg += `</svg>`;

    // 圖例
    let legend = '<div class="chart-legend">';
    for (const k of keys) legend += `<span class="lg"><i style="background:${k.color}"></i>${k.label}</span>`;
    legend += '</div>';
    container.innerHTML = legend + svg;

    // tooltip 互動
    const svgEl = container.querySelector('svg');
    const cursor = container.querySelector('.cursor-line');
    let tip = container.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.style.display = 'none'; container.appendChild(tip); }

    function handle(clientX) {
      const rect = svgEl.getBoundingClientRect();
      const sx = (clientX - rect.left) / rect.width * W;
      let idx = Math.round((sx - padL) / (chartW || 1) * (n - 1));
      idx = Math.max(0, Math.min(n - 1, idx));
      const p = points[idx];
      cursor.setAttribute('x1', xAt(idx)); cursor.setAttribute('x2', xAt(idx));
      cursor.setAttribute('visibility', 'visible');
      const dateStr = App.Util.isoDate(p.date);
      let rows = keys.map(k => p.values[k.key] != null
        ? `<div><i style="background:${k.color}"></i>${k.label} <b>${valueFmt(p.values[k.key])}</b></div>` : '').join('');
      tip.innerHTML = `<div class="tip-date">${dateStr}</div>${rows}`;
      tip.style.display = 'block';
      const left = Math.min(Math.max(xAt(idx) / W * rect.width - 60, 4), rect.width - 124);
      tip.style.left = left + 'px';
      tip.style.top = '4px';
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

  return { trend, bars, niceTicks };
})();
