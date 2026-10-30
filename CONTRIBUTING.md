# Contributing to Movewell

Thanks for your interest in contributing! 🎉

## Setting up your development environment

1. Install the [prerequisites](./README.md#prerequisites): Node.js ≥ 18, Rust stable (MSVC toolchain on Windows).
2. Fork the repository, then:

   ```bash
   git clone https://github.com/YOUR_USERNAME/movewell.git
   cd movewell
   npm install
   npm run tauri dev
   ```

3. Before opening a PR, make sure both test suites pass:

   ```bash
   node --test tests/windowPlacement.test.js
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

## How the codebase is organized

- **Frontend** (`src/`, `index.html`): vanilla ES modules, no framework, bundled by Vite.
- **Backend** (`src-tauri/`): Rust; window lifecycle, tray, off-screen recovery.
- Keep window-placement logic **pure** (no Tauri/WebView calls) so it stays unit-testable — see `src/windowPlacement.js` and the corresponding `#[cfg(test)]` module in `src-tauri/src/lib.rs`.

## Guidelines

- **Keep it small.** The app is a widget: stay lightweight, no new heavy dependencies without discussion.
- **Match the existing style.** Plain ES modules, comment style, and concretely-named helpers mirror the current code.
- **Test placement logic.** If you touch window position/size handling, add fixtures for your screen layout (scale factor, monitor arrangement).
- **UI text is currently French.** Extracting strings and adding i18n is a top roadmap item — a PR there is very welcome.
- **Commits:** short imperative subject lines (e.g. `Fix ring pulse when timer is paused`).
- **PRs:** describe what changed and why; link any issue; include screenshots for UI changes.

## Bug reports

Include your Windows version, display scale factors, monitor arrangement, and steps to reproduce. If the widget went missing, mention what the tray icon does.

## Licensing

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
