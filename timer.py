class PauseTimer:
    MODE_WORK = "work"
    MODE_BREAK = "break"

    def __init__(self, work_minutes=30, break_minutes=2):
        self.work_minutes = work_minutes
        self.break_minutes = break_minutes
        self.mode = self.MODE_WORK
        self.remaining_seconds = work_minutes * 60
        self.running = False
        self.paused = False
        self._after_id = None
        self._master = None
        self.on_tick = None
        self.on_work_end = None
        self.on_break_end = None
        self._elapsed = 0.0

    def start(self, master):
        self._master = master
        self.mode = self.MODE_WORK
        self.remaining_seconds = self.work_minutes * 60
        self.running = True
        self.paused = False
        self._elapsed = 0.0
        self._schedule()

    def _schedule(self):
        if not self.running:
            return
        self._after_id = self._master.after(500, self._tick)

    def _tick(self):
        if not self.running:
            return
        if self.paused:
            self._schedule()
            return
        self._elapsed += 0.5
        total = self.work_minutes * 60 if self.mode == self.MODE_WORK else self.break_minutes * 60
        remaining = total - self._elapsed
        if remaining <= 0:
            self.remaining_seconds = 0
            if self.mode == self.MODE_WORK:
                self.mode = self.MODE_BREAK
                self._elapsed = 0.0
                self.remaining_seconds = self.break_minutes * 60
                if self.on_work_end:
                    self.on_work_end()
                self._schedule()
            else:
                self.running = False
                if self.on_break_end:
                    self.on_break_end()
            return
        self.remaining_seconds = remaining
        if self.on_tick:
            self.on_tick()
        self._schedule()

    def pause(self):
        if not self.running or self.paused:
            return
        self.paused = True

    def resume(self):
        if not self.running or not self.paused:
            return
        self.paused = False

    def stop(self):
        self.running = False
        self.paused = False
        if self._after_id:
            try:
                self._master.after_cancel(self._after_id)
            except Exception:
                pass
            self._after_id = None
        self.mode = self.MODE_WORK
        self.remaining_seconds = self.work_minutes * 60
        self._elapsed = 0.0

    def set_work(self, minutes):
        was_running = self.running
        self.stop()
        self.work_minutes = minutes
        self.remaining_seconds = minutes * 60

    def set_break(self, minutes):
        self.break_minutes = minutes

    def get_time_str(self):
        mins = int(self.remaining_seconds // 60)
        secs = int(self.remaining_seconds % 60)
        return f"{mins:02d}:{secs:02d}"

    def get_mode_str(self):
        if not self.running:
            return "Prêt"
        if self.paused:
            return "En pause"
        if self.mode == self.MODE_BREAK:
            return "PAUSE !"
        return "En cours"

    def is_running(self):
        return self.running

    def is_paused(self):
        return self.paused

    def is_break(self):
        return self.mode == self.MODE_BREAK

    def get_progress(self):
        total = self.work_minutes * 60 if self.mode == self.MODE_WORK else self.break_minutes * 60
        return self.remaining_seconds / total if total > 0 else 1.0
