// 現場簽到：相機掃 QR（jsQR）＋ 解析 ＋ 確認簽到。
// 只在簽到頁載入，掃描器本身按需下載。
(() => {
  const root = document.querySelector('[data-scan-root]');
  if (!root) return;

  const eventId = root.dataset.eventId;
  const csrf = root.dataset.csrf;
  const video = root.querySelector('[data-scan-video]');
  const scanner = root.querySelector('[data-scanner]');
  const statusEl = root.querySelector('[data-scan-status]');
  const resultEl = root.querySelector('[data-scan-result]');
  const startBtn = root.querySelector('[data-scan-start]');
  const stopBtn = root.querySelector('[data-scan-stop]');

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  let stream = null;
  let running = false;
  let paused = false;
  let jsQR = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  const SOUND_KEY = 'cs.scan.sound';
  let audioContext = null;

  function soundEnabled() {
    try {
      return localStorage.getItem(SOUND_KEY) !== '0';
    } catch {
      return true;
    }
  }

  function playTone(freq, startAt, duration, volume = 0.12) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  /** kind: 'scan'（讀到碼）、'success'（簽到完成）、'error'（失敗） */
  function beep(kind = 'success') {
    try {
      if (navigator.vibrate) navigator.vibrate(kind === 'error' ? [60, 40, 60] : 40);
    } catch {
      /* 忽略 */
    }
    if (!soundEnabled()) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();
      const now = audioContext.currentTime;
      if (kind === 'success') {
        playTone(880, now, 0.1);
        playTone(1320, now + 0.12, 0.16);
      } else if (kind === 'scan') {
        playTone(1100, now, 0.06, 0.08);
      } else {
        playTone(220, now, 0.3, 0.14);
      }
    } catch {
      /* 沒有音效權限就算了 */
    }
  }

  async function ensureDecoder() {
    if (jsQR) return jsQR;
    if (window.jsQR) {
      jsQR = window.jsQR;
      return jsQR;
    }
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/jsqr.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('掃描程式載入失敗'));
      document.head.appendChild(script);
    });
    if (!window.jsQR) throw new Error('掃描程式載入失敗');
    jsQR = window.jsQR;
    return jsQR;
  }

  async function start() {
    if (running) return;
    if (!window.isSecureContext) {
      window.alert(
        '瀏覽器只允許在 HTTPS 或 localhost 開啟相機。\n\n' +
          '你可以：\n1. 在這台電腦用 http://localhost:' + (location.port || 80) + ' 開這個頁面；\n' +
          '2. 或者用下面「輸入 8 碼短碼」代替掃描。',
      );
      return;
    }
    startBtn.disabled = true;
    scanner.hidden = false;
    setStatus('正在啟動鏡頭…');

    try {
      await ensureDecoder();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      paused = false;
      setStatus('對準 QR code');
      scanLoop();
    } catch (error) {
      stop();
      if (error.name === 'NotAllowedError') setStatus('你拒絕了相機權限，可以在網址列的鎖頭圖示重新允許。');
      else if (error.name === 'NotFoundError') setStatus('找不到相機，請用下面的短碼輸入。');
      else setStatus(`無法開啟相機：${error.message}`);
    } finally {
      startBtn.disabled = false;
    }
  }

  function stop() {
    running = false;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
    scanner.hidden = true;
  }

  function scanLoop() {
    if (!running) return;
    if (!paused && video.readyState === video.HAVE_ENOUGH_DATA) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width && height) {
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        try {
          const image = context.getImageData(0, 0, width, height);
          const found = jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' });
          if (found?.data) {
            paused = true;
            beep('scan');
            setStatus('已讀取，正在查詢…');
            resolveCode(found.data);
          }
        } catch {
          /* 單格解碼失敗就跳過 */
        }
      }
    }
    requestAnimationFrame(scanLoop);
  }

  async function resolveCode(raw) {
    let code = String(raw).trim();
    if (code.startsWith('ATT:')) code = code.slice(4);
    if (!code) return resume('QR 內容是空的，請再試一次');

    try {
      const response = await fetch(`/api/events/${eventId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, _csrf: csrf }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        beep('error');
        showResult(
          `<p class="flash flash-err">${escapeHtml(data.error || '找不到這個 QR')}</p>
           <div class="scan-actions"><button class="btn btn-sm" data-resume>繼續掃描</button></div>`,
        );
        return;
      }
      showAttendee(data);
    } catch {
      beep('error');
      showResult(
        `<p class="flash flash-err">連線失敗，請再掃一次。</p>
         <div class="scan-actions"><button class="btn btn-sm" data-resume>繼續掃描</button></div>`,
      );
    }
  }

  function showAttendee(data) {
    const attendee = data.attendee;
    const checkin = data.checkin;
    const status = checkin
      ? `<span class="badge badge-ok">已簽到 ${escapeHtml(checkin.checked_in_label)}</span>
         ${checkin.is_late ? `<span class="badge badge-warn">遲到 ${checkin.late_minutes} 分</span>` : ''}`
      : '<span class="badge badge-quiet">未簽到</span>';

    showResult(`
      <h3>${escapeHtml(attendee.name)}</h3>
      <p class="muted">${escapeHtml(attendee.group_name || '')} ${escapeHtml(attendee.phone_masked || '')} ${status}</p>
      ${data.attendee.in_roster ? '' : '<p class="hint">不在本場名單內，確認後會自動加入。</p>'}
      <div class="scan-actions">
        <button class="btn btn-primary" data-confirm-checkin="${escapeHtml(attendee.id)}">
          ${checkin ? '仍要再簽一次' : '確認簽到'}
        </button>
        <button class="btn btn-ghost" data-resume>取消</button>
      </div>
    `);
  }

  async function confirmCheckin(attendeeId) {
    try {
      const response = await fetch(`/api/events/${eventId}/scan-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendee_id: attendeeId, _csrf: csrf }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        beep('error');
        showResult(
          `<p class="flash flash-err">${escapeHtml(data.error || '簽到失敗')}</p>
           <div class="scan-actions"><button class="btn btn-sm" data-resume>繼續掃描</button></div>`,
        );
        return;
      }
      beep('success');
      const late = data.is_late ? `<span class="badge badge-warn">遲到 ${data.late_minutes} 分</span>` : '<span class="badge badge-ok">準時</span>';
      showResult(`
        <h3>✓ ${escapeHtml(data.name)} 簽到完成</h3>
        <p class="muted">${escapeHtml(data.checked_in_label)} ${late}</p>
        <div class="scan-actions"><button class="btn btn-primary" data-resume>繼續掃下一個</button></div>
      `);
      setTimeout(() => {
        if (running) resume();
      }, 2200);
    } catch {
      beep('error');
      showResult(
        `<p class="flash flash-err">連線失敗，請再試一次。</p>
         <div class="scan-actions"><button class="btn btn-sm" data-resume>繼續掃描</button></div>`,
      );
    }
  }

  function resume(message = '') {
    resultEl.hidden = true;
    resultEl.innerHTML = '';
    paused = false;
    if (message) setStatus(message);
    else if (running) setStatus('對準 QR code');
    startBtn.disabled = false;
  }

  function showResult(html) {
    resultEl.hidden = false;
    resultEl.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  startBtn?.addEventListener('click', start);
  stopBtn?.addEventListener('click', () => {
    stop();
    resume('');
    setStatus('已停止');
  });

  // 提示音開關：記在這部裝置（localStorage），換平板各自設定
  const soundToggle = root.querySelector('[data-scan-sound]');
  if (soundToggle) {
    soundToggle.checked = soundEnabled();
    soundToggle.addEventListener('change', () => {
      try {
        localStorage.setItem(SOUND_KEY, soundToggle.checked ? '1' : '0');
      } catch {
        /* 無痕模式可能寫不到，照樣用今次設定 */
      }
      if (soundToggle.checked) beep('success');
    });
  }

  resultEl?.addEventListener('click', (event) => {
    const resumeBtn = event.target.closest('[data-resume]');
    if (resumeBtn) {
      resume();
      return;
    }
    const confirmBtn = event.target.closest('[data-confirm-checkin]');
    if (confirmBtn) confirmCheckin(confirmBtn.dataset.confirmCheckin);
  });

  // 離開頁面時關閉鏡頭
  window.addEventListener('pagehide', stop);
})();
