/* =========================================================================
 * ui.js — 共用 UI 工具（toast / 損益顏色 / 元件 / 彈窗）
 * 台股慣例：漲紅、跌綠
 * ======================================================================= */
window.App = window.App || {};

App.UI = (function () {
  const GAIN = '#E53935';  // 漲：紅
  const LOSS = '#43A047';  // 跌：綠

  function pnlColor(v) { return (v >= 0 ? GAIN : LOSS); }

  function toast(msg, type) {
    let host = document.getElementById('toast-host');
    if (!host) { host = document.createElement('div'); host.id = 'toast-host'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2400);
  }

  // 金額（帶色、帶正負號）
  function money(v, opts) {
    opts = opts || {};
    const signed = opts.signed;
    const txt = signed ? App.Util.fmtBannerSigned(v) : App.Util.fmtBanner(v);
    const color = opts.color === false ? '' : `color:${pnlColor(v)}`;
    return `<span style="${color}">${txt}</span>`;
  }

  function openSheet(title, bodyHtml, footerHtml) {
    closeSheet();
    const ov = document.createElement('div');
    ov.className = 'sheet-overlay';
    ov.id = 'sheet-overlay';
    ov.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <span class="sheet-title">${title}</span>
          <button class="sheet-close" aria-label="關閉">✕</button>
        </div>
        <div class="sheet-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="sheet-foot">${footerHtml}</div>` : ''}
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('.sheet-close').addEventListener('click', closeSheet);
    ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
    requestAnimationFrame(() => ov.classList.add('show'));
    return ov;
  }
  function closeSheet() {
    const ov = document.getElementById('sheet-overlay');
    if (ov) { ov.classList.remove('show'); setTimeout(() => ov.remove(), 250); }
  }

  function confirmDialog(msg, onYes, yesLabel) {
    const ov = openSheet('確認', `<p style="padding:4px 2px 12px;color:#1c1917">${msg}</p>`,
      `<button class="btn btn-ghost" id="cd-no">取消</button><button class="btn btn-danger" id="cd-yes">${yesLabel || '確定'}</button>`);
    ov.querySelector('#cd-no').addEventListener('click', closeSheet);
    ov.querySelector('#cd-yes').addEventListener('click', () => { closeSheet(); onYes && onYes(); });
  }

  return { GAIN, LOSS, pnlColor, toast, money, openSheet, closeSheet, confirmDialog };
})();
