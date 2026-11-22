// 全站共用的少量互動：複製連結、送出前確認、CSV 檔案讀入。
(() => {
  // 複製
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const box = button.closest('.copybox');
    const input = box?.querySelector('.copy-target');
    if (!input) return;
    const text = input.value;
    try {
      await navigator.clipboard.writeText(text);
      flash(button, '已複製');
    } catch {
      input.select();
      try {
        document.execCommand('copy');
        flash(button, '已複製');
      } catch {
        flash(button, '請手動複製');
      }
    }
  });

  function flash(button, text) {
    const original = button.textContent;
    button.textContent = text;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1400);
  }

  // 危險操作二次確認（form[data-confirm] 或 button[data-confirm]）
  document.addEventListener('submit', (event) => {
    const form = event.target;
    const message = form?.dataset?.confirm;
    if (message && !window.confirm(message)) {
      event.preventDefault();
    }
  });

  // 匯入 CSV：選檔後把內容填進 textarea
  for (const input of document.querySelectorAll('[data-csv-file]')) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const form = input.closest('form');
      const textarea = form?.querySelector('textarea[name="csv"]');
      if (!textarea) return;
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = String(reader.result || '');
        textarea.focus();
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  // 提示訊息 6 秒後淡出，但保留在 DOM 讓螢幕閱讀器讀完
  for (const banner of document.querySelectorAll('.flash-ok')) {
    setTimeout(() => {
      banner.style.transition = 'opacity .6s';
      banner.style.opacity = '0.35';
    }, 6000);
  }
})();
