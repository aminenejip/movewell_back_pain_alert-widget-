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
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = 523;
      gain1.gain.setValueAtTime(0.25, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 659;
      gain2.gain.setValueAtTime(0.25, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.5);
    } catch {}
  }
}

export const audio = new AudioManager();
