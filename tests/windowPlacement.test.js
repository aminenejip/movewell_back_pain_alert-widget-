/**
 * Regression tests for src/windowPlacement.js (pure placement logic).
 * Run with: node --test tests/windowPlacement.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rectAccessibility,
  primaryMonitor,
  placementInMonitor,
  sanitizePlacement,
  MIN_VISIBLE_W,
  MIN_VISIBLE_H,
  MIN_WINDOW_W,
  MIN_WINDOW_H,
  DEFAULT_WINDOW_W,
  DEFAULT_WINDOW_H,
} from '../src/windowPlacement.js';

// ── Fixtures ────────────────────────────────────────────────────────────────
// The user's live layout: 1920×1080 primary at 125 % scale
// (work area 1920×1040 physical) + a 1280×960 secondary at (1920,118).
const USER_MONITORS = [
  { x: 0, y: 0, w: 1920, h: 1080, wx: 0, wy: 0, ww: 1920, wh: 1040, scaleFactor: 1.25 },
  { x: 1920, y: 118, w: 1280, h: 960, wx: 1920, wy: 118, ww: 1280, wh: 960, scaleFactor: 1 },
];

// Secondary monitor arranged above-left with negative coordinates.
const LEFT_SECONDARY = [
  { x: 0, y: 0, w: 1920, h: 1080, wx: 0, wy: 0, ww: 1920, wh: 1040, scaleFactor: 1 },
  { x: -1920, y: -864, w: 1920, h: 1080, wx: -1920, wy: -864, ww: 1920, wh: 1040, scaleFactor: 1 },
];

// ── rectAccessibility ───────────────────────────────────────────────────────

test('normal window position is accessible', () => {
  assert.equal(rectAccessibility({ x: 790, y: 260, w: 340, h: 520 }, USER_MONITORS), 'ok');
});

test('Y = -594, completely off-screen above every monitor → offscreen', () => {
  // The exact live-failure coordinates from the diagnostic.
  assert.equal(rectAccessibility({ x: 1057, y: -594, w: 345, h: 467 }, USER_MONITORS), 'offscreen');
});

test('negative X on a valid left-arranged secondary monitor → ok (preserved)', () => {
  assert.equal(rectAccessibility({ x: -1200, y: -400, w: 340, h: 520 }, LEFT_SECONDARY), 'ok');
});

test('disconnected secondary monitor: legacy coords → offscreen, then repaired path is accessible', () => {
  const only = [USER_MONITORS[0]];
  assert.equal(rectAccessibility({ x: -1200, y: -400, w: 340, h: 520 }, only), 'offscreen');
  const fixed = placementInMonitor({ w: 340, h: 520 }, primaryMonitor(only));
  assert.equal(rectAccessibility(fixed, only), 'ok');
});

test('rect straddling two monitors is accessible', () => {
  assert.equal(rectAccessibility({ x: 1750, y: 300, w: 340, h: 520 }, USER_MONITORS), 'ok');
});

test('non-finite / garbage coordinates are invalid', () => {
  assert.equal(rectAccessibility({ x: NaN, y: 0, w: 340, h: 520 }, USER_MONITORS), 'invalid');
  assert.equal(rectAccessibility({ x: Infinity, y: 0, w: 340, h: 520 }, USER_MONITORS), 'invalid');
  assert.equal(rectAccessibility({ x: 0, y: 0, w: 0, h: 0 }, USER_MONITORS), 'invalid');
  assert.equal(rectAccessibility(null, USER_MONITORS), 'invalid');
});

test('unknown when monitor enumeration fails (returns null)', () => {
  assert.equal(rectAccessibility({ x: 100, y: 100, w: 340, h: 520 }, null), 'unknown');
  assert.equal(rectAccessibility({ x: 100, y: 100, w: 340, h: 520 }, []), 'unknown');
});

// ── primaryMonitor ──────────────────────────────────────────────────────────

test('primary monitor detection: contains (0,0) origin even when not first/largest', () => {
  const m = [
    { x: -1920, y: -864, w: 1920, h: 1080, wx: -1920, wy: -864, ww: 1920, wh: 1040 },
    { x: 0, y: 0, w: 1280, h: 960, wx: 0, wy: 0, ww: 1280, wh: 920 },
  ];
  assert.equal(primaryMonitor(m), m[1]);
});

test('primary monitor detection falls back to largest work area when origin is absent', () => {
  const m = [
    { x: 500, y: 500, w: 800, h: 600, wx: 500, wy: 500, ww: 800, wh: 600 },
    { x: 1400, y: 0, w: 1920, h: 1080, wx: 1400, wy: 0, ww: 1920, wh: 1040 },
  ];
  assert.equal(primaryMonitor(m), m[1]);
});

test('primary monitor detection returns null for empty list', () => {
  assert.equal(primaryMonitor([]), null);
  assert.equal(primaryMonitor(null), null);
});

// ── placementInMonitor ──────────────────────────────────────────────────────

test('repair centers window inside work area (DPI 100 %)', () => {
  const m = { x: 0, y: 0, w: 1920, h: 1040, wx: 0, wy: 0, ww: 1920, wh: 1040 };
  assert.deepEqual(placementInMonitor({ w: 340, h: 520 }, m), { x: 790, y: 260, w: 340, h: 520 });
});

test('repair on 125 % scaled primary (physical work area 1920×1040)', () => {
  const m = USER_MONITORS[0];
  const p = placementInMonitor({ w: 443, h: 659 }, m);
  assert.deepEqual(p, { x: 739, y: 191, w: 443, h: 659 });
  assert.equal(rectAccessibility(p, USER_MONITORS), 'ok');
});

test('repair on 150 % scaled monitor clamps oversized windows to the work area', () => {
  // 2560×1440 at 150 % → logical work area ≈ 1706×960 physical px reported.
  const m = { x: 0, y: 0, w: 1706, h: 960, wx: 0, wy: 0, ww: 1706, wh: 930, scaleFactor: 1.5 };
  const p = placementInMonitor({ w: 2200, h: 1400 }, m);
  assert.equal(p.w, 1706);
  assert.equal(p.h, 930);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
  assert.equal(rectAccessibility(p, [m]), 'ok');
});

test('repair respects monitor with non-zero origin (taskbar, second monitor)', () => {
  const m = USER_MONITORS[1]; // starts at (1920,118)
  const p = placementInMonitor({ w: 340, h: 520 }, m);
  assert.deepEqual(p, { x: 2390, y: 338, w: 340, h: 520 });
  assert.equal(rectAccessibility(p, USER_MONITORS), 'ok');
});

// ── sanitizePlacement ───────────────────────────────────────────────────────

test('valid saved placement is restored exactly as saved (no drift)', () => {
  const cfg = { window_x: 790, window_y: 260, window_w: 345, window_h: 467 };
  const r = sanitizePlacement(cfg, USER_MONITORS, null);
  assert.equal(r.reason, 'restored-as-saved');
  assert.deepEqual(r.placement, { x: 790, y: 260, w: 345, h: 467 });
  assert.equal(r.repairedPlacement, false);
  assert.equal(r.repairedSize, false);
});

test('completely off-screen Y = -594 placement is repaired onto the primary monitor', () => {
  const cfg = { window_x: 1057, window_y: -594, window_w: 345, window_h: 467 };
  const r = sanitizePlacement(cfg, USER_MONITORS, null);
  assert.equal(r.reason, 'offscreen-recovered');
  assert.equal(r.repairedPlacement, true);
  assert.equal(rectAccessibility(r.placement, USER_MONITORS), 'ok');
});

test('corrupted localStorage (strings / NaN / non-numeric) is repaired safely', () => {
  const cfg = { window_x: 'garbage', window_y: null, window_w: NaN, window_h: '400px' };
  const r = sanitizePlacement(cfg, USER_MONITORS, null);
  assert.equal(r.reason, 'offscreen-recovered');
  assert.equal(r.repairedSize, true);
  assert.ok(Number.isFinite(r.placement.x) && Number.isFinite(r.placement.y));
  assert.ok(r.placement.w >= MIN_WINDOW_W && r.placement.h >= MIN_WINDOW_H);
  assert.equal(rectAccessibility(r.placement, USER_MONITORS), 'ok');
});

test('invalid saved dimensions fall back to default size but keep valid position', () => {
  const cfg = { window_x: 100, window_y: 100, window_w: -5, window_h: 0 };
  const r = sanitizePlacement(cfg, USER_MONITORS, null);
  assert.equal(r.repairedSize, true);
  assert.equal(r.repairedPlacement, false); // x/y untouched — they were valid
  assert.equal(r.placement.w, DEFAULT_WINDOW_W);
  assert.equal(r.placement.h, DEFAULT_WINDOW_H);
  assert.deepEqual([r.placement.x, r.placement.y], [100, 100]);
});

test('no saved placement at all → safe default placement on primary', () => {
  const r = sanitizePlacement({}, USER_MONITORS, null);
  assert.equal(r.reason, 'offscreen-recovered');
  const m = primaryMonitor(USER_MONITORS);
  assert.deepEqual(r.placement, { ...placementInMonitor({ w: DEFAULT_WINDOW_W, h: DEFAULT_WINDOW_H }, m) });
});

test('monitor enumeration failure: falls back to attached monitor, never crashes', () => {
  const cfg = {
    window_x: 1057, window_y: -594, window_w: 345, window_h: 467,
    interval_minutes: 30, // must not be touched
  };
  const attached = { x: 0, y: 0, w: 1920, h: 1080, wx: 0, wy: 0, ww: 1920, wh: 1040 };
  const r = sanitizePlacement(cfg, null, attached);
  assert.equal(r.reason, 'monitor-enumeration-failed');
  assert.equal(rectAccessibility(r.placement, [attached]), 'ok');
  assert.equal(cfg.interval_minutes, 30); // unrelated cfg fields preserved
});

test('monitor enumeration failure with no attached monitor: documented absolute fallback', () => {
  const r = sanitizePlacement({ window_x: 1057, window_y: -594, window_w: 345, window_h: 467 }, null, null);
  assert.equal(r.reason, 'monitor-enumeration-failed');
  assert.deepEqual([r.placement.x, r.placement.y], [60, 60]);
});

test('window partially visible (35 px) is repaired; (61 px) is left alone', () => {
  // 35 px horizontal overlap with the primary → below MIN_VISIBLE_W → repair.
  const halfHanging = { window_x: -305, window_y: 0, window_w: 340, window_h: 520 };
  const r1 = sanitizePlacement(halfHanging, USER_MONITORS, null);
  assert.equal(r1.reason, 'offscreen-recovered');
  assert.equal(r1.repairedPlacement, true);

  // 61 px visible → reachable → restore as saved, no drift.
  const mostlyVisible = { window_x: -279, window_y: 0, window_w: 340, window_h: 520 };
  const r2 = sanitizePlacement(mostlyVisible, USER_MONITORS, null);
  assert.equal(r2.reason, 'restored-as-saved');
  assert.equal(r2.repairedPlacement, false);
});

test('idempotency: repeated sanitize of a repaired placement changes nothing', () => {
  const bad = { window_x: 1057, window_y: -594, window_w: 345, window_h: 467 };
  const r1 = sanitizePlacement(bad, USER_MONITORS, null);
  const repaired = { window_x: r1.placement.x, window_y: r1.placement.y,
                     window_w: r1.placement.w, window_h: r1.placement.h };
  const r2 = sanitizePlacement(repaired, USER_MONITORS, null);
  assert.equal(r2.reason, 'restored-as-saved');
  assert.equal(r2.repairedPlacement, false);
  assert.equal(r2.repairedSize, false);
  assert.deepEqual(r2.placement, r1.placement);
});

test('simulated restart sequence ×5 causes zero positional drift', () => {
  // Each "restart" validates the previously saved (possibly repaired)
  // placement against the same monitor layout — coordinates must be stable.
  let cfg = { window_x: 1057, window_y: -594, window_w: 345, window_h: 467 };
  let first = null;
  for (let i = 0; i < 5; i++) {
    const r = sanitizePlacement(cfg, USER_MONITORS, null);
    cfg = { window_x: r.placement.x, window_y: r.placement.y, window_w: r.placement.w, window_h: r.placement.h };
    if (first === null) first = cfg;
    assert.deepEqual(cfg, first, 'placement changed between restarts');
  }
});

test('tray-recovery parity with Rust thresholds: same constants', () => {
  // Rust side uses MIN_VISIBLE_W=60, MIN_VISIBLE_H=40 — mirrored here.
  assert.equal(MIN_VISIBLE_W, 60);
  assert.equal(MIN_VISIBLE_H, 40);
  assert.equal(MIN_WINDOW_W, 280);
  assert.equal(MIN_WINDOW_H, 400);
});
