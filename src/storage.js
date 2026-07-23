const CONFIG_KEY = 'pause-dos-config';
const HISTORY_KEY = 'pause-dos-history';
const BREAK_PRESETS = [1, 2, 3, 5, 10];

const DEFAULTS = {
  interval_minutes: 30,
  break_minutes: 2,
  sound_enabled: true,
  sound_file: null,
  always_on_top: true,
  window_x: null,
  window_y: null,
};

export class Storage {
  loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULTS };
  }

  saveConfig(cfg) {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch {}
  }

  loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  saveHistory(h) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    } catch {}
  }
}

export const storage = new Storage();
export { BREAK_PRESETS };
