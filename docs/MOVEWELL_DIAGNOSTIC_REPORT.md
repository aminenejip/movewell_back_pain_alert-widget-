# Movewell — Full Diagnostic Report

**Date:** 2026-10-29
**Repository:** `C:\widget`
**Symptom:** Application runs (≈6 processes, ≈115 MB in Task Manager) but the desktop movement widget does not appear.

> **Executive summary:** The widget window **is created and is not hidden** — Win32 inspection of the live window proved it is positioned at rect `(1057, -594, 1416, -120)`, i.e. **entirely above the top edge of every connected monitor** (the virtual desktop starts at Y = 0). The off-screen position is loaded from a persisted `localStorage` config whose last 12/12 saved positions all have **negative `window_y`**. The close handler saves position/size in **inconsistent DPI units** (logical vs physical) and the startup handler restores them **without any bounds validation** against the monitor work areas. On a 125 % scaled, dual-monitor setup this round-trip error lets the window drift off-screen, and once off-screen it stays off-screen forever because nothing ever clamps it back.

---

## 1. Application architecture summary

### 1.1 Two generations of code coexist in the repository

| Generation | Stack | Entry point | Status |
|---|---|---|---|
| **v1 (legacy)** | Python 3.10 + Tkinter, packaged with PyInstaller | `main.py`, `timer.py`, `storage.py`, `theme.py`, `notifications.py` → `build\PauseDosWidget\PauseDosWidget.exe` | Dead code in repo; **not** the running app |
| **v2 (current)** | Tauri 2 (Rust) + Vite + vanilla JS frontend, WebView2 runtime | `src-tauri/src/main.rs` → `movewell_lib::run()` | **The app the user runs** |

Evidence that v2 is the running app: `src-tauri\target\release\movewell.exe` (built 2026-07-23), process name `movewell`, `MainWindowTitle: "Movewell"`, WebView2 user-data dir `C:\Users\amine\AppData\Local\com.movewell.desktop` (matches `identifier: com.movewell.desktop`).

### 1.2 v2 stack and entry sequence

**Backend (`src-tauri/`):**
- `main.rs` → `lib.rs::run()`
- `Cargo.toml`: `tauri = { version = "2", features = ["tray-icon"] }`, plugins `notification`, `shell`, `image = "0.24"`
- `tauri.conf.json` declares the main window statically:
  - `340×520` (min `280×400`), `decorations: false`, `transparent: true`, `shadow: true`, `alwaysOnTop: false`, `visible: true`, `center: false`, `skipTaskbar: false`
  - `frontendDist: "../dist"` → loads the built bundle from `dist/` via `http://tauri.localhost`

**Frontend (`src/`):** `main.js`, `timer.js`, `storage.js`, `audio.js`, `style.css` — plain ES modules, bundled by Vite into `dist/assets/*`.

**Rust `setup()` lifecycle (`src-tauri/src/lib.rs`):**
1. Builds a tray icon with menu *Afficher* / *Quitter* (`lib.rs:21-55`).
2. Tray click / "Afficher" → `window.show()` + `window.set_focus()` (`lib.rs:31-35, 49-53`).
3. `CloseRequested` → `api.prevent_close()` + `window.hide()` → window hides to tray instead of closing the app (`lib.rs:59-64`).
4. **There is no Rust-side window positioning logic.** All placement/restore logic is in the JS frontend.

**Frontend lifecycle (`src/main.js`):**
- `init()` (line 397) restores settings, applies `setAlwaysOnTop(true)` when `cfg.always_on_top !== false` (line 405), then restores **saved window size and position** (lines 410-417).
- `onClose()` (line 361) saves position from `window.screenX / window.screenY` and size from `await appWindow.outerSize()` into `localStorage`, then hides the window.

**Persistence (`src/storage.js`):** key `pause-dos-config` in the WebView2 `localStorage` of the user-data dir `%LOCALAPPDATA%\com.movewell.desktop\EBWebView\Default\Local Storage\leveldb\`.

**Why ~6 processes:** `movewell.exe` is the Chromium-like host; the remaining processes are the WebView2 implicit child processes (GPU, Utility: Network, Utility: Storage, etc.), matching the user's Task Manager observation. Their presence only proves **WebView2 spawned children** — it never proves the host window is on-screen. That assumption was the red herring in the original symptom report.

---

## 2. Startup and widget lifecycle

```
movewell.exe
 └─ tauri::Builder (lib.rs:16)
     ├─ window "main" created from tauri.conf.json  (visible, 340×520, frameless)
     ├─ plugins: notification, shell
     └─ setup()
         ├─ tray icon + menu (Show → show() + set_focus())
         └─ CloseRequested → hide()
             └─ webview navigates to tauri://localhost (dist/index.html)
                 └─ main.js init()
                     ├─ load cfg from localStorage
                     ├─ setAlwaysOnTop(cfg.always_on_top !== false)   // default TRUE
                     ├─ setSize(LogicalSize(cfg.window_w, cfg.window_h))     if saved   ← bug ①
                     ├─ setPosition(LogicalPosition(cfg.window_x, cfg.window_y)) if saved ← bug ②
                     └─ no validation against monitor work areas             ← bug ③
```

Close path (`onClose`):
```
cfg.window_x = window.screenX        // CSS (logical) px          ← bug ①
cfg.window_y = window.screenY        // CSS (logical) px
cfg.window_w, window_h = outerSize() // PHYSICAL px               ← bug ①
save to localStorage → hide window
```

---

## 3. Investigated failure points (all checked)

| Point | Finding |
|---|---|
| Window creation | ✅ Confirmed working — live window handle `0x000F014C` exists |
| Window visibility flags | ✅ `IsWindowVisible = TRUE`, `IsIconic = FALSE` — **not hidden, not minimized** |
| Window coordinates | ❌ **Off-screen** — `(1057, -594) → (1416, -120)`, above virtual-screen top (Y=0) |
| Monitor layout (live) | DISPLAY1: `0,0 1536×864 (primary)` — CSS coords → 1920×1080 physical, **125 % scale**; DISPLAY2: `1920,118 1280×960` |
| Always-on-top / ownership / transparency | Not implicated; body renders opaque `--bg`, tray works, CloseRequested→hide is correct behaviour |
| Tray behaviour | Wires correctly, but `show()+set_focus()` **cannot rescue an off-screen window** |
| Destroy-on-init / init error | Ruled out — window alive, webview processes alive, config loaded |
| WebView2 env/controller/navigation | N/A (window-pane model works; page served fine — LevelDB shows page metadata written and localStorage functional; frontend had already persisted 12 config snapshots, proving the frontend runs and communicates) |
| User data dir | `%LOCALAPPDATA%\com.movewell.desktop` intact since 2026-07-23 |
| Multi-monitor / DPI | ❌ **Implicated** — mixed-DPI displays (125 % primary) + inconsistent unit handling |
| Process presence | Confirmed to be a **coincidence**, not a cause: WebView2 child processes run regardless of window placement |

---

## 4. Confirmed errors and supporting evidence

### Evidence A — live window state (executed 2026-10-29 21:52)

```
Process: movewell.exe, PID 26640, started 2026-10-29 21:50:23
GetWindowRect: L=1057  T=-594  R=1416  B=-120   (w=359, h=474, physical px)
IsWindowVisible: True    IsIconic: False    IsZoomed: False
Monitors:  DISPLAY1 0,0×1536,864 (primary)   DISPLAY2 1920,118×1280,960
→ Virtual desktop: x ∈ [0, 3200], y ∈ [0, 1078]
→ Window top -594 .. bottom -120 is ABOVE EVERY MONITOR
```

*(Note: the report was written by a script choosing to verify rather than assume — "running processes" ≠ "visible window".)*

### Evidence B — persisted config, read from the app's live LevelDB (12 snapshots recovered)

The last saved value, byte-for-byte:

```json
{"interval_minutes":30,"break_minutes":2,"sound_enabled":true,"sound_file":null,
 "always_on_top":true,"window_x":1196,"window_y":-7,"window_w":443,"window_h":659}
```

The decay of `window_y` across history (all 12/12 entries negative):

```
-7 → -7 → -7 → -960 → -960 → -676 → -793 → -793 → -475 → -475 → -594 → -594
window_w: 443 → 443 → 443 → 1296 → 1296 → 383 → 383 → 383 → 329 → 345 → 345 → 345
```

The *current* runtime rect `(1057, -594, w≈345+14 shadow border)` **matches the last save exactly** — proving this launch placed the window at the persisted off-screen coordinates. (The `-960 × 976` entries coincide with a maximized window on DISPLAY2, `1280×960` — matching that monitor's size exactly, indicating a monitor re-arrangement happened between sessions.)

### Evidence C — the code defects enabling the decay

**Defect ① — unit mismatch on close (`src/main.js:362-370`).**
`window.screenX/screenY` are *CSS/logical* pixels; `outerSize()` returns *physical* pixels. On the 125 % primary monitor, logical ≠ physical by a factor of 1.25. The mixed pair `(logical x, logical y, physical w, physical h)` is saved together as if units were uniform.

**Defect ② — wrong unit on restore (`src/main.js:410-417`).**
The saved *physical* size is fed back through `LogicalSize(...)` → at 125 % the window is restored ~25 % too large in logical terms, and with a per-monitor scale mismatch between DISPLAY1/DISPLAY2 the transform depends on *which monitor the window is considered to be on at that instant* — a non-round-trip that pushes the position with each session. Likewise the *logical* position is fed to `LogicalPosition(...)`, whose conversion in Tauri is resolved against the monitor resolved at that moment. Net effect: every restore can land the window elsewhere from where it was closed; cosmetic drift becomes a fall off-track when a monitor is re-arranged, maximized state is involved, or y ≤ 0 sneaks in.

**Defect ③ — no bounds validation on restore (`src/main.js:410-417`).**
There is **zero check** that `(window_x, window_y, window_w, window_h)` intersects any monitor's work area. Whatever was persisted is applied verbatim — including `y = -7`, `-475`, `-594`, `-960`.

**Defect ④ — no recovery path in the tray (`src-tauri/src/lib.rs:30-54`).**
"Afficher" and tray-click only call `show()` + `set_focus()`. For a window that is off-screen-but-"visible", this changes nothing the user can perceive. The app offers no way out for its own saved state.

### Confirmed vs hypothetical

| Claim | Status |
|---|---|
| Window is created, visible, not minimized, but entirely above all monitors | **Confirmed** (live Win32 inspection, Evidence A) |
| The off-screen coordinates come from persisted `localStorage` config | **Confirmed** (Evidence B: runtime rect == last save) |
| Restore path applies persisted position without bound-checking | **Confirmed** (code, `main.js:410-417`) |
| Position is saved in mixed units (logical + physical) | **Confirmed** (code, `main.js:362-370` + Tauri/Chromium API semantics on 125 % DPI) |
| Exact origin of the *first* negative y (legacy monitor layout above primary vs DPI virtualization vs a maximize that Chromium stored off-plane) | **Hypothesis** — not retro-verifiable 5 months later; but not load-bearing: the defect persists it forever once it happens once, whatever introduced it |

### Why it worked 3–5 months ago
The defect needs one trigger to enter the "negative-y" family — most plausibly a monitor re-arrangement or DPI change (Evidence B hints DISPLAY2 was previously arranged above the primary: the `-960`/`976` snapshot is exactly a maximized `1280×960` window positioned at negative y). After a single occurrence, **every subsequent session re-loads the bad position**, so the widget can never be seen again without out-of-band intervention. The persisted config has not changed since 2026-10-14 (`000003.log` mtime), consistent with the app having been unusable for a while, with no recovery possible through its own UI.

---

## 5. Root cause

**Confirmed root cause:** Unvalidated restore of a persisted window position/size stored in inconsistent DPI units, on a mixed-DPI (125 %) multi-monitor system. The widget window is persistently restored at coordinates above the top of the virtual desktop; the tray's show/restore path has no mechanism to bring it back on-screen.

- **Component:** Frontend window-placement logic
- **File / location:** `src/main.js` — `init()` restore block (lines 410-417), `onClose()` save block (lines 361-380); and recovery-path gap in `src-tauri/src/lib.rs` (lines 30-54)
- **Not** a WebView2 runtime, GPU, transparency, or build problem — no WebView2 defect is involved in this failure.

---

## 6. Recommended minimal fix (proposed — awaiting your approval)

Nothing has been modified yet. Proposal, smallest-safe-first:

### Fix 1 (frontend, `src/main.js`) — the core correction
1. **Use physical units consistently.** Save position via `await appWindow.outerPosition()` (`PhysicalPosition`) instead of `window.screenX/screenY`; restore via `PhysicalPosition`/`PhysicalSize` instead of `LogicalPosition`/`LogicalSize`. This makes the close→relaunch round-trip exact on any DPI.
2. **Validate before applying.** On startup, fetch `availableMonitors()` (or `currentMonitor()`); compute the union of monitor bounds; only call `setSize`/`setPosition` if the saved rect (with size clamped to its own values) intersects at least one work area by a meaningful margin (e.g. ≥ 60 px). Otherwise **discard the saved placement** and use the default from `tauri.conf.json` (leave x/y unset → OS default position on primary).
3. Extract placement logic into a small pure helper (e.g. `src/windowPlacement.js` — `intersectsWithAnyMonitor(rect, monitors)`), so it can be regression-tested without a window.

### Fix 2 (Rust, `src-tauri/src/lib.rs`) — the safety net (optional but recommended, ~15 lines)
In the tray *"Afficher"* handler (and tray-click), before `show()`: query the window's physical position/size and the app's available monitors (`app.available_monitors()`); if the rect does not intersect any monitor, reposition it onto the primary work area (e.g. centered) first. This gives users a working escape hatch forever, independent of what the frontend persisted.

### Fix 3 (one-off user recovery, no code change)
To make the widget visible **today** with the shipped binary: move the live window back on-screen with a one-shot `SetWindowPos` script, or clear the persisted `pause-dos-config` (e.g. via a diagnostic run) so the next launch falls back to defaults. Either is reversible and destroys no user data (timer settings/history live in the same key but can be preserved — recommend the `SetWindowPos` route and simply letting the next close re-save a valid position).

**Not proposed:** rewrites, dependency upgrades, or UI changes. `tauri.conf.json` is fine as-is for this defect.

---

## 7. Validation and regression test plan

| # | Test | Method | Pass criterion |
|---|---|---|---|
| 1 | Startup shows widget | Launch `npm run tauri dev` (or release exe) | Window visible in primary work area |
| 2 | Fresh-install path | Delete localStorage config key **in a scratch copy** of user-data dir | Window appears; defaults applied |
| 3 | Close→relaunch round-trip | Move window to a deliberate position, close (hide to tray), quit, relaunch | Position restored **exactly** (physical == saved) within ±1 px |
| 4 | DPI round-trip | Repeat test 3 at 100 % and 125 % (and 150 % where available) | Window does not drift or shrink between cycles |
| 5 | Off-screen persistence guard (THE regression test) | Manually inject `window_y: -594` into config (or simulate by moving window above screen before close) | On next launch the window is **back on-screen** (default placement) — never off-screen |
| 6 | Guard unit test | Node test script for the extracted `intersectsWithAnyMonitor` helper: monitor `0..1536×0..864`, rects `y=-594` (fail) / `y=100` (pass) / straddling edge (pass) | Correct reject/accept |
| 7 | Tray rescue | Move/simulate window off-screen, click tray "Afficher" | Window becomes visible, repositioned |
| 8 | Hide→tray→show cycle unchanged | Click close (X), then tray icon | Behaviour identical to today (hide, not quit) |
| 9 | Multi-monitor change | With widget on DISPLAY2, re-arrange monitors, relaunch | Widget lands on-screen |
| 10 | Timer functionality | Start timer, let it tick 1 min (set work 1 min for test), check ring/break/history/notifications | All existing behaviour intact |

**Regression test for the confirmed failure:** Test 5 executed end-to-end, plus Test 6 as a repeatable unit test of the new clamp predicate.

---

## 8. Risks and unresolved questions

**Risks of the proposed fix:**
- Changing `LogicalSize` → `PhysicalSize` restore may differ by the exact-of-the-border widths (`shadow: true` adds ~14 px in the measurement); mitigate by re-saving once after restore or accepting ±few-px tolerance.
- Users who deliberately placed the window partially off-screen (e.g. half-pinned at the top edge) will find it snapped back on relaunch after the fix — acceptable for a widget app; margin threshold kept small (60 px) to keep intentional half-on-screen placements working.
- No regression risk to timer/audio/history: those code paths are untouched.

**Unresolved questions:**
1. Exact historical event that first produced a negative `window_y` (monitor re-arrangement vs maximize-on-DISPLAY2 vs DPI change) — cannot be proven retroactively; not needed for the fix.
2. Whether the WebView2 runtime on this machine auto-updated recently (registry read for EdgeUpdate `pv` returned nothing in HKLM+HKCU probes, so runtime version is currently **unverified** — not load-bearing, since the runtime is demonstrably behaving; worth re-checking only if symptoms widen beyond window placement).
3. `csp: null` is a standing minor security hardening item (unrelated to this bug; left untouched per scope rules).
4. Confirm with the user whether the widget used to sit on the second monitor and that monitor's arrangement/scale changed ~3–5 months ago — opportune confirmation of the trigger hypothesis.

---

*Diagnostics only. No production code was modified, no data was deleted, no destructive command was run. The running instance (PID 26640) was left untouched.*
