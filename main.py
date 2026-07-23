import sys
import tkinter as tk
from tkinter import ttk
from datetime import datetime
from pathlib import Path
import math
import storage
from timer import PauseTimer
from notifications import notify_pause, notify_resume, list_sound_files

N0 = "#0A0A0A"
N1 = "#0D0D0D"
N2 = "#141414"
N3 = "#1E1E1E"
N4 = "#2A2A2A"
N5 = "#3A3A3A"
CYAN = "#00D9FF"
CYAN_DIM = "#007A99"
ORANGE = "#FF7A3D"
TEXT = "#E8E8E8"
TEXT_DIM = "#8A8A8A"
TEXT_MUTED = "#555555"
SUCCESS = "#4ADE80"
RED = "#EF4444"

RING_SIZE = 200


class PauseWidget:
    def __init__(self):
        self.config = storage.load_config()
        self.history = storage.load_history()

        self.win = tk.Tk()
        self.win.title("Pause Dos Widget")
        self.win.configure(bg=N0)
        self.win.overrideredirect(True)
        self.win.attributes("-topmost", self.config.get("always_on_top", True))
        self.win.attributes("-alpha", 0.96)

        ww, wh = 340, 480
        sw = self.win.winfo_screenwidth()
        sh = self.win.winfo_screenheight()
        x = self.config.get("window_x")
        y = self.config.get("window_y")
        if x is None or y is None or sw == 0:
            x = sw - ww - 40 if sw > ww else 10
            y = 100
        x = max(0, min(x, max(0, sw - ww)))
        y = max(0, min(y, max(0, sh - wh - 40)))
        self.win.geometry(f"{ww}x{wh}+{x}+{y}")

        self.card = tk.Frame(self.win, bg=N1, highlightbackground=N3, highlightthickness=1)
        self.card.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        self._make_draggable()

        self.timer = PauseTimer(
            self.config.get("interval_minutes", 30),
            self.config.get("break_minutes", 2),
        )
        self.timer.on_tick = self._on_tick
        self.timer.on_work_end = self._on_work_end
        self.timer.on_break_end = self._on_break_end

        self._build_ui()
        self._update_history_display()

        self.win.protocol("WM_DELETE_WINDOW", self._on_close)
        self.win.bind("<Escape>", lambda e: self._on_close())

    def _make_draggable(self):
        drag = {"x": 0, "y": 0}

        def sd(e):
            drag["x"] = e.x
            drag["y"] = e.y

        def dd(e):
            dx = e.x - drag["x"]
            dy = e.y - drag["y"]
            self.win.geometry(f"+{self.win.winfo_x()+dx}+{self.win.winfo_y()+dy}")

        self.card.bind("<Button-1>", sd)
        self.card.bind("<B1-Motion>", dd)
        for w in [self.win]:
            w.bind("<Button-1>", sd, add=True)
            w.bind("<B1-Motion>", dd, add=True)

    def _build_ui(self):
        top = tk.Frame(self.card, bg=N1)
        top.pack(fill=tk.X, pady=(8, 0))

        tk.Label(
            top, text="Pause Dos", bg=N1, fg=TEXT_MUTED,
            font=("Segoe UI", 10, "normal"),
        ).pack(side=tk.LEFT, padx=14)

        self.close_btn = tk.Label(
            top, text="✕", bg=N1, fg=N5,
            font=("Segoe UI", 14), cursor="hand2",
        )
        self.close_btn.pack(side=tk.RIGHT, padx=12)
        self.close_btn.bind("<Button-1>", lambda e: self._on_close())

        ring_frame = tk.Frame(self.card, bg=N1, height=RING_SIZE + 30)
        ring_frame.pack(fill=tk.X, pady=(4, 0))
        ring_frame.pack_propagate(False)

        self.canvas = tk.Canvas(
            ring_frame, bg=N1, highlightthickness=0,
            width=RING_SIZE + 40, height=RING_SIZE + 20,
        )
        self.canvas.pack(anchor=tk.CENTER)

        cx, cy, r = (RING_SIZE + 40) // 2, (RING_SIZE + 20) // 2, RING_SIZE // 2 - 6

        self._ring_bg = self.canvas.create_arc(
            cx - r, cy - r, cx + r, cy + r,
            start=90, extent=360,
            outline=N4, width=6, style="arc",
        )
        self._ring_fg = self.canvas.create_arc(
            cx - r, cy - r, cx + r, cy + r,
            start=90, extent=0,
            outline=CYAN, width=6, style="arc",
        )

        self._time_text = self.canvas.create_text(
            cx, cy - 8,
            text=self.timer.get_time_str(),
            fill=CYAN, font=("Segoe UI", 32, "bold"),
            anchor=tk.CENTER,
        )
        self._status_text = self.canvas.create_text(
            cx, cy + 28,
            text=self.timer.get_mode_str(),
            fill=TEXT_DIM, font=("Segoe UI", 10),
            anchor=tk.CENTER,
        )

        self._update_ring()

        self.canvas.tag_bind(self._ring_bg, "<Button-1>", lambda e: self._on_ring_click())
        self.canvas.tag_bind(self._ring_fg, "<Button-1>", lambda e: self._on_ring_click())
        self.canvas.tag_bind(self._time_text, "<Button-1>", lambda e: self._on_ring_click())
        self.canvas.tag_bind(self._status_text, "<Button-1>", lambda e: self._on_ring_click())

        btn_frame = tk.Frame(self.card, bg=N1)
        btn_frame.pack(pady=(2, 4))

        self.start_btn = self._make_pill(btn_frame, "Démarrer", CYAN, self._on_start)
        self.start_btn.pack(side=tk.LEFT, padx=4)

        self.pause_btn = self._make_pill(btn_frame, "Pause", N4, self._on_pause)
        self.pause_btn.pack(side=tk.LEFT, padx=4)
        self.pause_btn.configure(state=tk.DISABLED)

        self.stop_btn = self._make_pill(btn_frame, "Stop", RED, self._on_stop)
        self.stop_btn.pack(side=tk.LEFT, padx=4)
        self.stop_btn.configure(state=tk.DISABLED)

        self.history_label = tk.Label(
            self.card, text="Pauses: 0", bg=N1, fg=TEXT_MUTED,
            font=("Segoe UI", 8),
        )
        self.history_label.pack(pady=(2, 0))

        sep = tk.Frame(self.card, bg=N3, height=1)
        sep.pack(fill=tk.X, padx=16, pady=(8, 4))

        settings = tk.Frame(self.card, bg=N1)
        settings.pack(fill=tk.X, padx=14)

        row1 = tk.Frame(settings, bg=N1)
        row1.pack(fill=tk.X, pady=2)

        tk.Label(row1, text="Travail", bg=N1, fg=TEXT_DIM, font=("Segoe UI", 8)).pack(side=tk.LEFT, padx=(0, 4))

        self.iv = tk.StringVar(value=str(self.config.get("interval_minutes", 30)))
        self.iv.trace_add("write", lambda *_: self._on_interval_change())
        self.is_spin = tk.Spinbox(
            row1, from_=1, to=180, increment=1,
            textvariable=self.iv, width=3, state="readonly",
            bg=N2, fg=TEXT, insertbackground=TEXT,
            relief=tk.FLAT, bd=4, font=("Segoe UI", 9),
            buttonbackground=N4, readonlybackground=N2,
        )
        self.is_spin.pack(side=tk.LEFT, padx=(0, 4))
        tk.Label(row1, text="min", bg=N1, fg=TEXT_MUTED, font=("Segoe UI", 8)).pack(side=tk.LEFT, padx=(0, 12))

        tk.Label(row1, text="Pause", bg=N1, fg=TEXT_DIM, font=("Segoe UI", 8)).pack(side=tk.LEFT, padx=(0, 4))

        BREAK_PRESETS = [("1min", 1), ("2min", 2), ("3min", 3), ("5min", 5), ("10min", 10)]
        self._bp = BREAK_PRESETS
        cur_b = self.config.get("break_minutes", 2)
        cur_bl = next((l for l, v in BREAK_PRESETS if v == cur_b), "2min")
        self.bv = tk.StringVar(value=cur_bl)
        self.b_combo = ttk.Combobox(
            row1, textvariable=self.bv, values=[p[0] for p in BREAK_PRESETS],
            width=6, state="readonly", font=("Segoe UI", 9),
        )
        self.b_combo.pack(side=tk.LEFT)

        row2 = tk.Frame(settings, bg=N1)
        row2.pack(fill=tk.X, pady=(4, 6))

        self.sv = tk.BooleanVar(value=self.config.get("sound_enabled", True))
        self.s_cb = tk.Checkbutton(
            row2, text="Son", variable=self.sv, bg=N1, fg=TEXT_DIM,
            selectcolor=N2, activebackground=N1, activeforeground=TEXT,
            font=("Segoe UI", 8), cursor="hand2",
        )
        self.s_cb.pack(side=tk.LEFT, padx=(0, 6))

        sfx = list_sound_files()
        sfx.insert(0, "Système")
        self.sfv = tk.StringVar(value=self.config.get("sound_file") or "Système")
        self.s_combo = ttk.Combobox(
            row2, textvariable=self.sfv, values=sfx,
            width=14, state="readonly", font=("Segoe UI", 9),
        )
        self.s_combo.pack(side=tk.LEFT, padx=(0, 6))

        self.tov = tk.BooleanVar(value=self.config.get("always_on_top", True))
        self.to_cb = tk.Checkbutton(
            row2, text="Au 1er plan", variable=self.tov, bg=N1, fg=TEXT_MUTED,
            selectcolor=N2, activebackground=N1, activeforeground=TEXT,
            font=("Segoe UI", 8), cursor="hand2", command=self._toggle_topmost,
        )
        self.to_cb.pack(side=tk.LEFT)

        home = tk.Frame(self.card, bg=N1, height=20)
        home.pack(fill=tk.X, side=tk.BOTTOM)

        bar = tk.Frame(home, bg=N5, width=36, height=4)
        bar.pack(side=tk.BOTTOM, pady=6)
        bar.pack_propagate(False)

        hint = tk.Label(
            home, text="Échap pour fermer", bg=N1, fg=TEXT_MUTED,
            font=("Segoe UI", 7),
        )
        hint.pack(side=tk.TOP, pady=(0, 2))

    def _make_pill(self, parent, text, color, cmd):
        is_bright = color in (CYAN, RED)
        fg = N0 if is_bright else TEXT_DIM
        afg = N0 if is_bright else TEXT
        return tk.Button(
            parent, text=text, bg=color, fg=fg,
            activebackground=color, activeforeground=afg,
            font=("Segoe UI", 9, "bold"), bd=0,
            padx=14, pady=5, cursor="hand2", command=cmd,
        )

    def _on_ring_click(self):
        if not self.timer.is_running():
            self._on_start()
        elif self.timer.is_paused():
            self.timer.resume()
            self.pause_btn.configure(text="Pause", bg=N4, fg=TEXT)
            self._update_ring()
        else:
            self.timer.pause()
            self.pause_btn.configure(text="Reprendre", bg=CYAN, fg=N0)
            self._update_ring()

    def _update_ring(self):
        p = self.timer.get_progress()
        extent = 360 * p
        color = CYAN
        if self.timer.is_break():
            color = ORANGE if p > 0.3 else SUCCESS
        if not self.timer.is_running():
            extent = 360
            color = N4
        self.canvas.itemconfig(self._ring_fg, extent=extent, outline=color)
        self.canvas.itemconfig(self._time_text, text=self.timer.get_time_str(), fill=color)
        self.canvas.itemconfig(self._status_text, text=self.timer.get_mode_str())

    def _on_interval_change(self):
        try:
            self.timer.set_work(int(self.iv.get()))
            self._update_ring()
        except ValueError:
            pass

    def _on_start(self):
        try:
            mins = int(self.iv.get())
            bm = self._get_break_min()
            self.timer.set_work(mins)
            self.timer.set_break(bm)
            self.timer.start(self.win)
            self.config["interval_minutes"] = mins
            self.config["break_minutes"] = bm
            storage.save_config(self.config)
            self.start_btn.configure(state=tk.DISABLED, bg=N4, fg=TEXT_DIM)
            self.pause_btn.configure(state=tk.NORMAL, bg=N4, fg=TEXT)
            self.stop_btn.configure(state=tk.NORMAL, bg=N4, fg=TEXT)
            self._update_ring()
        except Exception as e:
            import traceback
            with open(Path(sys.argv[0]).parent / "error.log", "w") as f:
                traceback.print_exc(file=f)

    def _on_pause(self):
        if self.timer.is_paused():
            self.timer.resume()
            self.pause_btn.configure(text="Pause")
        else:
            self.timer.pause()
            self.pause_btn.configure(text="Reprendre", bg=CYAN, fg=N0)
        self._update_ring()

    def _on_stop(self):
        self.timer.stop()
        self.start_btn.configure(state=tk.NORMAL, bg=CYAN, fg=N0)
        self.pause_btn.configure(state=tk.DISABLED, text="Pause", bg=N4, fg=TEXT_DIM)
        self.stop_btn.configure(state=tk.DISABLED, bg=N4, fg=TEXT_DIM)
        self._update_ring()

    def _on_work_end(self):
        today = datetime.now().strftime("%Y-%m-%d")
        self.history.append({"date": today, "time": datetime.now().strftime("%H:%M"), "type": "pause"})
        storage.save_history(self.history)
        self._update_history_display()
        sf = self.sfv.get()
        notify_pause(self.sv.get(), None if sf == "Système" else sf, 3)
        self._update_ring()
        self.pause_btn.configure(state=tk.NORMAL, bg=N4, fg=TEXT)
        self.stop_btn.configure(state=tk.NORMAL, bg=N4, fg=TEXT)

    def _on_break_end(self):
        sf = self.sfv.get()
        notify_pause(self.sv.get(), None if sf == "Système" else sf, 2)
        self.start_btn.configure(state=tk.NORMAL, bg=CYAN, fg=N0)
        self.pause_btn.configure(state=tk.DISABLED, text="Pause", bg=N4, fg=TEXT_DIM)
        self.stop_btn.configure(state=tk.DISABLED, bg=N4, fg=TEXT_DIM)
        self._update_ring()

    def _on_tick(self):
        self._update_ring()

    def _get_break_min(self):
        l = self.bv.get()
        for lab, v in self._bp:
            if lab == l:
                return v
        return 2

    def _update_history_display(self):
        today = datetime.now().strftime("%Y-%m-%d")
        c = sum(1 for h in self.history if h.get("date") == today)
        self.history_label.configure(text=f"Aujourd'hui · {c} pause{'s' if c > 1 else ''}")

    def _toggle_topmost(self):
        v = self.tov.get()
        self.win.attributes("-topmost", v)
        self.config["always_on_top"] = v
        storage.save_config(self.config)

    def _on_close(self):
        self.config["window_x"] = self.win.winfo_x()
        self.config["window_y"] = self.win.winfo_y()
        self.config["sound_enabled"] = self.sv.get()
        sf = self.sfv.get()
        self.config["sound_file"] = None if sf == "Système" else sf
        self.config["break_minutes"] = self._get_break_min()
        self.timer.stop()
        storage.save_config(self.config)
        self.win.destroy()

    def run(self):
        self.win.mainloop()


if __name__ == "__main__":
    import traceback
    try:
        PauseWidget().run()
    except Exception as e:
        err = traceback.format_exc()
        ld = Path(sys.argv[0]).parent if getattr(sys, "frozen", False) else Path(".")
        with open(ld / "error.log", "w") as f:
            f.write(err)
        try:
            import tkinter.messagebox as mb
            mb.showerror("Erreur", f"Une erreur est survenue\n\nDétails dans error.log")
        except Exception:
            print(err)
        raise
