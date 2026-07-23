export class AudioManager {
  constructor() {
    this._ctx = null;
  }

  _getCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  }

  async listSounds() {
    try {
      const resp = await fetch('/sounds/');
      return [];
    } catch { return []; }
  }

  async playSound(enabled, file, durationSec = 3) {
    if (!enabled) return;

    if (!file || file === '') {
      this._beepSystem();
      return;
    }

    try {
      const resp = await fetch(`/sounds/${encodeURIComponent(file)}`);
      const buf = await resp.arrayBuffer();
      const ctx = this._getCtx();
      const audioBuf = await ctx.decodeAudioData(buf);
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);
      src.start(0);
      setTimeout(() => { try { src.stop(); } catch {} }, durationSec * 1000);
    } catch {
      this._beepSystem();
    }
  }

  _beepSystem() {
    try {
      const ctx = this._getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(0);
      osc.stop(ctx.currentTime + 0.5);
    } catch {}
  }
}

export const audio = new AudioManager();
