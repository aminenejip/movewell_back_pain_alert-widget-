use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition,
};

fn load_icon() -> Image<'static> {
    let img = image::load_from_memory(include_bytes!("../icons/32x32.png"))
        .expect("failed to load tray icon")
        .to_rgba8();
    let (w, h) = img.dimensions();
    Image::new_owned(img.into_raw(), w, h)
}

/// ─────────────────────────────────────────────────────────────────────────────
/// Off-screen recovery (see docs/MOVEWELL_WIDGET_FIX_REPORT.md)
/// ─────────────────────────────────────────────────────────────────────────────
/// All values are *physical* pixels in virtual-screen space, mirroring the
/// frontend helper in `src/windowPlacement.js`. Monitors may legitimately have
/// negative coordinates — never assume any layout shape here.

/// A monitor's usable (work-area) rectangle, physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// How much of the window must overlap a work area to count as reachable.
/// 60 px of width + 40 px of height keeps the titlebar grabbable.
pub(crate) const MIN_VISIBLE_W: i32 = 60;
pub(crate) const MIN_VISIBLE_H: i32 = 40;

/// Absolute fallback when no monitor information is available at all.
/// Documented choice: (60, 60) is inside the primary work area on virtually
/// every real Windows layout, and keeps the widget grabbable.
pub(crate) const FALLBACK_POSITION: (i32, i32) = (60, 60);

/// Pure: does a window of `size` at `pos` keep at least
/// `MIN_VISIBLE_W × MIN_VISIBLE_H` px within any monitor work area?
/// Corrupted (non-positive / absurd) coordinates or dimensions are garbage
/// and never count as reachable.
pub(crate) fn window_is_reachable(
    monitors: &[WorkArea],
    pos: (i32, i32),
    size: (i32, i32),
) -> bool {
    let (x, y) = pos;
    if pos.0.abs() > 100_000 || pos.1.abs() > 100_000 {
        return false;
    }
    let (w, h) = if size.0 <= 0 || size.1 <= 0
        || size.0.abs() > 100_000 || size.1.abs() > 100_000
    {
        (0, 0)
    } else {
        size
    };
    if w == 0 || h == 0 {
        return false;
    }
    monitors.iter().any(|m| {
        let overlap_w = (x + w).min(m.x + m.w) - x.max(m.x);
        let overlap_h = (y + h).min(m.y + m.h) - y.max(m.y);
        overlap_w >= MIN_VISIBLE_W && overlap_h >= MIN_VISIBLE_H
    })
}

/// Pure: pick a user-visible "primary" work area. The monitor whose bounds
/// contain the virtual-screen origin (0,0) is primary on Windows; else the
/// largest one. Returns None when the list is empty.
pub(crate) fn primary_work_area(monitors: &[WorkArea]) -> Option<&WorkArea> {
    if monitors.is_empty() {
        return None;
    }
    monitors
        .iter()
        .find(|m| m.x <= 0 && m.x + m.w > 0 && m.y <= 0 && m.y + m.h > 0)
        .or_else(|| monitors.iter().max_by_key(|m| m.w as i64 * m.h as i64))
}

/// Pure: position for a window of `size` that stays fully inside `area`
/// (centered when it fits, anchored to the work-area top-left otherwise).
pub(crate) fn position_in_work_area(area: &WorkArea, size: (i32, i32)) -> (i32, i32) {
    let x = area.x + (((area.w - size.0).max(0) / 2) as i32);
    let y = area.y + (((area.h - size.1).max(0) / 2) as i32);
    (x, y)
}

/// Shared recovery: if the main window is unreachable, move it onto the
/// primary monitor before showing + focusing it. Returns true when the
/// window position had to be repaired.
fn ensure_window_visible(window: &tauri::WebviewWindow) -> bool {
    let pos = window
        .outer_position()
        .map(|p| (p.x, p.y))
        .unwrap_or(FALLBACK_POSITION);
    let size = window
        .outer_size()
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or((340, 520)); // tauri.conf.json defaults

    let monitors: Vec<WorkArea> = match window.available_monitors() {
        Ok(list) => list
            .iter()
            .map(|m| {
                let wa = m.work_area();
                WorkArea {
                    x: wa.position.x,
                    y: wa.position.y,
                    w: wa.size.width as i32,
                    h: wa.size.height as i32,
                }
            })
            .filter(|m| m.w > 0 && m.h > 0)
            .collect(),
        Err(err) => {
            eprintln!(
                "[movewell] available_monitors failed: {err} — falling back to ({},{})",
                FALLBACK_POSITION.0, FALLBACK_POSITION.1
            );
            Vec::new()
        }
    };

    if !window_is_reachable(&monitors, pos, size) {
        let restore = match primary_work_area(&monitors) {
            Some(area) => position_in_work_area(area, size),
            // Enumeration failed: documented absolute fallback (logged above).
            None => FALLBACK_POSITION,
        };
        if let Err(err) = window.set_position(PhysicalPosition::new(restore.0, restore.1)) {
            eprintln!("[movewell] set_position failed: {err}");
        } else {
            return true;
        }
    }
    false
}

/// Bring the main window to the foreground: repair its position if needed,
/// then show + focus. Shared by the tray menu "Afficher" and the tray click,
/// so recovery works even when the frontend's saved coordinates are corrupt.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        ensure_window_visible(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(load_icon())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        // "Afficher": recover an off-screen placement, then
                        // show + focus — one shared code path with tray click.
                        "show" => show_main_window(app),
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 125 % DPI primary (1600×864 work area at origin) + a secondary monitor
    /// arranged above-left at negative coordinates.
    fn monitors_125pct_secondary_above() -> Vec<WorkArea> {
        vec![
            WorkArea { x: 0, y: 0, w: 1600, h: 864 },
            WorkArea { x: -1600, y: -864, w: 1920, h: 1040 },
        ]
    }

    #[test]
    fn normal_position_is_reachable() {
        let m = monitors_125pct_secondary_above();
        assert!(window_is_reachable(&m, (100, 100), (340, 520)));
    }

    #[test]
    fn completely_offscreen_above_is_not_reachable() {
        // The exact coordinates observed in the live bug: (1057, -594).
        let m = monitors_125pct_secondary_above();
        assert!(!window_is_reachable(&m, (1057, -594), (345, 467)));
    }

    #[test]
    fn negative_x_on_valid_secondary_monitor_is_reachable() {
        let m = monitors_125pct_secondary_above();
        // Window placed on the left-arranged secondary monitor (negative X):
        // valid placement, must NOT be "repaired".
        assert!(window_is_reachable(&m, (-1200, -400), (340, 520)));
    }

    #[test]
    fn disconnected_secondary_monitor_falls_back_to_primary() {
        // Only the primary is left after the secondary was unplugged.
        let only = vec![WorkArea { x: 0, y: 0, w: 1600, h: 864 }];
        // Window coords that historically lived on the unplugged monitor.
        assert!(!window_is_reachable(&only, (-1400, -800), (340, 520)));
        let target = primary_work_area(&only).unwrap();
        let (x, y) = position_in_work_area(target, (340, 520));
        assert!(window_is_reachable(&only, (x, y), (340, 520)));
        assert_eq!((x, y), (630, 172)); // centered on the primary work area
    }

    #[test]
    fn dpi_100_percent_layout() {
        let m = vec![WorkArea { x: 0, y: 0, w: 1920, h: 1040 }];
        assert!(window_is_reachable(&m, (790, 260), (340, 520)));
        let (x, y) = position_in_work_area(&m[0], (340, 520));
        assert_eq!((x, y), (790, 260));
    }

    /// The user's actual setup: 1920×1080 primary at 125 % and a 1280×960
    /// secondary at 1920,118. All repair targets must land on-screen.
    fn monitors_user_layout_125pct() -> Vec<WorkArea> {
        vec![
            WorkArea { x: 0, y: 0, w: 1920, h: 1040 },
            WorkArea { x: 2400, y: 148, w: 1280, h: 960 },
        ]
    }

    #[test]
    fn dpi_125_percent_user_layout_repairs_offscreen_widget() {
        let m = monitors_user_layout_125pct();
        // Persisted near-boundary placement: only its bottom 652 px are
        // visible, i.e. it IS reachable — kept as-is (no forced repair).
        assert!(window_is_reachable(&m, (1196, -7), (443, 659)));
        // The fully off-screen runtime rect that broke the widget.
        assert!(!window_is_reachable(&m, (1057, -594), (345, 467)));
        let (x, y) = position_in_work_area(primary_work_area(&m).unwrap(), (345, 467));
        assert!(window_is_reachable(&m, (x, y), (345, 467)));
    }

    #[test]
    fn dpi_150_percent_scaled_work_area() {
        // 2560×1440 physical at 150 % → ~1706×960 physical work area reported.
        let m = vec![WorkArea { x: 0, y: 0, w: 1706, h: 960 }];
        assert!(window_is_reachable(&m, (683, 220), (340, 520)));
        let (x, y) = position_in_work_area(&m[0], (340, 520));
        assert_eq!((x, y), (683, 220));
    }

    #[test]
    fn partially_visible_window_still_reachable() {
        let m = monitors_user_layout_125pct();
        // 61 px visible horizontally → keep as-is (no drift for edge dwellers).
        assert!(window_is_reachable(&m, (-279, 0), (340, 520)));
        // 35 px visible horizontally → below MIN_VISIBLE_W → must be repaired.
        assert!(!window_is_reachable(&m, (-305, 0), (340, 520)));
    }

    #[test]
    fn corrupted_dimensions_never_count_as_reachable() {
        let m = monitors_user_layout_125pct();
        assert!(!window_is_reachable(&m, (100, 100), (0, 0)));
        assert!(!window_is_reachable(&m, (100, 100), (-340, 520)));
        assert!(!window_is_reachable(&m, (i32::MAX, 0), (340, 520)));
    }

    #[test]
    fn empty_monitor_list_is_never_reachable() {
        assert!(!window_is_reachable(&[], (100, 100), (340, 520)));
        assert_eq!(primary_work_area(&[]), None);
        // And the fallback keeps the window at a grabbable position.
        assert_eq!(FALLBACK_POSITION, (60, 60));
    }

    #[test]
    fn repeated_restarts_do_not_drift() {
        // Simulates close→relaunch round-trips: a placement that is reachable
        // is returned unchanged by position_in_work_area-free logic (i.e. it
        // passes the reachability gate every time, so nothing is rewritten).
        let m = monitors_user_layout_125pct();
        let saved = (790, 260);
        for _ in 0..5 {
            assert!(window_is_reachable(&m, saved, (340, 520)));
        }
    }
}
