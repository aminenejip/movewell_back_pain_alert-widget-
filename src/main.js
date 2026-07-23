import { Timer } from './timer.js';
import { storage, BREAK_PRESETS } from './storage.js';
import { audio } from './audio.js';

let appWindow = null;
let LogicalSize = null;
try {
  const wmod = await import('@tauri-apps/api/window');
  appWindow = wmod.getCurrentWindow();
} catch {} // browser fallback
try {
  const dpi = await import('@tauri-apps/api/dpi');
  LogicalSize = dpi.LogicalSize;
} catch {}

const cfg = storage.loadConfig();
const history = storage.loadHistory();

const timer = new Timer(cfg.interval_minutes, cfg.break_minutes);
let pulse = 0;
let pulseDir = 1;
let particles = [];
let particleFrame = null;

// ── DOM refs ──
const $ = (s) => document.querySelector(s);
const timeDisplay = $('#time-display');
const statusDisplay = $('#status-display');
const ringCanvas = $('#ring-canvas');
const ctx = ringCanvas.getContext('2d');
const ringWrapper = $('#ring-wrapper');
const startBtn = $('#start-btn');
const pauseBtn = $('#pause-btn');
const stopBtn = $('#stop-btn');
const minimizeBtn = $('#minimize-btn');
const maximizeBtn = $('#maximize-btn');
const closeBtn = $('#close-btn');
const historyLabel = $('#history-label');
const workSpin = $('#work-spin');
const breakSelect = $('#break-select');
const soundToggle = $('#sound-toggle');
const soundSelect = $('#sound-select');
const topmostToggle = $('#topmost-toggle');
const hint = $('#hint');
const particlesCanvas = $('#particles-canvas');
const pCtx = particlesCanvas.getContext('2d');

const DPR = devicePixelRatio || 1;
let ringSize = 240;
let CX = 120, CY = 120, R = 90;

// ── Canvas setup ──
function setupCanvas(canvas, w, h) {
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = w * DPR;
  canvas.height = h * DPR;
  const c = canvas.getContext('2d');
  c.scale(DPR, DPR);
  return c;
}

function resizeRing() {
  const size = ringWrapper.clientWidth || 240;
  ringSize = size;
  CX = size / 2;
  CY = size / 2;
  R = Math.max(20, size / 2 - 12);
  setupCanvas(ringCanvas, size, size);
  drawRing();
}

const ro = new ResizeObserver(resizeRing);
ro.observe(ringWrapper);

function resizeParticles() {
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  setupCanvas(particlesCanvas, w, h);
}
resizeParticles();

function getColor() {
  if (!timer.isRunning() && !timer.isPaused()) return { fg: '#5E6068', dim: '#12141E', txt: '#5E6068', ep: '#5E6068' };
  if (timer.isBreak()) {
    const p = timer.getProgress();
    if (p > 0.3) return { fg: '#FF7A3D', dim: 'rgba(255,122,61,0.12)', txt: '#FF7A3D', ep: '#FF7A3D' };
    return { fg: '#4ADE80', dim: 'rgba(74,222,128,0.12)', txt: '#4ADE80', ep: '#4ADE80' };
  }
  return { fg: '#00D9FF', dim: 'rgba(0,217,255,0.12)', txt: '#00D9FF', ep: '#00D9FF' };
}

function drawRing() {
  const c = ctx;
  const p = timer.isRunning() || timer.isPaused() ? timer.getProgress() : 1;
  const extent = Math.PI * 2 * p;
  const col = getColor();
  const pls = timer.isRunning() ? 3 * Math.sin(pulse) : 0;

  c.clearRect(0, 0, ringSize, ringSize);

  // bg track
  c.beginPath();
  c.arc(CX, CY, R, 0, Math.PI * 2);
  c.strokeStyle = '#12141E';
  c.lineWidth = 8;
  c.stroke();

  if (timer.isRunning() || timer.isPaused()) {
    // glow layers
    for (let w = 16; w <= 28; w += 3) {
      const alpha = 0.06 - (w - 16) * 0.004;
      c.beginPath();
      c.arc(CX, CY, R, -Math.PI / 2, -Math.PI / 2 + extent);
      c.strokeStyle = col.dim.replace('0.12', String(Math.max(0, alpha)));
      c.lineWidth = w + pls;
      c.lineCap = 'round';
      c.stroke();
    }

    // main arc
    c.beginPath();
    c.arc(CX, CY, R, -Math.PI / 2, -Math.PI / 2 + extent);
    c.strokeStyle = col.fg;
    c.lineWidth = 8;
    c.lineCap = 'round';
    c.stroke();

    // endpoint circle
    const endAngle = -Math.PI / 2 + extent;
    const epX = CX + R * Math.cos(endAngle);
    const epY = CY + R * Math.sin(endAngle);
    c.beginPath();
    c.arc(epX, epY, 4.5, 0, Math.PI * 2);
    c.fillStyle = col.ep;
    c.fill();
    c.shadowColor = col.ep;
    c.shadowBlur = 8;
    c.fill();
    c.shadowBlur = 0;
  } else {
    // idle: full dim arc
    c.beginPath();
    c.arc(CX, CY, R, 0, Math.PI * 2);
    c.strokeStyle = '#5E6068';
    c.lineWidth = 8;
    c.stroke();

    // endpoint at top
    c.beginPath();
    c.arc(CX, CY - R, 4.5, 0, Math.PI * 2);
    c.fillStyle = '#5E6068';
    c.fill();
  }

  // tick mark at 12 o'clock
  c.beginPath();
  c.moveTo(CX, CY - R - 12);
  c.lineTo(CX, CY - R - 18);
  c.strokeStyle = col.fg;
  c.lineWidth = 2.5;
  c.lineCap = 'round';
  c.stroke();
}

function getTimeStr() {
  if (timer.isRunning() || timer.isPaused()) return timer.getTimeStr();
  const m = cfg.interval_minutes || 30;
  return `${String(m).padStart(2, '0')}:00`;
}

function updateDisplay() {
  timeDisplay.textContent = getTimeStr();
  statusDisplay.textContent = timer.getModeStr();
  const col = getColor();
  timeDisplay.style.color = col.txt;
  drawRing();

  // update buttons
  if (!timer.isRunning() && !timer.isPaused()) {
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    startBtn.className = 'pill-btn primary';
    pauseBtn.className = 'pill-btn';
    stopBtn.className = 'pill-btn danger';
    pauseBtn.textContent = 'Pause';
  } else if (timer.isPaused()) {
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    pauseBtn.className = 'pill-btn secondary-active';
    pauseBtn.textContent = 'Reprendre';
    startBtn.className = 'pill-btn';
    stopBtn.className = 'pill-btn danger';
  } else if (timer.isRunning()) {
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    pauseBtn.className = 'pill-btn';
    pauseBtn.textContent = 'Pause';
    startBtn.className = 'pill-btn';
    stopBtn.className = 'pill-btn danger';
  }
}

// ── Particles ──
let pw = 340, ph = 520;

class Particle {
  constructor() {
    this.reset();
    this.y = Math.random() * ph;
  }
  reset() {
    pw = document.documentElement.clientWidth || 340;
    ph = document.documentElement.clientHeight || 520;
    this.x = Math.random() * pw;
    this.y = -5;
    this.size = Math.random() * 1.5 + 0.5;
    this.speed = Math.random() * 0.3 + 0.1;
    this.opacity = Math.random() * 0.3 + 0.05;
  }
  update() {
    this.y += this.speed;
    if (this.y > ph + 5) this.reset();
  }
  draw(c) {
    c.beginPath();
    c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    c.fillStyle = `rgba(0, 217, 255, ${this.opacity})`;
    c.fill();
  }
}

function initParticles(count) {
  for (let i = 0; i < count; i++) particles.push(new Particle());
}
initParticles(30);

function animateParticles() {
  pw = document.documentElement.clientWidth || 340;
  ph = document.documentElement.clientHeight || 520;
  pCtx.clearRect(0, 0, pw, ph);
  for (const p of particles) {
    p.update();
    p.draw(pCtx);
  }
  particleFrame = requestAnimationFrame(animateParticles);
}

// ── Sound files ──
function initSounds() {
  const files = ['police-siren-soundbible_CGYFxjf.mp3'];
  for (const f of files) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/\.\w+$/, '');
    soundSelect.appendChild(opt);
  }
}

// ── History ──
function updateHistory() {
  const today = new Date().toISOString().slice(0, 10);
  const count = history.filter(h => h.date === today).length;
  historyLabel.textContent = `Aujourd'hui \u00b7 ${count} pause${count > 1 ? 's' : ''}`;
}

// ── Callbacks ──
timer.onTick = () => {
  if (timer.isRunning()) {
    pulse += 0.04 * pulseDir;
    if (pulse > 1 || pulse < 0) pulseDir *= -1;
  }
  updateDisplay();
};

timer.onWorkEnd = () => {
  history.push({
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    type: 'pause',
  });
  storage.saveHistory(history);
  updateHistory();
  const sf = soundSelect.value;
  audio.playSound(soundToggle.querySelector('.custom-checkbox').getAttribute('aria-checked') === 'true', sf || null, 3);
  updateDisplay();
};

timer.onBreakEnd = () => {
  const sf = soundSelect.value;
  audio.playSound(soundToggle.querySelector('.custom-checkbox').getAttribute('aria-checked') === 'true', sf || null, 2);
  updateDisplay();
};

// ── Handlers ──
function onStart() {
  const mins = parseInt(workSpin.value) || 30;
  const bm = parseInt(breakSelect.value) || 2;
  timer.setWork(mins);
  timer.setBreak(bm);
  timer.start();
  cfg.interval_minutes = mins;
  cfg.break_minutes = bm;
  storage.saveConfig(cfg);
  updateDisplay();
}

function onPause() {
  if (timer.isPaused()) {
    timer.resume();
  } else {
    timer.pause();
  }
  updateDisplay();
}

function onStop() {
  timer.stop();
  updateDisplay();
}

function toggleCheckbox(el) {
  const cb = el.querySelector('.custom-checkbox') || el;
  if (cb.classList.contains('custom-checkbox')) {
    const checked = cb.getAttribute('aria-checked') === 'true';
    cb.setAttribute('aria-checked', !checked);
    return !checked;
  }
  return false;
}

async function onToggleTopmost() {
  const checked = toggleCheckbox(topmostToggle);
  cfg.always_on_top = checked;
  storage.saveConfig(cfg);
  if (appWindow) {
    try { await appWindow.setAlwaysOnTop(checked); } catch {}
  }
}

function onToggleSound() {
  const checked = toggleCheckbox(soundToggle);
  cfg.sound_enabled = checked;
  storage.saveConfig(cfg);
}

async function onClose() {
  cfg.window_x = window.screenX;
  cfg.window_y = window.screenY;
  if (appWindow) {
    try {
      const s = await appWindow.outerSize();
      cfg.window_w = s.width;
      cfg.window_h = s.height;
    } catch {}
  }
  cfg.sound_enabled = soundToggle.querySelector('.custom-checkbox').getAttribute('aria-checked') === 'true';
  cfg.sound_file = soundSelect.value || null;
  cfg.break_minutes = parseInt(breakSelect.value) || 2;
  timer.stop();
  storage.saveConfig(cfg);
  if (particleFrame) cancelAnimationFrame(particleFrame);
  if (appWindow) {
    try { await appWindow.close(); } catch {}
  } else {
    window.close();
  }
}

// ── Drag (browser fallback) ──
const titlebar = $('#titlebar');
if (!appWindow) {
  let dx = 0, dy = 0;
  titlebar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dx = e.screenX; dy = e.screenY;
    const onMove = (ev) => { window.moveBy(ev.screenX - dx, ev.screenY - dy); dx = ev.screenX; dy = ev.screenY; };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Init ──
function init() {
  workSpin.value = cfg.interval_minutes || 30;
  const bm = cfg.break_minutes || 2;
  breakSelect.value = String(bm);
  soundToggle.querySelector('.custom-checkbox').setAttribute('aria-checked', cfg.sound_enabled !== false);
  topmostToggle.querySelector('.custom-checkbox').setAttribute('aria-checked', cfg.always_on_top !== false);
  if (cfg.sound_file) soundSelect.value = cfg.sound_file;

  if (appWindow && cfg.always_on_top !== false) {
    appWindow.setAlwaysOnTop(true).catch(() => {});
  }

  // restore window size if saved
  if (appWindow && cfg.window_w && cfg.window_h && LogicalSize) {
    appWindow.setSize(new LogicalSize(cfg.window_w, cfg.window_h)).catch(() => {});
  }

  // window controls
  minimizeBtn.addEventListener('click', () => {
    if (appWindow) appWindow.minimize();
  });

  function toggleMax() {
    if (!appWindow) return;
    appWindow.isMaximized().then((max) => {
      (max ? appWindow.unmaximize() : appWindow.maximize()).then(() => {
        appWindow.isMaximized().then((m) => {
          maximizeBtn.querySelector('.max-icon').style.display = m ? 'none' : '';
          maximizeBtn.querySelector('.restore-icon').style.display = m ? '' : 'none';
          maximizeBtn.setAttribute('aria-label', m ? 'Restaurer' : 'Agrandir');
        });
      });
    });
  }

  maximizeBtn.addEventListener('click', toggleMax);
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('#window-controls')) return;
    toggleMax();
  });

  if (appWindow) {
    appWindow.onResized(() => {
      appWindow.isMaximized().then((m) => {
        maximizeBtn.querySelector('.max-icon').style.display = m ? 'none' : '';
        maximizeBtn.querySelector('.restore-icon').style.display = m ? '' : 'none';
        maximizeBtn.setAttribute('aria-label', m ? 'Restaurer' : 'Agrandir');
      });
      resizeParticles();
    });
  }
  window.addEventListener('resize', resizeParticles);

  startBtn.addEventListener('click', onStart);
  pauseBtn.addEventListener('click', onPause);
  stopBtn.addEventListener('click', onStop);
  closeBtn.addEventListener('click', onClose);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose(); });

  workSpin.addEventListener('change', () => {
    timer.setWork(parseInt(workSpin.value) || 30);
  });

  breakSelect.addEventListener('change', () => {
    timer.setBreak(parseInt(breakSelect.value) || 2);
  });

  soundToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleSound();
  });

  topmostToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleTopmost();
  });

  // checkbox keyboard support
  document.querySelectorAll('.custom-checkbox').forEach(cb => {
    cb.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        cb.click();
      }
    });
  });

  resizeRing();
  updateHistory();
  updateDisplay();
  animateParticles();
  initSounds();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
