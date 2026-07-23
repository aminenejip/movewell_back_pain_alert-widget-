export class Timer {
  constructor(workMinutes = 30, breakMinutes = 2) {
    this.workMs = workMinutes * 60 * 1000;
    this.breakMs = breakMinutes * 60 * 1000;
    this.reset();
  }

  reset() {
    this.state = 'idle'; // idle | work | break | paused
    this._prevState = 'work';
    this.elapsed = 0;
    this.sessionTotal = this.workMs;
    this.lastTick = 0;
    this._intervalId = null;
  }

  setWork(min) {
    this.workMs = Math.max(1, Math.min(480, min)) * 60 * 1000;
    if (this.state === 'idle') this.sessionTotal = this.workMs;
  }

  setBreak(min) {
    this.breakMs = Math.max(1, Math.min(60, min)) * 60 * 1000;
  }

  start() {
    this.reset();
    this.state = 'work';
    this.elapsed = 0;
    this.sessionTotal = this.workMs;
    this._startTick();
    this.onTick?.();
  }

  pause() {
    if (this.state === 'work' || this.state === 'break') {
      this.state = 'paused';
      this._stopTick();
      this.onTick?.();
    }
  }

  resume() {
    if (this.state === 'paused') {
      const prevState = this._prevState || 'work';
      this.state = prevState;
      this._startTick();
      this.onTick?.();
    }
  }

  stop() {
    this._stopTick();
    this.reset();
    this.onTick?.();
  }

  isRunning() {
    return this.state === 'work' || this.state === 'break';
  }

  isPaused() {
    return this.state === 'paused';
  }

  isBreak() {
    return this.state === 'break';
  }

  getProgress() {
    if (!this.isRunning() && this.state !== 'paused') return 0;
    return Math.min(this.elapsed / this.sessionTotal, 1);
  }

  getTimeStr() {
    const remaining = Math.max(0, this.sessionTotal - this.elapsed);
    const totalSec = Math.ceil(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  getModeStr() {
    if (this.state === 'work') return 'Travail';
    if (this.state === 'break') return 'Pause';
    if (this.state === 'paused' && this._prevState === 'break') return 'Pause';
    return 'Travail';
  }

  _startTick() {
    this._prevState = this.state;
    this.lastTick = performance.now();
    const tick = (now) => {
      if (!this.isRunning()) return;
      const dt = now - this.lastTick;
      this.lastTick = now;
      this.elapsed += dt;
      this.onTick?.();
      if (this.elapsed >= this.sessionTotal) {
        if (this.state === 'work') {
          this.state = 'break';
          this.elapsed = 0;
          this.sessionTotal = this.breakMs;
          this.lastTick = performance.now();
          this.onWorkEnd?.();
          this._intervalId = requestAnimationFrame(tick);
        } else {
          this.state = 'work';
          this.elapsed = 0;
          this.sessionTotal = this.workMs;
          this.lastTick = performance.now();
          this.onBreakEnd?.();
          this._intervalId = requestAnimationFrame(tick);
        }
        return;
      }
      this._intervalId = requestAnimationFrame(tick);
    };
    this._intervalId = requestAnimationFrame(tick);
  }

  _stopTick() {
    if (this._intervalId) {
      cancelAnimationFrame(this._intervalId);
      this._intervalId = null;
    }
  }
}
