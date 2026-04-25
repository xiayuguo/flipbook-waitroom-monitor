(function () {
  'use strict';

  // Prevent duplicate widgets if script runs multiple times
  if (document.getElementById('fbwm-widget')) return;

  const API_URL = 'https://flipbook.page/api/waitroom';
  let pollTimer = null;
  let countdownTimer = null;
  let wasAdmitted = false;
  let prevPosition = null;

  // ── Create widget DOM ────────────────────────────────────────────────────
  const widget = document.createElement('div');
  widget.id = 'fbwm-widget';
  widget.innerHTML = `
    <div id="fbwm-header">
      <div id="fbwm-title">
        <span id="fbwm-dot" class="fbwm-dot-idle"></span>
        <span>Queue Monitor</span>
      </div>
      <div id="fbwm-controls">
        <button id="fbwm-minimize" title="Minimize">−</button>
        <button id="fbwm-close" title="Close">×</button>
      </div>
    </div>
    <div id="fbwm-body">
      <div id="fbwm-position-section">
        <div id="fbwm-pos-label">Queue Position</div>
        <div id="fbwm-pos-value">--</div>
        <div id="fbwm-pos-change"></div>
      </div>
      <div id="fbwm-progress-section">
        <div id="fbwm-progress-bar">
          <div id="fbwm-progress-fill"></div>
        </div>
        <div id="fbwm-progress-labels">
          <span>Front</span>
          <span id="fbwm-progress-pct">--%</span>
          <span>Back</span>
        </div>
      </div>
      <div id="fbwm-stats">
        <div class="fbwm-stat">
          <div class="fbwm-stat-val" id="fbwm-ahead">--</div>
          <div class="fbwm-stat-label">Ahead</div>
        </div>
        <div class="fbwm-stat">
          <div class="fbwm-stat-val" id="fbwm-total">--</div>
          <div class="fbwm-stat-label">Total</div>
        </div>
        <div class="fbwm-stat">
          <div class="fbwm-stat-val" id="fbwm-wait">--</div>
          <div class="fbwm-stat-label">Est. Wait</div>
        </div>
        <div class="fbwm-stat">
          <div class="fbwm-stat-val" id="fbwm-capacity">--</div>
          <div class="fbwm-stat-label">Capacity</div>
        </div>
      </div>
      <div id="fbwm-status-bar">Connecting...</div>
      <div id="fbwm-footer">
        <span id="fbwm-update-time">--</span>
        <span id="fbwm-countdown" title="距下次刷新">10s</span>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  // ── DOM shortcuts ────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const dot = $('fbwm-dot');
  const posValue = $('fbwm-pos-value');
  const posChange = $('fbwm-pos-change');
  const progressFill = $('fbwm-progress-fill');
  const progressPct = $('fbwm-progress-pct');
  const aheadEl = $('fbwm-ahead');
  const totalEl = $('fbwm-total');
  const waitEl = $('fbwm-wait');
  const capacityEl = $('fbwm-capacity');
  const statusBar = $('fbwm-status-bar');
  const updateTimeEl = $('fbwm-update-time');
  const countdownEl = $('fbwm-countdown');
  const body = $('fbwm-body');

  // ── Minimize / Close ─────────────────────────────────────────────────────
  let minimized = false;
  $('fbwm-minimize').addEventListener('click', () => {
    minimized = !minimized;
    body.style.display = minimized ? 'none' : '';
    $('fbwm-minimize').textContent = minimized ? '+' : '−';
    widget.style.borderRadius = minimized ? '30px' : '14px';
  });

  $('fbwm-close').addEventListener('click', () => {
    widget.remove();
    clearTimeout(pollTimer);
    clearInterval(countdownTimer);
  });

  // ── Drag support ─────────────────────────────────────────────────────────
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  $('fbwm-header').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    const rect = widget.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    widget.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth - widget.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - widget.offsetHeight));
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
    widget.style.left = x + 'px';
    widget.style.top = y + 'px';
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    widget.style.transition = '';
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  function formatWait(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m${s}s` : `${m}min`;
  }

  function positionColor(pos) {
    if (pos <= 5) return '#22c55e';
    if (pos <= 20) return '#84cc16';
    if (pos <= 50) return '#f59e0b';
    if (pos <= 100) return '#f97316';
    return '#ef4444';
  }

  // ── Notification + sound on admitted ────────────────────────────────────
  function playAdmittedSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.15;
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.4);
      });
    } catch (e) {}
  }

  function notifyAdmitted() {
    playAdmittedSound();
    widget.classList.add('fbwm-admitted-flash');
    setTimeout(() => widget.classList.remove('fbwm-admitted-flash'), 4000);

    if (typeof Notification !== 'undefined') {
      const show = () => new Notification('🎉 Flipbook: Your turn!', {
        body: 'Queue ended — go create!',
        icon: 'https://flipbook.page/favicon.ico',
        requireInteraction: true
      });
      if (Notification.permission === 'granted') {
        show();
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => p === 'granted' && show());
      }
    }
  }

  // ── Countdown timer ──────────────────────────────────────────────────────
  function startCountdown(ms) {
    clearInterval(countdownTimer);
    let remaining = Math.ceil(ms / 1000);
    countdownEl.textContent = `${remaining}s`;
    countdownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownEl.textContent = 'Refreshing…';
      } else {
        countdownEl.textContent = `${remaining}s`;
      }
    }, 1000);
  }

  // ── Render data ──────────────────────────────────────────────────────────
  function renderData(data) {
    const pos = data.position;
    const color = positionColor(pos);

    // Position badge
    posValue.textContent = `#${pos}`;
    posValue.style.color = color;
    posValue.classList.add('fbwm-updated');
    setTimeout(() => posValue.classList.remove('fbwm-updated'), 500);

    // Position change indicator
    if (prevPosition !== null && prevPosition !== pos) {
      const delta = prevPosition - pos;
      if (delta > 0) {
        posChange.textContent = `▼ ${delta}`;
        posChange.className = 'fbwm-pos-down';
      } else {
        posChange.textContent = `▲ ${Math.abs(delta)}`;
        posChange.className = 'fbwm-pos-up';
      }
      setTimeout(() => {
        posChange.textContent = '';
        posChange.className = '';
      }, 3000);
    }
    prevPosition = pos;

    // Progress bar: percentage of queue you've passed through
    const pct = data.queue_length > 0
      ? Math.max(0, Math.round((1 - pos / data.queue_length) * 100))
      : 0;
    progressFill.style.width = pct + '%';
    progressFill.style.backgroundColor = color;
    progressPct.textContent = pct + '%';

    // Stats
    aheadEl.textContent = data.people_ahead;
    totalEl.textContent = data.queue_length;
    waitEl.textContent = formatWait(data.estimated_wait_seconds);
    capacityEl.textContent = `${data.active_admissions}/${data.max_admissions}`;

    // Timestamp
    updateTimeEl.textContent = new Date().toLocaleTimeString('en-US');

    // Status bar
    if (data.admitted) {
      statusBar.textContent = '✅ Admitted! Welcome to create';
      statusBar.className = 'fbwm-admitted';
      dot.className = 'fbwm-dot-green';
      if (!wasAdmitted) {
        wasAdmitted = true;
        notifyAdmitted();
      }
    } else if (data.queued) {
      statusBar.textContent = '⏳ In queue, please wait…';
      statusBar.className = 'fbwm-queued';
      dot.className = 'fbwm-dot-yellow';
    } else {
      statusBar.textContent = `Mode: ${data.mode}`;
      statusBar.className = '';
      dot.className = 'fbwm-dot-idle';
    }
  }

  // ── Poll loop ────────────────────────────────────────────────────────────
  async function poll() {
    dot.className = 'fbwm-dot-blink';
    try {
      const res = await fetch(API_URL, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderData(data);
      const delay = data.poll_after_ms || 10000;
      startCountdown(delay);
      pollTimer = setTimeout(poll, delay);
    } catch (err) {
      statusBar.textContent = `❌ Request failed: ${err.message}`;
      statusBar.className = 'fbwm-error';
      dot.className = 'fbwm-dot-red';
      startCountdown(10000);
      pollTimer = setTimeout(poll, 10000);
    }
  }

  poll();
})();
