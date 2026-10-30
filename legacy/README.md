# Legacy: PauseDosWidget (v1)

This folder contains the **first version** of Movewell: a Python 3 + Tkinter desktop
widget, packaged at the time with PyInstaller. It has been superseded by the
Tauri 2 version in the repository root and is **not maintained anymore** — kept
only as a historical reference.

## Run it (Windows)

```bash
# Python 3.10 recommended (uses tkinter, winsound, ctypes — all stdlib)
python main.py
```

Settings are saved in `%APPDATA%\PauseDosWidget\` (`config.json` / `history.json`).

## Package an executable

```bash
pip install pyinstaller
pyinstaller PauseDosWidget.spec
```

Historical build output is included under `build/PauseDosWidget/` for reference
(not tracked in git anymore).

## Files

| File | Role |
|---|---|
| `main.py` | Tkinter UI: pill buttons, countdown ring, settings cards |
| `timer.py` | Work/break state machine |
| `storage.py` | JSON config/history in `%APPDATA%` |
| `theme.py` | Color palette |
| `notifications.py` | Windows toast (PowerShell), MCI sound playback, sound discovery |
| `PauseDosWidget.spec` | PyInstaller packaging recipe |
| `icon.ico` | Application icon |
