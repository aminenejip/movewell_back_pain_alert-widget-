import winsound
import subprocess
import threading
import ctypes
import sys
from pathlib import Path

def _find_sounds_dir():
    candidates = [
        getattr(sys, '_MEIPASS', None),
        Path(sys.argv[0]).parent,
        Path(sys.executable).parent,
        Path(__file__).parent,
        Path.cwd(),
    ]
    for c in candidates:
        if c is None:
            continue
        d = Path(c) / "sounds"
        if d.exists():
            return d
    fallback = Path(sys.argv[0]).parent / "sounds"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


SOUNDS_DIR = _find_sounds_dir()


def send_toast(title, message, duration=8):
    ps_script = f'''
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $xml.GetElementsByTagName("text")
$textNodes.Item(0).AppendChild($xml.CreateTextNode("{title}")) > $null
$textNodes.Item(1).AppendChild($xml.CreateTextNode("{message}")) > $null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$toast.ExpirationTime = [DateTimeOffset]::Now.AddSeconds({duration})
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Pause Dos Widget").Show($toast)
'''
    try:
        subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-Command", ps_script],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def list_sound_files():
    if not SOUNDS_DIR.exists():
        return []
    exts = {".wav", ".mp3", ".mid", ".wma", ".flac", ".ogg"}
    return sorted([f.name for f in SOUNDS_DIR.iterdir() if f.suffix.lower() in exts])


def _mci_stop():
    try:
        ctypes.windll.winmm.mciSendStringW("close all", None, 0, 0)
    except Exception:
        pass


def play_sound_file(filepath, duration_seconds=3):
    try:
        _mci_stop()
        cmd = f'open "{filepath}" alias notify'
        if ctypes.windll.winmm.mciSendStringW(cmd, None, 0, 0) != 0:
            return False
        ctypes.windll.winmm.mciSendStringW("play notify", None, 0, 0)
        threading.Timer(duration_seconds, _mci_stop).start()
        return True
    except Exception:
        return False


def play_system_sound():
    try:
        winsound.PlaySound("SystemExclamation", winsound.SND_ALIAS | winsound.SND_ASYNC)
    except Exception:
        try:
            winsound.Beep(880, 400)
        except Exception:
            pass


def notify_pause(sound_enabled=True, sound_file=None, sound_duration=3):
    title = "Pause pour votre dos !"
    message = "Levez-vous, étirez-vous 2 minutes. Votre dos vous remerciera."
    if sound_enabled:
        if sound_file:
            fpath = SOUNDS_DIR / sound_file
            if fpath.exists():
                if not play_sound_file(fpath, sound_duration):
                    play_system_sound()
            else:
                play_system_sound()
        else:
            play_system_sound()
    send_toast(title, message)


def notify_resume():
    send_toast("Pause terminée", "Bon retour ! Au prochain cycle.")
