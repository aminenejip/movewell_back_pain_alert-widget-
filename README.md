<div align="center">

  <img src="public/movewelle screen.png" alt="movewelle screen" width="500"/>

# Movewell

> A lightweight, always-available desktop widget that reminds you to take care of your back — work / break cycles with a clean animated countdown ring.

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/JS-Vanilla-F7DF1E?logo=javascript&logoColor=black">
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows11&logoColor=white">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg">
</p>
</div>

## What is Movewell?

Sitting for hours hurts your back. Movewell lives quietly on your desktop and runs a simple cycle:

1. **Work** — a countdown ring shows your remaining work time (default: 30 min).
2. **Break alert** — when the ring completes, a toast notification pops up and a sound plays: *time to stand up and stretch*.
3. **Break** — a short orange/green countdown (default: 2 min).
4. Repeat — and a small counter tracks how many breaks you took today.

The window is a small frameless, always-on-top widget (340×520) that hides to the **system tray** when you close it, and can be reopened by clicking the tray icon.

## Features

- ⏱️ **Configurable work/break cycle** — work 1–180 min, break 1/2/3/5/10 min
- 💍 **Animated countdown ring** with glow and pulse, drawn on `<canvas>`
- 🔔 **Windows toast notifications** + custom sound support (drop `.mp3`/`.wav` files in `public/sounds/`)
- 📌 **Always-on-top** toggle so the widget stays visible over other windows
- 🪟 **Frameless, draggable window** — remember its size and position between sessions
- 🩹 **Off-screen recovery** — a saved position outside any monitor work area is automatically repaired (multi-monitor and 100/125/150 % DPI safe, with unit tests)
- 📊 **Daily break history** — see how many pauses you took today
- 🖥️ **System tray integration** — close to tray, restore from tray, quit from tray
- 🌐 **Persists settings locally** — no account, no telemetry

## Tech stack

| Layer | Technology |
|---|---|
| Backend / shell | [Tauri 2](https://tauri.app) (Rust) |
| UI | Vanilla JavaScript (ES modules) + CSS |
| Bundler | [Vite](https://vite.dev) |
| Notifications | `tauri-plugin-notification` |
| Packaging | MSI (WiX) + NSIS installers |

## Getting started

### Prerequisites

- **Windows 10/11** (the app targets Windows; WebView2 ships with Windows 11)
- **[Node.js](https://nodejs.org) 18 or newer**
- **[Rust](https://rustup.rs)** stable with the MSVC toolchain
  (Visual Studio Build Tools with the "Desktop development with C++" workload)
- The Tauri CLI and Windows bundler tools are installed automatically by `npm install`

For the full up-to-date requirements, see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

### Install & run in development mode

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/movewell.git
cd movewell

# 2. Install JS dependencies
npm install

# 3. Run the app in dev mode (hot-reload)
npm run tauri dev
```

The first dev build compiles the Rust backend and can take a few minutes. After that, the Vite dev server runs on `http://localhost:1420` and the widget window opens.

> **Frontend-only development:** you can also open just the UI in a regular browser with `npm run dev`. Tauri-only APIs (window controls, notifications) gracefully fall back to no-ops.

### Build a release installer

```bash
npm run tauri build
```

This produces the distributable installers in `src-tauri/target/release/bundle/`:

- `msi/movewell_2.0.0_x64_en-US.msi` — Windows Installer package
- `nsis/movewell_2.0.0_x64-setup.exe` — NSIS setup executable

## Running tests

The window-placement logic (multi-monitor + DPI handling) is covered by unit tests on both sides of the app:

```bash
# Frontend placement logic (uses the Node.js built-in test runner)
node --test tests/windowPlacement.test.js

# Rust backend placement logic
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project structure

```
movewell/
├── index.html              # App markup (titlebar, ring, buttons, settings)
├── src/                    # Frontend (bundled by Vite into dist/)
│   ├── main.js             # App bootstrap, UI wiring, canvas rendering
│   ├── timer.js            # Work/break state machine
│   ├── storage.js          # Config & history persistence (localStorage)
│   ├── audio.js            # Sound playback
│   ├── windowPlacement.js  # Window restore/clamp logic (pure, testable)
│   └── style.css           # Dark/glow theme
├── src-tauri/              # Rust backend
│   ├── src/lib.rs          # Tray icon, close-to-tray, off-screen recovery
│   ├── src/main.rs         # Entry point
│   └── tauri.conf.json     # Window & bundler configuration
├── public/sounds/          # Alert sounds (bundled into the app)
├── tests/                  # Node.js unit tests
├── docs/                   # Development reports
├── design/                 # Design mockups
└── legacy/                 # v1 — Python/Tkinter prototype (see below)
```

**Where is my data stored?** Settings, window position and break history live in your WebView2 profile at
`%LOCALAPPDATA%\com.movewell.desktop\` (browser `localStorage`). Deleting that folder resets the app.

**Where do I put custom sounds?** Drop `.mp3` or `.wav` files in `public/sounds/` and rebuild, or place them next to the executable in a `sounds/` folder for dev runs. Select the file in the sound dropdown of the widget.

## Troubleshooting

**The widget disappeared.** Look for the Movewell badge in the system tray (you may need to click the `^` overflow arrow) and click it, or use the tray menu → *Afficher*. The app auto-repairs positions that ended up fully outside every monitor.

**First build fails.** Make sure Rust uses the MSVC toolchain (`rustup default stable-x86_64-pc-windows-msvc`) and that Visual Studio Build Tools are installed with C++ workload.

## Legacy v1 — Python prototype

The first version of Movewell was a Python + Tkinter prototype (`PauseDosWidget`), kept for reference in [`legacy/`](./legacy/). It is not maintained anymore; use the Tauri version.

```bash
cd legacy
python main.py                      # requires Python 3.10+ on Windows
pip install pyinstaller             # optional, for packaging
pyinstaller PauseDosWidget.spec
```

## Roadmap / contributions welcome

- [ ] Internationalization (the UI is currently French — English translations welcome!)
- [ ] End-of-break sound & notification when Resume gets dismissed
- [ ] Cross-platform polish (Linux/macOS config paths & tray behaviour)
- [ ] CI (GitHub Actions) for tests and installer builds
- [ ] Lock-screen awareness: pause the cycle while the user is away

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get involved.

## License

Distributed under the [MIT License](./LICENSE). The alert sound in `public/sounds/` comes from [SoundBible](https://soundbible.com) — check its license before redistributing.
