/**
 * windowPlacement.js — persistent, monitor-aware window placement.
 *
 * Design rules (see docs/MOVEWELL_WIDGET_FIX_REPORT.md):
 *  - ONE coordinate system only: Tauri *physical* pixels for everything
 *    that is saved or applied. `outerPosition()` / `outerSize()` return
 *    physical pixels, and `PhysicalPosition` / `PhysicalSize` restore
 *    them unchanged. CSS/`window.screenX` coordinates are never used.
 *  - Saved placement is validated against the *real* monitor layout
 *    (monitors may have negative coordinates; never assume (0,0)) and
 *    repaired in place if inaccessible. Repairs are idempotent: once a
 *    valid physical placement is saved, restarts cause zero drift.
 *
 * Pure geometry functions (isRectAccessible, sanitizePlacement,
 * computeSafePosition) are dependency-free and unit-tested with
 * `node --test tests/windowPlacement.test.js`.
 */

// How much of the widget must overlap a monitor work area for it to be
// considered reachable by a human. 60×40 px leaves the titlebar grabbable.
export const MIN_VISIBLE_W = 60;
export const MIN_VISIBLE_H = 40;

// Matches the minimum size declared in src-tauri/tauri.conf.json.
export const MIN_WINDOW_W = 280;
export const MIN_WINDOW_H = 400;

// Default dimensions from tauri.conf.json, used when saved size is garbage.
export const DEFAULT_WINDOW_W = 340;
export const DEFAULT_WINDOW_H = 520;

// Coordinate sanity bound: anything beyond ±100000 px is garbage
// (also guards against NaN/Infinity propagation on restart).
const COORD_LIMIT = 100000;

/**
 * A monitor as seen by enumeration, in physical pixels.
 * Bounds may legitimately start at negative coordinates for monitors
 * placed left of / above the primary one.
 * @typedef {{
 *   x: number, y: number, w: number, h: number,
 *   wx: number, wy: number, ww: number, wh: number,
 *   scaleFactor?: number
 * }} MonitorBounds
 */

/**
 * A saved window placement in physical pixels.
 * @typedef {{ x: number, y: number, w: number, h: number }} Placement
 */

/**
 * True if the value is a finite number within tolerance.
 * @param {unknown} v
 */
function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT;
}

/**
 * Pure: is the window rect reachable on at least one monitor's work area,
 * keeping at least MIN_VISIBLE_W×MIN_VISIBLE_H px visible?
 * Returns 'ok' | 'offscreen' | 'invalid'.
 * @param {Placement} rect
 * @param {MonitorBounds[]} monitors
 */
export function rectAccessibility(rect, monitors, minW = MIN_VISIBLE_W, minH = MIN_VISIBLE_H) {
  if (!rect || !finite(rect.x) || !finite(rect.y) ||
      !finite(rect.w) || rect.w <= 0 || !finite(rect.h) || rect.h <= 0) {
    return 'invalid';
  }
  if (!Array.isArray(monitors) || monitors.length === 0) {
    return 'unknown'; // enumeration failed — no basis to judge
  }
  const rx = Math.round(rect.x);
  const ry = Math.round(rect.y);
  const rw = Math.round(rect.w);
  const rh = Math.round(rect.h);
  for (const m of monitors) {
    const overlapW = Math.min(rx + rw, m.wx + m.ww) - Math.max(rx, m.wx);
    const overlapH = Math.min(ry + rh, m.wy + m.wh) - Math.max(ry, m.wy);
    if (overlapW >= minW && overlapH >= minH) return 'ok';
  }
  return 'offscreen';
}

/**
 * Pure: pick the primary-ish monitor. Windows puts the virtual-screen
 * origin at the primary monitor's top-left, so the monitor whose bounds
 * contain (0,0) is primary; otherwise take the largest work area.
 * @param {MonitorBounds[]} monitors
 */
export function primaryMonitor(monitors) {
  if (!Array.isArray(monitors) || monitors.length === 0) return null;
  return (
    monitors.find((m) => m.x <= 0 && m.x + m.w > 0 && m.y <= 0 && m.y + m.h > 0) ||
    monitors.reduce((a, b) => (a.ww * a.wh >= b.ww * b.wh ? a : b))
  );
}

/**
 * Pure: clamp a requested window size into sane limits, then compute a
 * position that keeps the window fully inside `monitor`'s work area
 * (centered when it fits, top-anchored otherwise).
 * @param {{w: number, h: number}} size
 * @param {MonitorBounds} monitor
 * @returns {Placement}
 */
export function placementInMonitor(size, monitor) {
  const w = Math.max(MIN_WINDOW_W, Math.min(Math.round(size.w || DEFAULT_WINDOW_W), monitor.ww));
  const h = Math.max(MIN_WINDOW_H, Math.min(Math.round(size.h || DEFAULT_WINDOW_H), monitor.wh));
  const x = monitor.wx + Math.max(0, Math.round((monitor.ww - w) / 2));
  const y = monitor.wy + Math.max(0, Math.round((monitor.wh - h) / 2));
  return { x, y, w, h };
}

/**
 * Pure: full placement decision for a startup restore.
 *
 * @param {{window_x?: unknown, window_y?: unknown, window_w?: unknown, window_h?: unknown}} saved
 *   Values from storage; historical configs hold mixed units (logical x/y,
 *   physical w/h) — this function never trusts them, it only validates them
 *   against the *current* monitor layout, which is what makes it safe.
 * @param {MonitorBounds[]|null} monitors  null = enumeration failed
 * @param {MonitorBounds|null} [attachedMonitor]
 *   Monitor the webview is currently attached to (fresh, not from storage).
 * @param {{w: number, h: number}} [defaultSize]
 * @returns {{ placement: Placement, repairedPlacement: boolean, repairedSize: boolean, reason: string }}
 */
export function sanitizePlacement(saved, monitors, attachedMonitor, defaultSize) {
  const ds = defaultSize || { w: DEFAULT_WINDOW_W, h: DEFAULT_WINDOW_H };

  // Saved size: salvage what is numeric, replace the rest.
  const sizeInvalid = !finite(saved?.window_w) || saved.window_w <= 0 ||
                      !finite(saved?.window_h) || saved.window_h <= 0;
  const size = {
    w: sizeInvalid ? ds.w : Math.max(MIN_WINDOW_W, Math.min(Math.round(saved.window_w), 20000)),
    h: sizeInvalid ? ds.h : Math.max(MIN_WINDOW_H, Math.min(Math.round(saved.window_h), 20000)),
  };

  /** @type {Placement|null} */
  let placement = null;
  let reason = 'no-saved-placement';

  if (finite(saved?.window_x) && finite(saved?.window_y)) {
    placement = { x: Math.round(saved.window_x), y: Math.round(saved.window_y), w: size.w, h: size.h };
  }

  const accessibility = placement
    ? rectAccessibility(placement, monitors ?? [])
    : (monitors && monitors.length ? 'offscreen' : 'unknown');

  if (accessibility === 'ok') {
    reason = 'restored-as-saved';
  } else if (accessibility === 'unknown') {
    // Monitor enumeration failed: use the webview's own attached monitor
    // as a last resort, else the documented absolute fallback.
    placement = attachedMonitor
      ? placementInMonitor(size, attachedMonitor)
      : { x: 60, y: 60, w: size.w, h: size.h };
    reason = 'monitor-enumeration-failed';
  } else {
    // 'offscreen' or 'invalid': reposition on the primary (or attached) monitor.
    const target = primaryMonitor(monitors ?? []) || attachedMonitor;
    placement = target
      ? placementInMonitor(size, target)
      : { x: 60, y: 60, w: size.w, h: size.h };
    reason = 'offscreen-recovered';
  }

  const repairedPlacement = !!(saved &&
    finite(saved.window_x) && finite(saved.window_y) &&
    (placement.x !== Math.round(saved.window_x) || placement.y !== Math.round(saved.window_y)));
  const repairedSize = !!(sizeInvalid);

  return { placement, repairedPlacement, repairedSize, reason };
}

/* ───────────────────────── Tauri layer (lazy imports) ─────────────────────────
 * Imported dynamically so the pure functions above stay usable under `node
 * --test` without touching browser-only modules (same pattern main.js uses).
 */

/**
 * Enumerate monitors through Tauri in physical pixels.
 * @returns {Promise<MonitorBounds[]|null>} null on failure (logged, not thrown)
 */
export async function listMonitors(appWindow) {
  try {
    // In @tauri-apps/api 2.x these are standalone module functions, not
    // Window methods (`window.availableMonitors` does not exist).
    const { availableMonitors } = await import('@tauri-apps/api/window');
    const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
    const list = await availableMonitors();
    const parsed = list.map((m) => {
      const pos = new PhysicalPosition(m.position);
      const size = new PhysicalSize(m.size);
      const waPos = new PhysicalPosition(m.workArea.position);
      const waSize = new PhysicalSize(m.workArea.size);
      return {
        x: pos.x, y: pos.y, w: size.width, h: size.height,
        wx: waPos.x, wy: waPos.y, ww: waSize.width, wh: waSize.height,
        scaleFactor: m.scaleFactor,
      };
    });
    const filtered = parsed.filter((m) => m.ww > 0 && m.wh > 0);
    try { localStorage.setItem('movewell-placement-debug', JSON.stringify({ t: 'listMonitors-ok', n: filtered.length, raw: parsed.length })); } catch {}
    return filtered;
  } catch (err) {
    console.warn('[windowPlacement] availableMonitors failed:', err);
    try { localStorage.setItem('movewell-placement-debug', JSON.stringify({ t: 'listMonitors-err', err: String(err && err.stack ? err.stack : err) })); } catch {}
    return null;
  }
}

/**
 * The monitor the webview believes it is attached to, physical pixels.
 * @returns {Promise<MonitorBounds|null>}
 */
export async function currentMonitor(appWindow) {
  try {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
    const m = await currentMonitor();
    if (!m) return null;
    const wa = new PhysicalPosition(m.workArea.position);
    const was = new PhysicalSize(m.workArea.size);
    const p = new PhysicalPosition(m.position);
    const s = new PhysicalSize(m.size);
    return {
      x: p.x, y: p.y, w: s.width, h: s.height,
      wx: wa.x, wy: wa.y, ww: was.width, wh: was.height,
      scaleFactor: m.scaleFactor,
    };
  } catch (err) {
    console.warn('[windowPlacement] currentMonitor failed:', err);
    return null;
  }
}

/**
 * Startup: restore the saved placement, repairing it if invalid.
 * Mutates and returns only positioning fields of `cfg` when repaired —
 * timer, sound, topmost and all other settings are never touched here.
 *
 * @param {import('@tauri-apps/api/window').Window} appWindow
 * @param {Record<string, unknown>} cfg
 * @returns {Promise<null | {window_x:number, window_y:number, window_w:number, window_h:number}>}
 */
export async function restoreWindowPlacement(appWindow, cfg) {
  const monitors = await listMonitors(appWindow);
  const attached = await currentMonitor(appWindow);
try { localStorage.setItem('movewell-placement-debug2', JSON.stringify({ t: 'restore', mon: monitors?.length ?? 'null', att: attached ? 'yes' : 'null', oldx: cfg.window_x, oldy: cfg.window_y })); } catch {}
  const { placement, repairedPlacement, repairedSize, reason } = sanitizePlacement(
    cfg, monitors, attached,
  );
  console.info(`[windowPlacement] ${reason}`);
  if (!placement) return null;

  try {
    const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
    // Size first so the final setPosition lands the top-left exactly.
    await appWindow.setSize(new PhysicalSize(placement.w, placement.h));
    await appWindow.setPosition(new PhysicalPosition(placement.x, placement.y));
  } catch (err) {
    console.warn('[windowPlacement] apply placement failed:', err);
    return null;
  }

  return (repairedPlacement || repairedSize)
    ? { window_x: placement.x, window_y: placement.y, window_w: placement.w, window_h: placement.h }
    : null;
}

/**
 * Save the window placement for the next launch, in physical pixels only.
 * Returns 4 repairing fields to persist, or null when nothing changed.
 * @returns {Promise<null | {window_x:number, window_y:number, window_w:number, window_h:number}>}
 */
export async function saveWindowPlacement(appWindow, cfg) {
  try {
    const [pos, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
    const update = {
      window_x: pos.x, window_y: pos.y, window_w: size.width, window_h: size.height,
    };
    const changed = Object.keys(update).some((k) => cfg[k] !== update[k]);
    Object.assign(cfg, update);
    return changed ? update : null;
  } catch (err) {
    console.warn('[windowPlacement] save placement failed:', err);
    return null;
  }
}
