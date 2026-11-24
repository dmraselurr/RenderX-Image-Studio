"""
RenderX Image Studio (RIS) - Ultra-Fast Zero-Console Desktop Launcher
Starts server.py silently if port 8899 is not listening, launches standalone Chrome App window
with zero browser tabs/CMD toggles, and stamps the RIS taskbar icon cleanly via Win32 WM_SETICON.
"""

import ctypes
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ICON_PATH = BASE_DIR / "icons" / "ris_logo.ico"
UI_PROFILE_DIR = BASE_DIR / "profiles" / "_ui_shell"
SERVER_PY = BASE_DIR / "server.py"
PYW_EXE = Path(sys.executable).with_name("pythonw.exe")
if not PYW_EXE.is_file():
    PYW_EXE = Path(sys.executable)


def is_port_open(host: str = "127.0.0.1", port: int = 8899) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.1)
    try:
        s.connect((host, port))
        s.close()
        return True
    except Exception:
        return False


def find_chrome() -> str:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return ""


def apply_taskbar_icon_to_studio_window(ico_file: Path, timeout_sec: float = 6.0):
    """Find the opened RenderX Image Studio app window and stamp our RIS icon onto its taskbar entry."""
    if os.name != "nt" or not ico_file.is_file():
        return
    try:
        user32 = ctypes.windll.user32
        WM_SETICON = 0x0080
        ICON_SMALL = 0
        ICON_BIG = 1
        IMAGE_ICON = 1
        LR_LOADFROMFILE = 0x0010
        LR_DEFAULTSIZE = 0x0040

        hicon_big = user32.LoadImageW(0, str(ico_file), IMAGE_ICON, 256, 256, LR_LOADFROMFILE)
        if not hicon_big:
            hicon_big = user32.LoadImageW(0, str(ico_file), IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
        hicon_small = user32.LoadImageW(0, str(ico_file), IMAGE_ICON, 32, 32, LR_LOADFROMFILE) or hicon_big

        if not hicon_big:
            return

        matched_hwnd = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def enum_cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    if "RenderX Image Studio" in buf.value:
                        matched_hwnd.append(hwnd)
            return True

        cb = WNDENUMPROC(enum_cb)
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            matched_hwnd.clear()
            user32.EnumWindows(cb, 0)
            if matched_hwnd:
                for hwnd in matched_hwnd:
                    user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, hicon_big)
                    user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, hicon_small)
                break
            time.sleep(0.15)
    except Exception:
        pass


def main():
    if os.name == "nt":
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("RenderX.ImageStudio.RIS.2")
        except Exception:
            pass

    if not is_port_open():
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        subprocess.Popen(
            [str(PYW_EXE), str(SERVER_PY)],
            cwd=str(BASE_DIR),
            creationflags=flags,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(120):
            if is_port_open():
                break
            time.sleep(0.05)

    UI_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    chrome = find_chrome()
    if chrome:
        subprocess.Popen([
            chrome,
            "--app=http://127.0.0.1:8899",
            f"--user-data-dir={str(UI_PROFILE_DIR)}",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1440,900",
        ])
        apply_taskbar_icon_to_studio_window(ICON_PATH, timeout_sec=6.0)
    else:
        import webbrowser
        webbrowser.open("http://127.0.0.1:8899")


if __name__ == "__main__":
    main()
