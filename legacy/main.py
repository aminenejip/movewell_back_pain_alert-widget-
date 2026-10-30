import sys
import tkinter as tk
from tkinter import ttk
from datetime import datetime
from pathlib import Path
import math
import ctypes
import storage
from timer import PauseTimer
from notifications import notify_pause, notify_resume, list_sound_files
from theme import COLORS as C

N0 = C["bg"]
CARD = C["card"]
BORDER = C["border"]
CYAN = C["accent"]
CYAN_MID = "#0088CC"
CYAN_DIM = C["accent_dark"]
ORANGE = C["orange"]
RED = C["red"]
TEXT = C["text_primary"]
TEXT_DIM = C["text_secondary"]
TEXT_MUTED = C["text_muted"]
GREEN = C["green"]
BTN_INACTIVE = C["btn_inactive"]

R = 90
PAD = 24
CS = R * 2 + PAD * 2
WIN_W, WIN_H = 340, 500
CORNER_R = 18


def _round_window(hwnd, w, h, r):
    hrgn = ctypes.windll.gdi32.CreateRoundRectRgn(0, 0, w, h, r, r)
    ctypes.windll.user32.SetWindowRgn(hwnd, hrgn, True)
    ctypes.windll.gdi32.DeleteObject(hrgn)


def _rounded_rect(cv, x1, y1, x2, y2, r, **kwargs):
    r = min(r, (x2 - x1) // 2, (y2 - y1) // 2)
    pts = [
        x1 + r, y1, x2 - r, y1,
        x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2,
        x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r,
        x1, y1 + r, x1, y1,
    ]
    return cv.create_polygon(pts, smooth=True, **kwargs)


class _PillButton(tk.Canvas):
    FONT = ("Segoe UI", 10, "bold")
    H = 32

    def __init__(self, parent, text, color, cmd):
        self._text = text
        self._color = color
        self._cmd = cmd
        self._disabled = False
        self._fg = self._pick_fg(color)
        bw = self._calc_width(parent, text)
        super().__init__(
            parent, width=bw, height=self.H,
            bg=N0, highlightthickness=0, cursor="hand2",
        )
        self._draw()
        self.bind("<Button-1>", self._on_click)

    @staticmethod
    def _pick_fg(bg):
        return N0 if bg in (CYAN, RED) else TEXT_DIM

    @staticmethod
    def _calc_width(parent, text):
        tmp = tk.Label(parent, text=text, font=_PillButton.FONT)
        w = tmp.winfo_reqwidth() + 32
        tmp.destroy()
        return max(w, 80)

    def _draw(self):
        self.delete("all")
        w = int(self.cget("width"))
        h = self.H
        r = h // 2
        fill = self._color if not self._disabled else BTN_INACTIVE
        _rounded_rect(self, 1, 1, w - 1, h - 1, r, fill=fill, outline="")
        self.create_text(
            w // 2, h // 2, text=self._text,
            fill=self._fg if not self._disabled else TEXT_MUTED,
            font=self.FONT, anchor=tk.CENTER,
        )

    def _on_click(self, e):
        if not self._disabled:
            self._cmd()

    def configure(self, **kwargs):
        redraw = False
        if "state" in kwargs:
            self._disabled = kwargs.pop("state") == tk.DISABLED
            redraw = True
        if "text" in kwargs:
            self._text = kwargs.pop("text")
            bw = self._calc_width(self.master, self._text)
            super().configure(width=bw)
            redraw = True
        if "bg" in kwargs:
            self._color = kwargs.pop("bg")
            self._fg = self._pick_fg(self._color)
            redraw = True
        if "fg" in kwargs:
            self._fg = kwargs.pop("fg")
            redraw = True
        if redraw:
            self._draw()
        return self


class PauseWidget:
    def __init__(self):
        self.config = storage.load_config()
        self.history = storage.load_history()

        self.win = tk.Tk()
        self.win.title("Pause Dos Widget")
        self.win.configure(bg=N0)
        self.win.overrideredirect(True)
        self.win.attributes("-topmost", self.config.get("always_on_top", True))

        sw = self.win.winfo_screenwidth()
        sh = self.win.winfo_screenheight()
        x = self.config.get("window_x")
        y = self.config.get("window_y")
        if x is None or y is None or sw == 0:
            x = sw - WIN_W - 40 if sw > WIN_W else 10
            y = 80
        x = max(0, min(x, max(0, sw - WIN_W)))
        y = max(0, min(y, max(0, sh - WIN_H - 40)))
        self.win.geometry(f"{WIN_W}x{WIN_H}+{x}+{y}")
        self.win.update_idletasks()

        hwnd = ctypes.windll.user32.GetParent(self.win.winfo_id())
        _round_window(hwnd, WIN_W, WIN_H, CORNER_R)

        self._make_draggable()

        self.timer = PauseTimer(
            self.config.get("interval_minutes", 30),
            self.config.get("break_minutes", 2),
        )
        self.timer.on_tick = self._on_tick
        self.timer.on_work_end = self._on_work_end
        self.timer.on_break_end = self._on_break_end

        self._pulse = 0.0
        self._pulse_dir = 1

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

        self.win.bind("<Button-1>", sd)
        self.win.bind("<B1-Motion>", dd)

    def _build_ui(self):
        top = tk.Frame(self.win, bg=N0, height=36)
        top.pack(fill=tk.X)
        top.pack_propagate(False)

        tk.Label(
            top, text="PAUSE DOS", bg=N0, fg=TEXT_MUTED,
            font=("Segoe UI", 9),
        ).pack(side=tk.LEFT, padx=16, pady=8)

        self.close_canvas = tk.Canvas(
            top, width=28, height=28, bg=N0,
            highlightthickness=0, cursor="hand2",
        )
        self.close_canvas.pack(side=tk.RIGHT, padx=10, pady=4)
        self.close_canvas.create_text(
            14, 14, text="\u2715", fill=TEXT_MUTED, font=("Segoe UI", 11), anchor=tk.CENTER,
        )
        self.close_canvas.bind("<Enter>", lambda e: self.close_canvas.create_text(
            14, 14, text="\u2715", fill=CYAN, font=("Segoe UI", 11), anchor=tk.CENTER, tag="x",
        ))
        self.close_canvas.bind("<Leave>", lambda e: self.close_canvas.delete("x"))
        self.close_canvas.bind("<Button-1>", lambda e: self._on_close())
        self.close_btn = self.close_canvas

        ring_frame = tk.Frame(self.win, bg=N0, height=CS + 6)
        ring_frame.pack(fill=tk.X)
        ring_frame.pack_propagate(False)

        self.canvas = tk.Canvas(
            ring_frame, bg=N0, highlightthickness=0,
            width=CS, height=CS + 4,
        )
        self.canvas.pack(anchor=tk.CENTER)

        cx, cy = CS // 2, (CS + 4) // 2
        self._cx, self._cy = cx, cy

        self._draw_grid(cx, cy)
        self._draw_tick_start(cx, cy)

        self._ring_glow = self.canvas.create_arc(
            cx - R - 6, cy - R - 6, cx + R + 6, cy + R + 6,
            start=90, extent=0, outline=CYAN_DIM, width=20, style="arc",
        )
        self._ring_grad1 = self.canvas.create_arc(
            cx - R, cy - R, cx + R, cy + R,
            start=90, extent=0, outline=CYAN_DIM, width=12, style="arc",
        )
        self._ring_grad2 = self.canvas.create_arc(
            cx - R + 2, cy - R + 2, cx + R - 2, cy + R - 2,
            start=90, extent=0, outline=CYAN_MID, width=8, style="arc",
        )
        self._ring_bg = self.canvas.create_arc(
            cx - R, cy - R, cx + R, cy + R,
            start=90, extent=360, outline="#1E1E28", width=8, style="arc",
        )
        self._ring_fg = self.canvas.create_arc(
            cx - R, cy - R, cx + R, cy + R,
            start=90, extent=0, outline=CYAN, width=8, style="arc",
        )
        self._ring_end = self.canvas.create_oval(0, 0, 0, 0, fill=CYAN, outline="")

        self._time_text = self.canvas.create_text(
            cx, cy - 8,
            text=self.timer.get_time_str(),
            fill=CYAN, font=("Segoe UI", 48, "bold"),
            anchor=tk.CENTER,
        )
        self._status_text = self.canvas.create_text(
            cx, cy + 32,
            text=self.timer.get_mode_str(),
            fill=TEXT_DIM, font=("Segoe UI", 10),
            anchor=tk.CENTER,
        )

        self._update_ring()

        for tid in (self._ring_glow, self._ring_grad1, self._ring_grad2,
                     self._ring_bg, self._ring_fg, self._time_text, self._status_text,
                     self._ring_end):
            self.canvas.tag_bind(tid, "<Button-1>", lambda e: self._on_ring_click())

        btn_frame = tk.Frame(self.win, bg=N0)
        btn_frame.pack(pady=(4, 2))

        self.start_btn = _PillButton(btn_frame, "D\u00e9marrer", CYAN, self._on_start)
        self.start_btn.pack(side=tk.LEFT, padx=4)
        self.pause_btn = _PillButton(btn_frame, "Pause", BTN_INACTIVE, self._on_pause)
        self.pause_btn.pack(side=tk.LEFT, padx=4)
        self.pause_btn.configure(state=tk.DISABLED)
        self.stop_btn = _PillButton(btn_frame, "Stop", RED, self._on_stop)
        self.stop_btn.pack(side=tk.LEFT, padx=4)
        self.stop_btn.configure(state=tk.DISABLED)

        sep = tk.Frame(self.win, bg=BORDER, height=1)
        sep.pack(fill=tk.X, padx=20, pady=(6, 4))

        self.history_label = tk.Label(
            self.win, text="", bg=N0, fg=TEXT_DIM,
            font=("Segoe UI", 8),
        )
        self.history_label.pack()

        settings = tk.Frame(self.win, bg=N0)
        settings.pack(fill=tk.X, padx=14, pady=(4, 0))

        srow1 = tk.Frame(settings, bg=N0)
        srow1.pack(fill=tk.X, pady=2)

        work_card = tk.Frame(
            srow1, bg=CARD, highlightbackground=BORDER, highlightthickness=1,
        )
        work_card.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 4), ipady=4)
        work_card.pack_propagate(False)

        tk.Label(
            work_card, text="Travail", bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 8),
        ).pack(pady=(4, 0))
        wc2 = tk.Frame(work_card, bg=CARD)
        wc2.pack(pady=(0, 4))
        self.iv = tk.StringVar(value=str(self.config.get("interval_minutes", 30)))
        self.iv.trace_add("write", lambda *_: self._on_interval_change())
        self.is_spin = tk.Spinbox(
            wc2, from_=1, to=180, increment=1,
            textvariable=self.iv, width=3, state="readonly",
            bg="#1A1A24", fg=TEXT, insertbackground=TEXT,
            relief=tk.FLAT, bd=0, font=("Segoe UI", 10),
            buttonbackground=CARD, readonlybackground="#1A1A24",
            highlightbackground=BORDER, highlightthickness=1,
        )
        self.is_spin.pack(side=tk.LEFT)
        tk.Label(
            wc2, text="min", bg=CARD, fg=TEXT_MUTED, font=("Segoe UI", 9),
        ).pack(side=tk.LEFT, padx=(4, 0))

        pause_card = tk.Frame(
            srow1, bg=CARD, highlightbackground=BORDER, highlightthickness=1,
        )
        pause_card.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(4, 0), ipady=4)
        pause_card.pack_propagate(False)

        tk.Label(
            pause_card, text="Pause", bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 8),
        ).pack(pady=(4, 0))
        pc2 = tk.Frame(pause_card, bg=CARD)
        pc2.pack(pady=(0, 4))
        BREAK_PRESETS = [("1min", 1), ("2min", 2), ("3min", 3), ("5min", 5), ("10min", 10)]
        self._bp = BREAK_PRESETS
        cur_b = self.config.get("break_minutes", 2)
        cur_bl = next((l for l, v in BREAK_PRESETS if v == cur_b), "2min")
        self.bv = tk.StringVar(value=cur_bl)

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Custom.TCombobox",
            fieldbackground=CARD, background=CARD, foreground=TEXT,
            arrowcolor=TEXT_DIM, selectbackground=CARD, selectforeground=TEXT,
        )
        style.map("Custom.TCombobox",
            fieldbackground=[("readonly", CARD)],
        )
        self.b_combo = ttk.Combobox(
            pc2, textvariable=self.bv, values=[p[0] for p in BREAK_PRESETS],
            width=6, state="readonly", font=("Segoe UI", 10),
            style="Custom.TCombobox",
        )
        self.b_combo.pack()

        srow2 = tk.Frame(settings, bg=N0)
        srow2.pack(fill=tk.X, pady=(6, 4))

        self.sv = tk.BooleanVar(value=self.config.get("sound_enabled", True))
        sframe = tk.Frame(
            srow2, bg=CARD, highlightbackground=BORDER, highlightthickness=1,
        )
        sframe.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 4), ipady=3)
        self._make_cb(sframe, "Son", self.sv)

        sfx = list_sound_files()
        sfx.insert(0, "Syst\u00e8me")
        self.sfv = tk.StringVar(value=self.config.get("sound_file") or "Syst\u00e8me")
        scframe = tk.Frame(
            srow2, bg=CARD, highlightbackground=BORDER, highlightthickness=1,
        )
        scframe.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(4, 0), ipady=3)
        self.s_combo = ttk.Combobox(
            scframe, textvariable=self.sfv, values=sfx,
            width=14, state="readonly", font=("Segoe UI", 9),
            style="Custom.TCombobox",
        )
        self.s_combo.pack(pady=2)

        self.tov = tk.BooleanVar(value=self.config.get("always_on_top", True))
        toframe = tk.Frame(
            srow2, bg=CARD, highlightbackground=BORDER, highlightthickness=1,
        )
        toframe.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(4, 0), ipady=3)
        self._make_cb(toframe, "Au 1er plan", self.tov, self._toggle_topmost)

        home = tk.Frame(self.win, bg=N0, height=28)
        home.pack(fill=tk.X, side=tk.BOTTOM)

        bar = tk.Frame(home, bg=BORDER, width=36, height=3)
        bar.pack(side=tk.BOTTOM, pady=(4, 6))
        bar.pack_propagate(False)

        tk.Label(
            home, text="clic centre \u00b7 \u00c9chap ferme", bg=N0, fg=TEXT_MUTED,
            font=("Segoe UI", 7),
        ).pack(side=tk.TOP, pady=(0, 1))

    def _draw_grid(self, cx, cy):
        spacing = 32
        limit = 120
        for dx in range(-limit, limit + 1, spacing):
            for dy in range(-limit, limit + 1, spacing):
                px = cx + dx
                py = cy + dy
                dist = math.hypot(dx, dy)
                if R - 4 < dist < R + 32:
                    continue
                self.canvas.create_oval(
                    px - 0.5, py - 0.5, px + 0.5, py + 0.5,
                    fill="#FFFFFF", outline="",
                )
        self.canvas.create_oval(
            cx - 1.5, cy - 1.5, cx + 1.5, cy + 1.5,
            fill=CYAN_DIM, outline="",
        )

    def _draw_tick_start(self, cx, cy):
        a = math.radians(90)
        x1 = cx + (R + 10) * math.cos(a)
        y1 = cy - (R + 10) * math.sin(a)
        x2 = cx + (R + 16) * math.cos(a)
        y2 = cy - (R + 16) * math.sin(a)
        self.canvas.create_line(x1, y1, x2, y2, fill=CYAN, width=2.5, capstyle=tk.ROUND)

    def _make_cb(self, parent, text, var, cmd=None):
        frame = tk.Frame(parent, bg=CARD)
        frame.pack(pady=2)

        cb_frame = tk.Frame(frame, bg=CARD, cursor="hand2")
        cb_frame.pack(side=tk.LEFT, padx=(4, 6))

        c = tk.Canvas(cb_frame, width=18, height=18, bg=CARD, highlightthickness=0, cursor="hand2")
        c.pack()

        def _render(state):
            c.delete("all")
            c.create_rectangle(
                1, 1, 17, 17,
                outline=CYAN if state else BORDER,
                fill="#1E1E28" if state else "#1A1A24",
                width=1.5,
            )
            if state:
                c.create_line(
                    5, 10, 8, 14, 14, 5,
                    fill=CYAN, width=2.5, capstyle=tk.ROUND, joinstyle=tk.ROUND,
                )

        _render(var.get())

        def toggle(e=None):
            var.set(not var.get())
            _render(var.get())
            if cmd:
                cmd()

        c.bind("<Button-1>", toggle)
        tk.Label(
            frame, text=text, bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 8), cursor="hand2",
        ).pack(side=tk.LEFT)
        frame.bind("<Button-1>", toggle, add=True)
        for ch in frame.winfo_children():
            ch.bind("<Button-1>", toggle, add=True)

    def _on_ring_click(self):
        if not self.timer.is_running():
            self._on_start()
        elif self.timer.is_paused():
            self.timer.resume()
            self.pause_btn.configure(text="Pause", bg=BTN_INACTIVE, fg=TEXT_DIM)
            self._update_ring()
        else:
            self.timer.pause()
            self.pause_btn.configure(text="Reprendre", bg=CYAN, fg=N0)
            self._update_ring()

    def _get_color(self):
        if not self.timer.is_running():
            return N0, BORDER, TEXT_MUTED
        if self.timer.is_break():
            p = self.timer.get_progress()
            c = ORANGE if p > 0.3 else GREEN
            d = "#663300" if p > 0.3 else "#1A6633"
            return c, d, c
        return CYAN, CYAN_DIM, CYAN

    def _update_ring(self):
        p = self.timer.get_progress()
        extent = 360 * p
        color, dim, tc = self._get_color()

        if not self.timer.is_running():
            extent = 360
            color = BORDER
            dim = "#15151C"

        pls = 4 * math.sin(self._pulse) if self.timer.is_running() else 0
        self.canvas.itemconfig(self._ring_glow, extent=extent, outline=dim, width=20 + pls)
        self.canvas.itemconfig(self._ring_grad1, extent=extent, outline=dim)
        self.canvas.itemconfig(self._ring_grad2, extent=extent, outline=color)
        self.canvas.itemconfig(self._ring_fg, extent=extent, outline=color)
        self.canvas.itemconfig(self._time_text, text=self.timer.get_time_str(), fill=tc)
        self.canvas.itemconfig(self._status_text, text=self.timer.get_mode_str())

        cx, cy = self._cx, self._cy
        angle_deg = 90 - extent
        angle_rad = math.radians(angle_deg)
        ep_x = cx + R * math.cos(angle_rad)
        ep_y = cy - R * math.sin(angle_rad)
        ep_r = 4
        ep_fill = color if self.timer.is_running() else BORDER
        self.canvas.coords(self._ring_end, ep_x - ep_r, ep_y - ep_r, ep_x + ep_r, ep_y + ep_r)
        self.canvas.itemconfig(self._ring_end, fill=ep_fill, outline="")

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
            self.start_btn.configure(state=tk.DISABLED, bg=BTN_INACTIVE, fg=TEXT_DIM)
            self.pause_btn.configure(state=tk.NORMAL, bg=BTN_INACTIVE, fg=TEXT_DIM)
            self.stop_btn.configure(state=tk.NORMAL, bg=BTN_INACTIVE, fg=TEXT_DIM)
            self._update_ring()
        except Exception:
            import traceback
            with open(Path(sys.argv[0]).parent / "error.log", "w") as f:
                traceback.print_exc(file=f)

    def _on_pause(self):
        if self.timer.is_paused():
            self.timer.resume()
            self.pause_btn.configure(text="Pause", bg=BTN_INACTIVE, fg=TEXT_DIM)
        else:
            self.timer.pause()
            self.pause_btn.configure(text="Reprendre", bg=CYAN, fg=N0)
        self._update_ring()

    def _on_stop(self):
        self.timer.stop()
        self.start_btn.configure(state=tk.NORMAL, bg=CYAN, fg=N0)
        self.pause_btn.configure(state=tk.DISABLED, text="Pause", bg=BTN_INACTIVE, fg=TEXT_DIM)
        self.stop_btn.configure(state=tk.DISABLED, bg=BTN_INACTIVE, fg=TEXT_DIM)
        self._update_ring()

    def _on_work_end(self):
        today = datetime.now().strftime("%Y-%m-%d")
        self.history.append({"date": today, "time": datetime.now().strftime("%H:%M"), "type": "pause"})
        storage.save_history(self.history)
        self._update_history_display()
        sf = self.sfv.get()
        notify_pause(self.sv.get(), None if sf == "Syst\u00e8me" else sf, 3)
        self._update_ring()
        self.pause_btn.configure(state=tk.NORMAL, bg=BTN_INACTIVE, fg=TEXT_DIM)
        self.stop_btn.configure(state=tk.NORMAL, bg=BTN_INACTIVE, fg=TEXT_DIM)

    def _on_break_end(self):
        sf = self.sfv.get()
        notify_pause(self.sv.get(), None if sf == "Syst\u00e8me" else sf, 2)
        self.start_btn.configure(state=tk.NORMAL, bg=CYAN, fg=N0)
        self.pause_btn.configure(state=tk.DISABLED, text="Pause", bg=BTN_INACTIVE, fg=TEXT_DIM)
        self.stop_btn.configure(state=tk.DISABLED, bg=BTN_INACTIVE, fg=TEXT_DIM)
        self._update_ring()

    def _on_tick(self):
        if self.timer.is_running():
            self._pulse += 0.04 * self._pulse_dir
            if self._pulse > 1.0 or self._pulse < 0.0:
                self._pulse_dir *= -1
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
        self.history_label.configure(text=f"Aujourd'hui \u00b7 {c} pause{'s' if c > 1 else ''}")

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
        self.config["sound_file"] = None if sf == "Syst\u00e8me" else sf
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
            mb.showerror("Erreur", f"Une erreur est survenue\n\nD\u00e9tails dans error.log")
        except Exception:
            print(err)
        raise
