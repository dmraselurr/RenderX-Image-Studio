"""
RenderX Image Studio - Desktop Multi-Profile Cluster Engine (FastAPI + Playwright)
Ported from RenderX Studio Pro's proven Chrome Profile Setup, Google Login detection,
Gemini Canvas (Share App + Concurrent Grid Streaming), and Google Flow (labs.google/fx/tools/flow).
"""

import asyncio
import base64
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from playwright.async_api import async_playwright, BrowserContext, Page, Frame

BASE_DIR = Path(__file__).resolve().parent
PROFILES_DIR = BASE_DIR / "profiles"
OUTPUTS_DIR = BASE_DIR / "outputs"
PROFILES_META_FILE = PROFILES_DIR / "profiles.json"

PRO_PROFILES_CANDIDATES = [
    Path(r"C:\Users\Raselur Rahman\Desktop\SaaS Tools\Render X Studio pro\ai_avatar_pipeline\browser_profiles"),
    Path(r"C:\Users\Raselur Rahman\Desktop\SaaS Tools\Render X Studio pro\src\backend\frameloom_engine\ai_avatar_pipeline\browser_profiles"),
]

PROFILES_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

GEMINI_SHARE_URL = "https://gemini.google.com/share/f8350ff50be0"
FLOW_URL = "https://labs.google/fx/tools/flow"

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
_GOOGLE_SIGNIN_COOKIES = (
    "SID",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "SAPISID",
    "APISID",
    "HSID",
    "SSID",
    "__Secure-1PAPISID",
    "__Secure-3PAPISID",
)


def find_chrome_exe() -> Optional[str]:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return shutil.which("chrome") or shutil.which("msedge")


CHROME_EXE = find_chrome_exe()

app = FastAPI(title="RenderX Image Studio Desktop Engine", version="2.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ================= Global State =================
class EngineState:
    def __init__(self):
        self.pw = None
        self.worker_contexts: Dict[str, BrowserContext] = {}
        self.login_open_pids: set = set()
        self.profile_locks: Dict[str, asyncio.Lock] = {}
        self.ws_clients: List[WebSocket] = []

        self.is_running = False
        self.should_stop = False
        self.current_items: List[Dict[str, Any]] = []
        self.current_engine = "gemini-canvas"
        self.current_sub_mode = "image"
        self.last_batch_dir: Path = OUTPUTS_DIR


state = EngineState()


def get_profile_lock(pid: str) -> asyncio.Lock:
    if pid not in state.profile_locks:
        state.profile_locks[pid] = asyncio.Lock()
    return state.profile_locks[pid]


# ================= Process & Chrome Window Helpers (from RenderX Studio Pro) =================
def get_chrome_pids_for_dir(user_data_dir: Path) -> List[int]:
    target = os.path.abspath(str(user_data_dir)).lower()
    if not target:
        return []
    try:
        out = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | "
                "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
            ],
            capture_output=True,
            text=True,
            timeout=25,
            creationflags=_NO_WINDOW,
        )
        rows = json.loads(out.stdout or "[]")
    except Exception:
        return []
    if isinstance(rows, dict):
        rows = [rows]
    return [
        int(row["ProcessId"])
        for row in rows
        if row.get("ProcessId") and target in (row.get("CommandLine") or "").lower()
    ]


def kill_stale_chrome(user_data_dir: Path) -> int:
    pids = get_chrome_pids_for_dir(user_data_dir)
    if not pids:
        return 0
    for pid in pids:
        try:
            subprocess.run(["taskkill", "/PID", str(pid)], capture_output=True, timeout=15, creationflags=_NO_WINDOW)
        except Exception:
            pass
    time.sleep(2.5)
    still = []
    for pid in pids:
        try:
            out = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"],
                capture_output=True,
                text=True,
                timeout=15,
                creationflags=_NO_WINDOW,
            )
            if str(pid) in (out.stdout or ""):
                still.append(pid)
        except Exception:
            pass
    for pid in still:
        try:
            subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, timeout=15, creationflags=_NO_WINDOW)
        except Exception:
            pass
    if still:
        time.sleep(1.5)
    return len(pids)


def _clear_lockfiles(p_path: Path):
    for name in ("lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"):
        lf = p_path / name
        if lf.exists():
            try:
                lf.unlink()
            except Exception:
                pass


def _normalize_window_placement(p_path: Path):
    prefs_path = p_path / "Default" / "Preferences"
    if not prefs_path.is_file():
        return
    try:
        data = json.loads(prefs_path.read_text(encoding="utf-8", errors="ignore"))
        browser_cfg = data.setdefault("browser", {})
        browser_cfg["window_placement"] = {
            "bottom": 670,
            "left": 50,
            "maximized": False,
            "right": 1230,
            "top": 30,
            "work_area_bottom": 1040,
            "work_area_left": 0,
            "work_area_right": 1920,
            "work_area_top": 0,
        }
        prefs_path.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def profile_login_state(profile_dir: Path) -> Dict[str, Any]:
    """
    Exact RenderX Studio Pro profile detection:
    1) Reads Default/Preferences for account_info email & REFRESH_TOKEN_RECEIVED
    2) Copies Default/Network/Cookies (or Default/Cookies) to temp sqlite DB to check _GOOGLE_SIGNIN_COOKIES
    """
    email: Optional[str] = None
    refresh_ok = False
    has_data = False

    prefs_path = profile_dir / "Default" / "Preferences"
    if prefs_path.is_file():
        has_data = True
        try:
            prefs = json.loads(prefs_path.read_text(encoding="utf-8", errors="ignore"))
            acc_info = prefs.get("account_info")
            if isinstance(acc_info, list) and len(acc_info) > 0 and isinstance(acc_info[0], dict):
                email = acc_info[0].get("email") or None
            gs = prefs.get("google", {}).get("services", {}).get("signin", {})
            if gs.get("REFRESH_TOKEN_RECEIVED") or gs.get("last_signed_in_account_info"):
                refresh_ok = True
        except Exception:
            pass

    cookie_ok = False
    locked = False
    for rel in ("Default/Network/Cookies", "Default/Cookies"):
        db = profile_dir / rel
        if not db.is_file():
            continue
        has_data = True
        fd, tmp = tempfile.mkstemp(prefix="rx_ck_", suffix=".db")
        os.close(fd)
        try:
            shutil.copy2(str(db), tmp)
            conn = sqlite3.connect(tmp)
            try:
                placeholders = ",".join("?" for _ in _GOOGLE_SIGNIN_COOKIES)
                row = conn.execute(
                    f"SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%google.com%' AND name IN ({placeholders})",
                    _GOOGLE_SIGNIN_COOKIES,
                ).fetchone()
                if row and row[0] > 0:
                    cookie_ok = True
                    break
            finally:
                conn.close()
        except Exception:
            locked = True
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass

    is_logged = bool(cookie_ok or (email and refresh_ok))
    if is_logged:
        status = f"Signed in ({email})" if email else "Signed in (Google cookies verified)"
        login_tag = "yes"
    elif locked:
        status = f"In use ({email})" if email else "Chrome open — sign in to Google"
        login_tag = "in_use"
    else:
        status = "Not signed in — Click Login"
        login_tag = "no"

    return {
        "login": login_tag,
        "logged_in": is_logged,
        "email": email or "",
        "has_data": has_data,
        "status": status,
    }


def open_real_chrome_for_login(pid: str, engine: str = "gemini-canvas") -> Tuple[bool, str]:
    """
    Exact RenderX Studio Pro Windows launcher:
    Clears stale lockfiles, fixes window placement, and launches real chrome.exe
    on accounts.google.com + Gemini Canvas / Google Flow so Google Sign-In never blocks!
    """
    chrome_bin = find_chrome_exe()
    if not chrome_bin:
        return False, "Google Chrome executable not found!"

    p_path = PROFILES_DIR / pid
    p_path.mkdir(parents=True, exist_ok=True)
    _clear_lockfiles(p_path)
    _normalize_window_placement(p_path)

    google_url = "https://accounts.google.com"
    engine_url = FLOW_URL if engine == "google-flow" else GEMINI_SHARE_URL

    try:
        bat_path = p_path / "launch_login.bat"
        bat_content = (
            f'@echo off\n'
            f'start "" "{chrome_bin}" --user-data-dir="{str(p_path)}" '
            f'--window-position=50,30 --window-size=1180,640 --new-window "{google_url}" "{engine_url}"\n'
        )
        bat_path.write_text(bat_content, encoding="utf-8")

        task_name = f"RenderXImgLogin_{pid}_{int(time.time())}"
        r = subprocess.run(
            ["schtasks", "/create", "/tn", task_name, "/tr", f'"{str(bat_path)}"', "/sc", "once", "/st", "23:59", "/f", "/it"],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=_NO_WINDOW,
        )
        if r.returncode == 0:
            subprocess.run(["schtasks", "/run", "/tn", task_name], capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW)
            time.sleep(0.8)
            subprocess.run(["schtasks", "/delete", "/tn", task_name, "/f"], capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW)
            return True, f"Opened real Chrome for {pid}"
    except Exception:
        pass

    try:
        subprocess.Popen(
            [
                chrome_bin,
                f"--user-data-dir={str(p_path)}",
                "--window-position=50,30",
                "--window-size=1180,640",
                "--new-window",
                google_url,
                engine_url,
            ]
        )
        return True, f"Opened Chrome for {pid}"
    except Exception as exc:
        return False, str(exc)


# ================= Profile Storage & Sync =================
def _find_pro_profiles_dir() -> Optional[Path]:
    for cand in PRO_PROFILES_CANDIDATES:
        if cand.is_dir():
            return cand
    return None


def default_profiles() -> List[Dict[str, Any]]:
    # Preserve existing empty acc1..acc8 or migrate empty legacy profile_01..08
    legacy_dirs = [PROFILES_DIR / f"profile_{i:02d}" for i in range(1, 9)]
    has_logged_legacy = any(
        d.is_dir() and profile_login_state(d).get("logged_in")
        for d in legacy_dirs
    )
    if not has_logged_legacy:
        for d in legacy_dirs:
            if d.is_dir() and not profile_login_state(d).get("has_data"):
                shutil.rmtree(d, ignore_errors=True)

    profiles = []
    for i in range(1, 9):
        pid = f"acc{i}"
        pdir = PROFILES_DIR / pid
        pdir.mkdir(parents=True, exist_ok=True)
        lstate = profile_login_state(pdir)
        profiles.append({
            "id": pid,
            "name": f"Account {i} ({pid})",
            "email": lstate["email"],
            "enabled": (i == 1) or lstate["logged_in"],
            "logged_in": lstate["logged_in"],
            "status": lstate["status"],
        })
    return profiles


def load_profiles(refresh_disk: bool = True) -> List[Dict[str, Any]]:
    if not PROFILES_META_FILE.exists():
        profs = default_profiles()
        save_profiles(profs)
        return profs
    try:
        data = json.loads(PROFILES_META_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list) and len(data) > 0:
            # Auto-upgrade old unlogged profile_01..08 list to acc1..acc8
            all_legacy = all(str(p.get("id", "")).startswith("profile_") for p in data)
            any_logged = any(
                (PROFILES_DIR / p["id"]).is_dir() and profile_login_state(PROFILES_DIR / p["id"]).get("logged_in")
                for p in data if p.get("id")
            )
            if all_legacy and not any_logged:
                profs = default_profiles()
                save_profiles(profs)
                return profs

            changed = False
            for p in data:
                pdir = PROFILES_DIR / p["id"]
                pdir.mkdir(parents=True, exist_ok=True)
                if refresh_disk:
                    lstate = profile_login_state(pdir)
                    if lstate["logged_in"] != bool(p.get("logged_in")) or lstate["email"] != (p.get("email") or ""):
                        p["logged_in"] = lstate["logged_in"]
                        p["email"] = lstate["email"]
                        p["status"] = lstate["status"]
                        if lstate["logged_in"] and not p.get("enabled"):
                            p["enabled"] = True
                        changed = True
                    elif p.get("status") != lstate["status"]:
                        p["status"] = lstate["status"]
                        changed = True
            if changed:
                save_profiles(data)
            return data
    except Exception:
        pass
    profs = default_profiles()
    save_profiles(profs)
    return profs


def save_profiles(profiles: List[Dict[str, Any]]):
    PROFILES_META_FILE.write_text(json.dumps(profiles, indent=2), encoding="utf-8")


def public_profile_view(p: Dict[str, Any]) -> Dict[str, Any]:
    pid = p["id"]
    return {
        "id": pid,
        "name": p.get("name", pid),
        "email": p.get("email", ""),
        "enabled": bool(p.get("enabled", False)),
        "logged_in": bool(p.get("logged_in", False)),
        "status": p.get("status", ""),
        "canvas_ready": bool(p.get("logged_in", False)),
        "flow_ready": bool(p.get("logged_in", False)),
        "is_login_open": pid in state.login_open_pids,
        "is_worker_active": pid in state.worker_contexts,
    }


async def broadcast_ws(payload: Dict[str, Any]):
    dead = []
    for ws in list(state.ws_clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in state.ws_clients:
            state.ws_clients.remove(ws)


# ================= Helpers =================
def sanitize_prompt(raw: str) -> str:
    if not raw:
        return ""
    text = str(raw).replace("\r", " ").replace("\n", " ")
    text = re.sub(r"^\s*\[?[0-9.:\-\s]+\]?\s*\|\s*(Scene\s*\d+\s*:?\s*)?", "", text, flags=re.I)
    text = re.sub(r"^\s*\[[0-9.:\-\s]+\]\s*(Scene\s*\d+\s*:?\s*)?", "", text, flags=re.I)
    text = re.sub(r"^\s*Scene\s*\d+\s*:?\s*", "", text, flags=re.I)
    text = re.sub(r"Master Style DNA locked\.?", "", text, flags=re.I)
    text = re.sub(r"Style DNA locked\.?", "", text, flags=re.I)

    def repl_no(m):
        terms = m.group(1).rstrip("., ").strip()
        return f" Clean composition, strictly avoiding {terms}." if terms else ""

    text = re.sub(r"--no:?\s+([^\n]+)", repl_no, text, flags=re.I)
    return re.sub(r"\s{2,}", " ", text).strip()


def save_data_url_to_disk(data_url: str, target_path: Path):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if data_url.startswith("data:") and "," in data_url:
        _, b64 = data_url.split(",", 1)
        target_path.write_bytes(base64.b64decode(b64))


async def get_or_open_worker_context(pid: str, clear_existing_chrome: bool = False) -> BrowserContext:
    """
    Opens a minimized real-Chrome Playwright persistent context (RenderX Studio Pro style)
    so Google Canvas & Flow sessions work reliably in the background without triggering headless detection.
    """
    if pid in state.worker_contexts and not clear_existing_chrome:
        try:
            _ = state.worker_contexts[pid].pages
            return state.worker_contexts[pid]
        except Exception:
            state.worker_contexts.pop(pid, None)

    if pid in state.worker_contexts:
        try:
            await state.worker_contexts[pid].close()
        except Exception:
            pass
        state.worker_contexts.pop(pid, None)

    p_path = PROFILES_DIR / pid
    p_path.mkdir(parents=True, exist_ok=True)

    # Release any real Chrome login window still locking this profile directory
    await asyncio.to_thread(kill_stale_chrome, p_path)
    state.login_open_pids.discard(pid)
    _clear_lockfiles(p_path)

    kwargs: Dict[str, Any] = {
        "user_data_dir": str(p_path),
        "headless": False,
        "accept_downloads": True,
        "timeout": 120_000,
        "viewport": {"width": 1280, "height": 900},
        "ignore_default_args": ["--enable-automation", "--disable-extensions"],
        "args": [
            "--start-minimized",
            "--window-position=-32000,-32000",
            "--window-size=1280,900",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
        ],
    }
    if CHROME_EXE:
        kwargs["executable_path"] = CHROME_EXE

    ctx = await state.pw.chromium.launch_persistent_context(**kwargs)
    state.worker_contexts[pid] = ctx

    # Ensure window stays minimized/off-screen via CDP so batch Chrome workers never pop onto active screen
    try:
        pg0 = ctx.pages[0] if ctx.pages else await ctx.new_page()
        cdp = await ctx.new_cdp_session(pg0)
        win = await cdp.send("Browser.getWindowForTarget")
        await cdp.send("Browser.setWindowBounds", {"windowId": win["windowId"], "bounds": {"windowState": "minimized"}})
    except Exception:
        pass

    def on_ctx_close(_):
        state.worker_contexts.pop(pid, None)
        asyncio.create_task(broadcast_ws({"type": "PROFILES_UPDATED"}))

    ctx.on("close", on_ctx_close)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return ctx


async def handle_shot_result(pid: str, res: Dict[str, Any], item_map: Dict[int, Dict[str, Any]], batch_dir: Path, sub_mode: str):
    idx = res["index"]
    item = item_map.get(idx)
    if not item or item.get("status") == "done":
        return

    if res.get("ok") and res.get("dataUrl"):
        data_url = res["dataUrl"]
        if data_url.startswith("https://"):
            try:
                import aiohttp
                async with aiohttp.ClientSession() as sess:
                    async with sess.get(data_url, timeout=aiohttp.ClientTimeout(total=45)) as r:
                        if r.status == 200:
                            raw_bytes = await r.read()
                            ct = r.headers.get("content-type", "image/png" if "video" not in sub_mode else "video/mp4").split(";")[0]
                            data_url = f"data:{ct};base64,{base64.b64encode(raw_bytes).decode('ascii')}"
            except Exception:
                pass

        item["dataUrl"] = data_url
        item["status"] = "done"
        fn = item.get("filename") or (f"{idx:02d}.mp4" if "video" in sub_mode else f"{idx:02d}.png")
        save_data_url_to_disk(data_url, batch_dir / fn)

        completed = sum(1 for x in state.current_items if x.get("status") == "done")
        await broadcast_ws({
            "type": "ITEM_COMPLETED",
            "index": idx,
            "profileId": pid,
            "httpStatus": res.get("httpStatus", 200),
            "mediaType": "video" if "video" in sub_mode else "image",
            "dataUrl": data_url,
            "completedCount": completed,
            "total": len(state.current_items),
        })
        await broadcast_ws({
            "type": "DIAGNOSTIC_LOG",
            "text": f"[{pid}] Shot #{idx}: Saved {fn} ({completed}/{len(state.current_items)})"
        })
    else:
        item["status"] = "failed"
        item["error"] = res.get("error", "Unknown error")
        await broadcast_ws({
            "type": "ITEM_FAILED",
            "index": idx,
            "profileId": pid,
            "httpStatus": res.get("httpStatus", 0),
            "error": f"[{pid}] {item['error']}"
        })
        await broadcast_ws({
            "type": "DIAGNOSTIC_LOG",
            "isError": True,
            "text": f"[{pid}] Shot #{idx} Failed: {item['error']}"
        })


# ================= Gemini Canvas Worker (bulkgem.py Proven Logic + Live Streaming) =================
async def _find_canvas_frame(page: Page, timeout_sec: int = 75) -> Frame:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if await frame.locator("#prompts").count() > 0:
                    return frame
                if await frame.locator("textarea").count() > 0 and await frame.locator("button").count() > 0:
                    url_l = (frame.url or "").lower()
                    if url_l and "about:blank" not in url_l:
                        return frame
            except Exception:
                continue
        await asyncio.sleep(1.5)
    signed_out = await page.get_by_role("link", name="Sign in").count() > 0
    if signed_out:
        raise RuntimeError("Profile signed out of Google. Open Login for this account and sign in once.")
    raise RuntimeError("Gemini Canvas app frame did not render within timeout.")


async def _dismiss_canvas_gates(page: Page):
    for label in ("Continue", "Got it"):
        try:
            btn = page.get_by_role("button", name=label, exact=True)
            if await btn.count() > 0:
                await btn.first.click(force=True, timeout=4000)
                await asyncio.sleep(1.5)
                break
        except Exception:
            pass
    try:
        banner = page.get_by_text("You need to sign in with your Google Account", exact=False)
        if await banner.count() > 0:
            close_btn = page.locator("button[aria-label='Close']").first
            if await close_btn.count() > 0:
                await close_btn.click(timeout=2500)
    except Exception:
        pass


async def _read_canvas_prompt_count(frame: Frame) -> Optional[int]:
    try:
        counter = frame.locator("#prompt-count")
        if await counter.count() > 0:
            txt = await counter.inner_text()
            m = re.search(r"(\d[\d,]*)\s*prompts?\b", txt or "", re.I)
            if m:
                return int(m.group(1).replace(",", ""))
    except Exception:
        pass
    try:
        hits = await frame.evaluate("""() => {
            const out = [];
            for (const el of document.querySelectorAll('*')) {
                if (el.children.length) continue;
                const t = (el.textContent || '').trim();
                if (/^\\d[\\d,]*\\s*prompts?$/i.test(t)) out.push(t);
            }
            return out;
        }""")
        if hits:
            m = re.search(r"(\d[\d,]*)\s*prompts?\b", hits[-1], re.I)
            if m:
                return int(m.group(1).replace(",", ""))
    except Exception:
        pass
    return None


async def run_canvas_profile_worker(
    profile: Dict[str, Any],
    assigned_items: List[Dict[str, Any]],
    item_map: Dict[int, Dict[str, Any]],
    batch_dir: Path,
    options: Optional[Dict[str, Any]] = None,
):
    pid = profile["id"]
    options = options or {}
    async with get_profile_lock(pid):
        ctx = await get_or_open_worker_context(pid)
        page: Page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        try:
            await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Opening Gemini Canvas in background Chrome..."})
            await page.goto(GEMINI_SHARE_URL, wait_until="domcontentloaded", timeout=90000)
            await asyncio.sleep(3.0)
            await _dismiss_canvas_gates(page)

            frame = await _find_canvas_frame(page, timeout_sec=75)
            await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Gemini Canvas app ready! Preparing {len(assigned_items)} shot(s)..."})

            # Group by aspect ratio while preserving order (typically all shots share one aspect ratio)
            groups: List[Tuple[str, List[Dict[str, Any]]]] = []
            for it in assigned_items:
                ar = it.get("aspectRatio", "1:1")
                if not groups or groups[-1][0] != ar:
                    groups.append((ar, [it]))
                else:
                    groups[-1][1].append(it)

            for group_idx, (ar, group_items) in enumerate(groups):
                if state.should_stop:
                    break
                if group_idx > 0:
                    await page.goto(GEMINI_SHARE_URL, wait_until="domcontentloaded", timeout=90000)
                    await asyncio.sleep(2.5)
                    await _dismiss_canvas_gates(page)
                    frame = await _find_canvas_frame(page, timeout_sec=60)

                # Switch to Image Generator tab
                tab_btn = frame.locator("button[data-tab='image']")
                if await tab_btn.count() > 0:
                    await tab_btn.first.click()
                    await asyncio.sleep(0.4)

                # Set Aspect Ratio
                ar_map = {"16:9": "landscape", "9:16": "portrait", "1:1": "square"}
                ar_val = ar_map.get(ar, "square")
                ar_sel = frame.locator("#aspectRatio")
                if await ar_sel.count() > 0:
                    try:
                        await ar_sel.select_option(value=ar_val)
                    except Exception:
                        pass

                # Optional Character Consistency (ref image / description)
                char_ref_b64 = options.get("charImageBase64") or ""
                char_desc = options.get("charDesc") or ""
                if (char_ref_b64 and "," in char_ref_b64) or char_desc:
                    try:
                        cc_toggle = frame.locator("#ccToggle")
                        if await cc_toggle.count() > 0 and not await cc_toggle.is_checked():
                            await cc_toggle.evaluate("""(el) => {
                                el.checked = true;
                                el.dispatchEvent(new Event('input', {bubbles: true}));
                                el.dispatchEvent(new Event('change', {bubbles: true}));
                            }""")
                            await asyncio.sleep(0.6)
                        if char_desc and await frame.locator("textarea.cc-text-input").count() > 0:
                            await frame.locator("textarea.cc-text-input").first.fill(char_desc[:600])
                        if char_ref_b64 and "," in char_ref_b64:
                            fd, tmp_img = tempfile.mkstemp(prefix="rx_char_", suffix=".png")
                            os.close(fd)
                            Path(tmp_img).write_bytes(base64.b64decode(char_ref_b64.split(",", 1)[1]))
                            await frame.locator("input.cc-image-input").first.set_input_files(tmp_img)
                            await asyncio.sleep(0.8)
                            try:
                                os.remove(tmp_img)
                            except OSError:
                                pass
                    except Exception as cc_err:
                        await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Char ref note: {cc_err}"})

                # Optional Style Consistency (ref image / description)
                style_ref_b64 = options.get("styleImageBase64") or ""
                style_desc = options.get("styleDesc") or ""
                if (style_ref_b64 and "," in style_ref_b64) or style_desc:
                    try:
                        sc_toggle = frame.locator("#scToggle")
                        if await sc_toggle.count() > 0 and not await sc_toggle.is_checked():
                            await sc_toggle.evaluate("""(el) => {
                                el.checked = true;
                                el.dispatchEvent(new Event('input', {bubbles: true}));
                                el.dispatchEvent(new Event('change', {bubbles: true}));
                            }""")
                            await asyncio.sleep(0.6)
                        if style_desc and await frame.locator("#scText").count() > 0:
                            await frame.locator("#scText").first.fill(style_desc[:600])
                        if style_ref_b64 and "," in style_ref_b64 and await frame.locator("#scImage").count() > 0:
                            fd, tmp_simg = tempfile.mkstemp(prefix="rx_style_", suffix=".png")
                            os.close(fd)
                            Path(tmp_simg).write_bytes(base64.b64decode(style_ref_b64.split(",", 1)[1]))
                            await frame.locator("#scImage").first.set_input_files(tmp_simg)
                            await asyncio.sleep(0.8)
                            try:
                                os.remove(tmp_simg)
                            except OSError:
                                pass
                    except Exception as sc_err:
                        await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Style ref note: {sc_err}"})

                # Fill prompts cleanly (1 line per prompt) and verify counter matches!
                clean_prompts = [sanitize_prompt(it["fullPrompt"]) for it in group_items]
                joined_text = "\n".join(clean_prompts)
                prompt_box = frame.locator("#prompts")
                if await prompt_box.count() == 0:
                    prompt_box = frame.locator("textarea").last

                for attempt in range(3):
                    await prompt_box.click()
                    await prompt_box.fill("")
                    await asyncio.sleep(0.3)
                    await prompt_box.fill(joined_text)
                    await asyncio.sleep(1.2)
                    parsed_cnt = await _read_canvas_prompt_count(frame)
                    if parsed_cnt is None or parsed_cnt == len(group_items):
                        break

                for it in group_items:
                    await broadcast_ws({"type": "ITEM_STARTED", "index": it["index"]})

                gen_btn = frame.locator("#generate-btn")
                if await gen_btn.count() == 0:
                    gen_btn = frame.get_by_role("button", name=re.compile("generate images", re.I)).first
                await gen_btn.click()
                await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Canvas batch started ({len(group_items)} prompts) — streaming live..."})

                # Live poll #image-grid tiles as Gemini Canvas completes each prompt concurrently
                done_slots = set()
                max_wait_sec = max(240, len(group_items) * 20)
                start_ts = time.time()
                started_generating = False

                while time.time() - start_ts < max_wait_sec and not state.should_stop:
                    await asyncio.sleep(1.3)

                    try:
                        stop_vis = await frame.locator("#stop-btn").is_visible()
                    except Exception:
                        stop_vis = False
                    if stop_vis:
                        started_generating = True

                    # Extract any newly completed rendered images from #image-grid in exact card order
                    extracted = await frame.evaluate("""async (alreadyDone) => {
                        const grid = document.querySelector('#image-grid');
                        if (!grid) return { tiles: [], totalCards: 0 };
                        const cards = Array.from(grid.children);
                        const out = [];
                        for (let i = 0; i < cards.length; i++) {
                            if (alreadyDone.includes(i)) continue;
                            const img = cards[i].querySelector('img');
                            if (img && img.src && img.complete && (img.naturalWidth > 64 || img.width > 64)) {
                                try {
                                    const r = await fetch(img.src);
                                    const b = await r.blob();
                                    const b64 = await new Promise((res) => {
                                        const fr = new FileReader();
                                        fr.onloadend = () => res(fr.result);
                                        fr.readAsDataURL(b);
                                    });
                                    out.push({ slot: i, ok: true, dataUrl: b64 });
                                } catch (e) {
                                    try {
                                        const c = document.createElement('canvas');
                                        c.width = img.naturalWidth || 1024;
                                        c.height = img.naturalHeight || 1024;
                                        c.getContext('2d').drawImage(img, 0, 0);
                                        out.push({ slot: i, ok: true, dataUrl: c.toDataURL('image/png') });
                                    } catch (e2) {}
                                }
                            }
                        }
                        return { tiles: out, totalCards: cards.length };
                    }""", list(done_slots))

                    for tile in extracted.get("tiles", []):
                        slot = tile["slot"]
                        if slot < len(group_items) and slot not in done_slots:
                            done_slots.add(slot)
                            it = group_items[slot]
                            await handle_shot_result(
                                pid,
                                {"index": it["index"], "ok": True, "httpStatus": 200, "dataUrl": tile["dataUrl"]},
                                item_map,
                                batch_dir,
                                "image",
                            )

                    if len(done_slots) >= len(group_items):
                        break

                    # If Stop button appeared and then disappeared, Canvas finished initial render
                    if started_generating and not stop_vis:
                        await asyncio.sleep(1.8)
                        # Final sweep for tiles that just finished painting
                        final_ext = await frame.evaluate("""async (alreadyDone) => {
                            const grid = document.querySelector('#image-grid');
                            if (!grid) return [];
                            const cards = Array.from(grid.children);
                            const out = [];
                            for (let i = 0; i < cards.length; i++) {
                                if (alreadyDone.includes(i)) continue;
                                const img = cards[i].querySelector('img');
                                if (img && img.src && img.complete && (img.naturalWidth > 64 || img.width > 64)) {
                                    try {
                                        const r = await fetch(img.src);
                                        const b = await r.blob();
                                        const b64 = await new Promise((res) => {
                                            const fr = new FileReader();
                                            fr.onloadend = () => res(fr.result);
                                            fr.readAsDataURL(b);
                                        });
                                        out.push({ slot: i, dataUrl: b64 });
                                    } catch (e) {}
                                }
                            }
                            return out;
                        }""", list(done_slots))
                        for tile in final_ext:
                            slot = tile["slot"]
                            if slot < len(group_items) and slot not in done_slots:
                                done_slots.add(slot)
                                it = group_items[slot]
                                await handle_shot_result(pid, {"index": it["index"], "ok": True, "httpStatus": 200, "dataUrl": tile["dataUrl"]}, item_map, batch_dir, "image")

                        # Auto-retry failed tiles once if Canvas shows Select Failed button (bulkgem.py parity)
                        try:
                            sel_fail = frame.locator("#select-failed-btn")
                            if len(done_slots) < len(group_items) and await sel_fail.count() > 0 and await sel_fail.is_visible():
                                await sel_fail.click()
                                await asyncio.sleep(0.7)
                                regen = frame.locator("#bulk-regen-btn")
                                if await regen.count() > 0 and await regen.is_visible():
                                    await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Retrying failed Canvas tiles automatically..."})
                                    await regen.click()
                                    await asyncio.sleep(0.8)
                                    confirm = frame.locator("#confirm-regen-btn")
                                    if await confirm.count() > 0 and await confirm.is_visible():
                                        await confirm.click()
                                    started_generating = False
                                    continue
                        except Exception:
                            pass
                        break

                # Mark any unrendered tiles after Canvas finishes
                for slot, it in enumerate(group_items):
                    if it.get("status") not in ("done", "failed"):
                        await handle_shot_result(
                            pid,
                            {"index": it["index"], "ok": False, "httpStatus": 0, "error": "Shot failed or refused by Gemini Canvas"},
                            item_map,
                            batch_dir,
                            "image",
                        )

        except Exception as err:
            for it in assigned_items:
                if it.get("status") not in ("done", "failed"):
                    await handle_shot_result(
                        pid,
                        {"index": it["index"], "ok": False, "httpStatus": 0, "error": str(err)},
                        item_map,
                        batch_dir,
                        "image",
                    )


# ================= Google Flow Worker (RenderX Pro Flow + Concurrent Fallback) =================
FLOW_EVAL_BATCH_JS = r"""
async ({ items, template }) => {
  const results = [];
  const rawUrl = template.url;
  const rawBody = template.body;
  const rawHeaders = template.headers || {};

  const FORBIDDEN = new Set(['content-length', 'host', 'origin', 'referer', 'cookie', 'user-agent', 'accept-encoding', 'connection', 'priority']);
  const safeHeaders = { 'Content-Type': 'application/json' };
  for (const [k, v] of Object.entries(rawHeaders)) {
    const low = k.toLowerCase();
    if (!FORBIDDEN.has(low) && !low.startsWith('sec-') && v) safeHeaders[k] = v;
  }

  function findSiteKey() {
    for (const s of document.querySelectorAll('script[src*="recaptcha"]')) {
      const m = (s.src || '').match(/[?&]render=([^&]+)/);
      if (m && m[1] && m[1] !== 'explicit') return m[1];
    }
    return '';
  }

  async function getRecaptcha() {
    const sk = findSiteKey();
    if (sk && window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.execute === 'function') {
      try { return await window.grecaptcha.enterprise.execute(sk, { action: 'FLOW_GENERATION' }); } catch (e) {}
    }
    return '';
  }

  function mapRatio(ar) {
    if (ar === '16:9') return 'IMAGE_ASPECT_RATIO_LANDSCAPE';
    if (ar === '9:16') return 'IMAGE_ASPECT_RATIO_PORTRAIT';
    return 'IMAGE_ASPECT_RATIO_SQUARE';
  }

  function patchBody(rawStr, newPrompt, ar, recaptcha) {
    const obj = JSON.parse(rawStr);
    const seed = Math.floor(100000 + Math.random() * 9000000);
    if (obj.clientContext) {
      obj.clientContext.sessionId = `;${Date.now()}`;
      if (recaptcha) obj.clientContext.recaptchaContext = { applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB', token: recaptcha };
    }
    if (Array.isArray(obj.requests) && obj.requests.length > 0) {
      const r0 = { ...obj.requests[0], prompt: newPrompt };
      if ('seed' in r0) r0.seed = seed;
      if ('imageAspectRatio' in r0) r0.imageAspectRatio = mapRatio(ar);
      obj.requests = [r0];
    } else if (typeof obj.prompt === 'string') {
      obj.prompt = newPrompt;
    }
    return JSON.stringify(obj);
  }

  function extractMedia(json) {
    let found = null;
    function scan(n) {
      if (found || !n) return;
      if (typeof n === 'object') {
        if (n.encodedImage) { found = n.encodedImage.startsWith('data:') ? n.encodedImage : `data:image/png;base64,${n.encodedImage}`; return; }
        if (n.fifeUrl) { found = n.fifeUrl; return; }
        if (n.videoUrl) { found = n.videoUrl; return; }
        if (Array.isArray(n)) n.forEach(scan);
        else Object.values(n).forEach(scan);
      }
    }
    scan(json);
    return found;
  }

  let idx = 0;
  const concurrency = Math.min(6, items.length);
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      const item = items[i];
      let done = false, status = 0, errMsg = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const tok = await getRecaptcha();
          const resp = await fetch(rawUrl, {
            method: 'POST',
            credentials: 'include',
            headers: safeHeaders,
            body: patchBody(rawBody, item.prompt, item.aspectRatio || '1:1', tok)
          });
          status = resp.status;
          const txt = await resp.text();
          if (!resp.ok) {
            errMsg = `HTTP ${resp.status}: ${txt.replace(/\s+/g, ' ').slice(0, 140)}`;
            if (resp.status === 429 || resp.status >= 500) { await new Promise(r => setTimeout(r, 900 * attempt)); continue; }
            break;
          }
          const media = extractMedia(JSON.parse(txt));
          if (!media) { errMsg = `HTTP ${status}: No media in Flow response`; break; }
          const obj = { index: item.index, ok: true, httpStatus: status, dataUrl: media };
          results.push(obj);
          if (window.__rxOnShotDone) window.__rxOnShotDone(obj);
          done = true;
          break;
        } catch (e) {
          errMsg = `HTTP ${status || 'ERR'}: ${e.message}`;
          if (attempt < 2) await new Promise(r => setTimeout(r, 700));
        }
      }
      if (!done) {
        const failObj = { index: item.index, ok: false, httpStatus: status, error: errMsg };
        results.push(failObj);
        if (window.__rxOnShotDone) window.__rxOnShotDone(failObj);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
"""


async def _flow_dismiss_banners(page: Page):
    for name in ("Dismiss", "close Dismiss", "Close", "Got it", "I agree"):
        try:
            btn = page.get_by_role("button", name=name)
            if await btn.count() > 0:
                await btn.first.click(timeout=2500)
                await asyncio.sleep(0.5)
        except Exception:
            pass


async def _flow_configure(page: Page, aspect_ratio: str = "1:1"):
    ar_icon = "crop_9_16" if aspect_ratio == "9:16" else ("crop_16_9" if aspect_ratio == "16:9" else "crop_square")
    try:
        combo = page.locator('button:has-text("crop_16_9"), button:has-text("crop_9_16"), button:has-text("crop_square"), button[aria-label*="crop"]').first
        if await combo.count() > 0 and await combo.is_visible():
            await combo.click(timeout=4000)
            await asyncio.sleep(0.5)
            for label in (ar_icon, aspect_ratio, "x1", "1"):
                opt = page.get_by_text(label, exact=True).first
                if await opt.count() > 0 and await opt.is_visible():
                    try:
                        await opt.click(timeout=2500)
                        await asyncio.sleep(0.3)
                    except Exception:
                        pass
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.3)
    except Exception:
        pass


async def _flow_submit_ui_shot(page: Page, item: Dict[str, Any], sub_mode: str, timeout_sec: int = 90) -> str:
    clean_p = sanitize_prompt(item["fullPrompt"])
    is_video = "video" in sub_mode
    await _flow_configure(page, item.get("aspectRatio", "1:1"))

    # Select Image vs Video mode if available
    try:
        mode_name = "Videos" if is_video else "Images"
        for cand in (mode_name, "Video" if is_video else "Image"):
            mbtn = page.get_by_role("button", name=cand, exact=True)
            if await mbtn.count() > 0 and await mbtn.first.is_visible():
                await mbtn.first.click()
                await asyncio.sleep(0.4)
                break
    except Exception:
        pass

    # If image-to-video & reference image provided, upload to Flow
    ref_b64 = item.get("referenceImage") or ""
    if is_video and ref_b64 and "," in ref_b64:
        try:
            add_btn = page.get_by_role("button", name=re.compile("Add Media|Add|Upload", re.I)).first
            if await add_btn.count() > 0 and await add_btn.is_visible():
                await add_btn.click()
                await asyncio.sleep(0.8)
            file_inp = page.locator("input[type=file]").first
            if await file_inp.count() > 0:
                fd, tmp_ref = tempfile.mkstemp(prefix="rx_flow_", suffix=".png")
                os.close(fd)
                Path(tmp_ref).write_bytes(base64.b64decode(ref_b64.split(",", 1)[1]))
                await file_inp.set_input_files(tmp_ref)
                await asyncio.sleep(1.5)
                await _flow_dismiss_banners(page)
                try:
                    os.remove(tmp_ref)
                except OSError:
                    pass
        except Exception:
            pass

    media_sel = 'video[src], img[src*="googleusercontent"], img[src^="blob:"], img[src^="data:image"]'
    before_srcs = set(
        await page.evaluate(
            f"() => Array.from(document.querySelectorAll('{media_sel}')).map(el => el.src).filter(Boolean)"
        )
    )

    compose = page.locator('textarea, [contenteditable="true"]').last
    await compose.wait_for(state="visible", timeout=25000)
    await compose.click()
    try:
        await compose.fill(clean_p)
    except Exception:
        await page.keyboard.press("Control+A")
        await page.keyboard.type(clean_p)
    await asyncio.sleep(0.4)

    # Click Create/Generate button or press Enter
    create_btn = page.locator('button[aria-label*="Create"], button[aria-label*="Generate"], button:has-text("Create"), button:has-text("Generate")').last
    if await create_btn.count() > 0 and await create_btn.first.is_visible():
        await create_btn.first.click()
    else:
        await compose.press("Enter")

    deadline = time.time() + timeout_sec
    while time.time() < deadline and not state.should_stop:
        await asyncio.sleep(1.5)
        await _flow_dismiss_banners(page)
        now_items = await page.evaluate(f"""async () => {{
            const els = Array.from(document.querySelectorAll('{media_sel}'));
            return els.map(el => ({{ tag: el.tagName, src: el.src || '', w: el.naturalWidth || el.videoWidth || 200 }}));
        }}""")
        for entry in reversed(now_items):
            src = entry.get("src", "")
            if not src or src in before_srcs:
                continue
            if entry.get("tag") == "IMG" and entry.get("w", 0) < 64:
                continue
            if src.startswith("blob:"):
                b64 = await page.evaluate("""async (s) => {
                    const r = await fetch(s);
                    const b = await r.blob();
                    return await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(b); });
                }""", src)
                return b64
            return src

    raise RuntimeError("Timed out waiting for Google Flow render")


async def run_flow_profile_worker(
    profile: Dict[str, Any],
    assigned_items: List[Dict[str, Any]],
    item_map: Dict[int, Dict[str, Any]],
    sub_mode: str,
    batch_dir: Path,
):
    pid = profile["id"]
    async with get_profile_lock(pid):
        ctx = await get_or_open_worker_context(pid)
        page: Page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        captured: Dict[str, Any] = {}

        def on_request(req):
            if "aisandbox-pa.googleapis.com" in req.url:
                hdrs = dict(req.headers)
                is_gen = any(k in req.url for k in ("batchGenerateImages", "runImageFx", "flowMedia", "batchGenerateVideo"))
                if is_gen and req.post_data:
                    captured["url"] = req.url
                    captured["headers"] = hdrs
                    captured["body"] = req.post_data
                elif hdrs.get("authorization"):
                    captured["headers"] = {**captured.get("headers", {}), **hdrs}

        page.on("request", on_request)

        try:
            await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Opening Google Flow in background Chrome..."})
            await page.goto(FLOW_URL, wait_until="domcontentloaded", timeout=90000)
            await asyncio.sleep(3.5)
            await _flow_dismiss_banners(page)

            if "accounts.google.com" in (page.url or "").lower():
                raise RuntimeError("Profile signed out of Google Flow. Click Login for this profile first.")

            # Enter clean project workspace if on home list
            try:
                new_btn = page.get_by_role("button", name="New project").first
                if await new_btn.count() > 0 and await new_btn.is_visible():
                    await new_btn.click()
                    await asyncio.sleep(2.5)
                    await _flow_dismiss_banners(page)
            except Exception:
                pass

            async def on_shot_done(res):
                await handle_shot_result(pid, res, item_map, batch_dir, sub_mode)

            try:
                await page.expose_function("__rxOnShotDone", on_shot_done)
            except Exception:
                pass

            remaining = list(assigned_items)
            first = remaining.pop(0)
            await broadcast_ws({"type": "ITEM_STARTED", "index": first["index"]})
            await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Submitting Shot #{first['index']} inside Google Flow..."})

            first_media = await _flow_submit_ui_shot(page, first, sub_mode, timeout_sec=120)
            await handle_shot_result(pid, {"index": first["index"], "ok": True, "httpStatus": 200, "dataUrl": first_media}, item_map, batch_dir, sub_mode)

            # Fast parallel API replay if live Bearer + payload was captured; fallback to Flow UI per-shot otherwise
            if remaining and not state.should_stop:
                if captured.get("url") and captured.get("body") and "video" not in sub_mode:
                    for it in remaining:
                        await broadcast_ws({"type": "ITEM_STARTED", "index": it["index"]})
                    eval_items = [
                        {"index": it["index"], "prompt": sanitize_prompt(it["fullPrompt"]), "aspectRatio": it.get("aspectRatio", "1:1")}
                        for it in remaining
                    ]
                    api_results = await page.evaluate(FLOW_EVAL_BATCH_JS, {"items": eval_items, "template": captured})
                    failed_fallback = [it for it in remaining if not any(r.get("index") == it["index"] and r.get("ok") for r in api_results)]
                    # Fallback sequentially in Flow UI for any shot blocked by reCAPTCHA/API check
                    for it in failed_fallback:
                        if state.should_stop or it.get("status") == "done":
                            continue
                        it["status"] = "generating"
                        try:
                            m = await _flow_submit_ui_shot(page, it, sub_mode, timeout_sec=120)
                            await handle_shot_result(pid, {"index": it["index"], "ok": True, "httpStatus": 200, "dataUrl": m}, item_map, batch_dir, sub_mode)
                        except Exception as e2:
                            await handle_shot_result(pid, {"index": it["index"], "ok": False, "httpStatus": 0, "error": str(e2)}, item_map, batch_dir, sub_mode)
                else:
                    for it in remaining:
                        if state.should_stop:
                            break
                        await broadcast_ws({"type": "ITEM_STARTED", "index": it["index"]})
                        try:
                            m = await _flow_submit_ui_shot(page, it, sub_mode, timeout_sec=120)
                            await handle_shot_result(pid, {"index": it["index"], "ok": True, "httpStatus": 200, "dataUrl": m}, item_map, batch_dir, sub_mode)
                        except Exception as e2:
                            await handle_shot_result(pid, {"index": it["index"], "ok": False, "httpStatus": 0, "error": str(e2)}, item_map, batch_dir, sub_mode)

        except Exception as err:
            for it in assigned_items:
                if it.get("status") not in ("done", "failed"):
                    await handle_shot_result(pid, {"index": it["index"], "ok": False, "httpStatus": 0, "error": str(err)}, item_map, batch_dir, sub_mode)


# ================= Background Login Watcher =================
async def _watch_real_chrome_login(pid: str):
    state.login_open_pids.add(pid)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    p_path = PROFILES_DIR / pid
    try:
        for _ in range(180):  # up to 6 minutes watching while user signs in
            await asyncio.sleep(2.0)
            lstate = await asyncio.to_thread(profile_login_state, p_path)
            pids = await asyncio.to_thread(get_chrome_pids_for_dir, p_path)

            profs = load_profiles(refresh_disk=False)
            changed = False
            for p in profs:
                if p["id"] == pid:
                    if lstate["logged_in"] != bool(p.get("logged_in")) or lstate["email"] != (p.get("email") or ""):
                        p["logged_in"] = lstate["logged_in"]
                        p["email"] = lstate["email"]
                        p["status"] = lstate["status"]
                        if lstate["logged_in"]:
                            p["enabled"] = True
                        changed = True
            if changed:
                save_profiles(profs)
                await broadcast_ws({"type": "PROFILES_UPDATED"})

            if not pids and len(state.login_open_pids) > 0:
                # Chrome window closed by user
                break
    finally:
        state.login_open_pids.discard(pid)
        load_profiles(refresh_disk=True)
        await broadcast_ws({"type": "PROFILES_UPDATED"})


# ================= FastAPI Lifecycle & Endpoints =================
@app.on_event("startup")
async def on_startup():
    state.pw = await async_playwright().start()
    load_profiles(refresh_disk=True)


@app.on_event("shutdown")
async def on_shutdown():
    for ctx in list(state.worker_contexts.values()):
        try:
            await ctx.close()
        except Exception:
            pass
    if state.pw:
        await state.pw.stop()


@app.get("/")
async def serve_root():
    return FileResponse(BASE_DIR / "dashboard.html")


@app.get("/api/status")
async def api_status():
    profiles = load_profiles(refresh_disk=True)
    pro_dir = _find_pro_profiles_dir()
    pro_count = len([d for d in pro_dir.iterdir() if d.is_dir() and profile_login_state(d)["logged_in"]]) if pro_dir else 0
    return {
        "success": True,
        "desktopMode": True,
        "isQueueRunning": state.is_running,
        "chromeFound": bool(CHROME_EXE),
        "outputDir": str(state.last_batch_dir),
        "proImportCount": pro_count,
        "profiles": [public_profile_view(p) for p in profiles],
    }


@app.get("/api/profiles")
async def api_list_profiles():
    profiles = load_profiles(refresh_disk=True)
    pro_dir = _find_pro_profiles_dir()
    pro_count = len([d for d in pro_dir.iterdir() if d.is_dir() and profile_login_state(d)["logged_in"]]) if pro_dir else 0
    return {
        "success": True,
        "proImportCount": pro_count,
        "profiles": [public_profile_view(p) for p in profiles],
    }


@app.post("/api/profiles")
async def api_add_profile():
    profiles = load_profiles(refresh_disk=False)
    next_num = len(profiles) + 1
    pid = f"acc{next_num}"
    while (PROFILES_DIR / pid).exists() and any(p["id"] == pid for p in profiles):
        next_num += 1
        pid = f"acc{next_num}"
    (PROFILES_DIR / pid).mkdir(parents=True, exist_ok=True)
    new_prof = {
        "id": pid,
        "name": f"Account {next_num} ({pid})",
        "email": "",
        "enabled": True,
        "logged_in": False,
        "status": "Not signed in — Click Login",
    }
    profiles.append(new_prof)
    save_profiles(profiles)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True, "profile": public_profile_view(new_prof)}


class LoginReq(BaseModel):
    engine: str = "gemini-canvas"


@app.post("/api/profiles/{pid}/login")
async def api_login_profile(pid: str, req: LoginReq):
    profiles = load_profiles(refresh_disk=False)
    target = next((p for p in profiles if p["id"] == pid), None)
    if not target:
        raise HTTPException(404, "Profile not found")

    if pid in state.worker_contexts:
        try:
            await state.worker_contexts[pid].close()
        except Exception:
            pass
        state.worker_contexts.pop(pid, None)

    p_path = PROFILES_DIR / pid
    await asyncio.to_thread(kill_stale_chrome, p_path)
    ok, msg = await asyncio.to_thread(open_real_chrome_for_login, pid, req.engine)
    if not ok:
        raise HTTPException(500, msg)

    asyncio.create_task(_watch_real_chrome_login(pid))
    return {"success": True, "message": msg}


@app.post("/api/profiles/open-all")
async def api_open_all_unlogged(req: LoginReq):
    profiles = load_profiles(refresh_disk=True)
    opened = 0
    for p in profiles:
        if not p.get("logged_in"):
            pid = p["id"]
            if pid in state.worker_contexts:
                try:
                    await state.worker_contexts[pid].close()
                except Exception:
                    pass
                state.worker_contexts.pop(pid, None)
            await asyncio.to_thread(kill_stale_chrome, PROFILES_DIR / pid)
            ok, _ = await asyncio.to_thread(open_real_chrome_for_login, pid, req.engine)
            if ok:
                opened += 1
                asyncio.create_task(_watch_real_chrome_login(pid))
                await asyncio.sleep(0.8)
    return {"success": True, "opened": opened, "message": f"Opened {opened} Chrome window(s) for login"}


@app.post("/api/profiles/import-pro")
async def api_import_pro_profiles():
    pro_dir = _find_pro_profiles_dir()
    if not pro_dir:
        return JSONResponse(status_code=404, content={"success": False, "error": "RenderX Studio Pro browser_profiles folder not found"})

    ignore_dirs = shutil.ignore_patterns("Cache", "Code Cache", "GPUCache", "ShaderCache", "GrShaderCache", "Service Worker", "Crashpad", "lockfile", "Singleton*")
    imported = []

    def do_copy():
        profiles = load_profiles(refresh_disk=False)
        existing_ids = {p["id"] for p in profiles}
        for src_sub in sorted(pro_dir.iterdir()):
            if not src_sub.is_dir():
                continue
            lstate = profile_login_state(src_sub)
            if not lstate["logged_in"]:
                continue
            pid = src_sub.name
            dst_sub = PROFILES_DIR / pid
            kill_stale_chrome(dst_sub)
            if dst_sub.exists():
                shutil.rmtree(dst_sub, ignore_errors=True)
            shutil.copytree(src_sub, dst_sub, ignore=ignore_dirs, dirs_exist_ok=True)
            new_lstate = profile_login_state(dst_sub)
            if pid in existing_ids:
                for p in profiles:
                    if p["id"] == pid:
                        p["logged_in"] = new_lstate["logged_in"]
                        p["email"] = new_lstate["email"]
                        p["status"] = new_lstate["status"]
                        p["enabled"] = True
            else:
                profiles.append({
                    "id": pid,
                    "name": f"Pro {pid}",
                    "email": new_lstate["email"],
                    "enabled": True,
                    "logged_in": new_lstate["logged_in"],
                    "status": new_lstate["status"],
                })
            imported.append(pid)
        save_profiles(profiles)

    for p in load_profiles(refresh_disk=False):
        pid = p["id"]
        if pid in state.worker_contexts:
            try:
                await state.worker_contexts[pid].close()
            except Exception:
                pass
            state.worker_contexts.pop(pid, None)

    await asyncio.to_thread(do_copy)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True, "imported": imported, "message": f"Imported {len(imported)} signed-in profile(s) from RenderX Studio Pro"}


@app.post("/api/profiles/{pid}/close-login")
async def api_close_login(pid: str):
    state.login_open_pids.discard(pid)
    if pid in state.worker_contexts:
        try:
            await state.worker_contexts[pid].close()
        except Exception:
            pass
        state.worker_contexts.pop(pid, None)
    await asyncio.to_thread(kill_stale_chrome, PROFILES_DIR / pid)
    load_profiles(refresh_disk=True)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True}


@app.post("/api/profiles/{pid}/focus")
async def api_focus_profile_worker(pid: str):
    ctx = state.worker_contexts.get(pid)
    if ctx and ctx.pages:
        try:
            await ctx.pages[0].bring_to_front()
            return {"success": True}
        except Exception:
            pass
    return {"success": False, "message": "No active background worker for this profile"}


@app.post("/api/profiles/{pid}/open-folder")
async def api_open_profile_folder(pid: str):
    p_path = PROFILES_DIR / pid
    p_path.mkdir(parents=True, exist_ok=True)
    try:
        os.startfile(str(p_path))
    except Exception:
        subprocess.Popen(["explorer", str(p_path)])
    return {"success": True, "path": str(p_path)}


class ToggleReq(BaseModel):
    enabled: bool


@app.post("/api/profiles/{pid}/toggle")
async def api_toggle_profile(pid: str, req: ToggleReq):
    profiles = load_profiles(refresh_disk=False)
    for p in profiles:
        if p["id"] == pid:
            p["enabled"] = req.enabled
    save_profiles(profiles)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True}


class RenameReq(BaseModel):
    name: str


@app.post("/api/profiles/{pid}/rename")
async def api_rename_profile(pid: str, req: RenameReq):
    profiles = load_profiles(refresh_disk=False)
    for p in profiles:
        if p["id"] == pid:
            p["name"] = req.name.strip() or p["name"]
    save_profiles(profiles)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True}


@app.delete("/api/profiles/{pid}")
async def api_reset_profile(pid: str):
    state.login_open_pids.discard(pid)
    if pid in state.worker_contexts:
        try:
            await state.worker_contexts[pid].close()
        except Exception:
            pass
        state.worker_contexts.pop(pid, None)
    pdir = PROFILES_DIR / pid
    await asyncio.to_thread(kill_stale_chrome, pdir)
    if pdir.exists():
        shutil.rmtree(pdir, ignore_errors=True)
    pdir.mkdir(parents=True, exist_ok=True)
    profiles = load_profiles(refresh_disk=False)
    for p in profiles:
        if p["id"] == pid:
            p["logged_in"] = False
            p["email"] = ""
            p["status"] = "Not signed in — Click Login"
    save_profiles(profiles)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True}


class BatchStartReq(BaseModel):
    items: List[Dict[str, Any]]
    engine: str = "gemini-canvas"
    subMode: str = "image"
    charDesc: Optional[str] = None
    styleDesc: Optional[str] = None
    charImageBase64: Optional[str] = None
    styleImageBase64: Optional[str] = None


class EngineCheckReq(BaseModel):
    engine: str = "gemini-canvas"


@app.post("/api/engine/check")
async def api_engine_check(req: EngineCheckReq):
    import socket
    profiles = load_profiles(refresh_disk=True)
    logged_in_profs = [p for p in profiles if p.get("logged_in")]
    enabled_logged = [p for p in logged_in_profs if p.get("enabled")]

    host = "labs.google" if req.engine == "google-flow" else "gemini.google.com"
    engine_label = "Google Flow" if req.engine == "google-flow" else "Gemini Canvas"

    def check_net() -> bool:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(3.0)
            s.connect((host, 443))
            s.close()
            return True
        except Exception:
            return False

    net_ok = await asyncio.to_thread(check_net)
    connected = bool(net_ok and len(logged_in_profs) > 0)

    if not net_ok:
        msg = f"{engine_label}: Cannot reach {host} (Check internet connection)"
    elif len(logged_in_profs) == 0:
        msg = f"{engine_label}: No signed-in Chrome profile found — click Manage Profiles & Login"
    elif len(enabled_logged) == 0:
        msg = f"{engine_label}: {len(logged_in_profs)} logged-in profile(s) available (enable P1..P8 pill)"
        connected = True
    else:
        msg = f"{engine_label} Connected ({len(enabled_logged)} active Chrome profile ready)"

    return {
        "success": True,
        "connected": connected,
        "engine": req.engine,
        "networkOk": net_ok,
        "loggedInCount": len(logged_in_profs),
        "enabledLoggedCount": len(enabled_logged),
        "message": msg,
    }


@app.post("/api/batch/start")
async def api_batch_start(req: BatchStartReq):
    if state.is_running:
        return JSONResponse(status_code=409, content={"success": False, "error": "Batch already running"})

    profiles = load_profiles(refresh_disk=True)
    active_profiles = [p for p in profiles if p.get("enabled") and p.get("logged_in")]
    if not active_profiles:
        active_profiles = [p for p in profiles if p.get("logged_in")]
    if not active_profiles:
        active_profiles = [p for p in profiles if p.get("enabled")] or [profiles[0]]

    # Single prompt uses only the primary selected profile; batch dispatches across 2..N active profiles concurrently
    if len(req.items) <= 1:
        active_profiles = [active_profiles[0]]

    state.is_running = True
    state.should_stop = False
    state.current_items = req.items
    state.current_engine = req.engine
    state.current_sub_mode = req.subMode

    batch_stamp = time.strftime("batch_%Y%m%d_%H%M%S")
    batch_dir = OUTPUTS_DIR / batch_stamp
    batch_dir.mkdir(parents=True, exist_ok=True)
    state.last_batch_dir = batch_dir

    item_map = {it["index"]: it for it in state.current_items}
    buckets: Dict[str, List[Dict[str, Any]]] = {p["id"]: [] for p in active_profiles}
    for i, item in enumerate(state.current_items):
        chosen = active_profiles[i % len(active_profiles)]
        buckets[chosen["id"]].append(item)

    options = {
        "charDesc": req.charDesc,
        "styleDesc": req.styleDesc,
        "charImageBase64": req.charImageBase64,
        "styleImageBase64": req.styleImageBase64,
    }

    async def orchestrate():
        await broadcast_ws({
            "type": "DIAGNOSTIC_LOG",
            "text": f"Cluster dispatching {len(state.current_items)} shots across {len(active_profiles)} Chrome profile(s) ({req.engine})..."
        })
        tasks = []
        for p in active_profiles:
            chunk = buckets[p["id"]]
            if not chunk:
                continue
            if req.engine == "google-flow":
                tasks.append(run_flow_profile_worker(p, chunk, item_map, req.subMode, batch_dir))
            else:
                tasks.append(run_canvas_profile_worker(p, chunk, item_map, batch_dir, options))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        state.is_running = False
        completed = sum(1 for x in state.current_items if x.get("status") == "done")
        await broadcast_ws({
            "type": "QUEUE_FINISHED",
            "completedCount": completed,
            "total": len(state.current_items),
            "outputDir": str(batch_dir),
            "stopped": state.should_stop,
        })

    asyncio.create_task(orchestrate())
    return {"success": True, "profilesUsed": len(active_profiles), "outputDir": str(batch_dir)}


@app.post("/api/batch/stop")
async def api_batch_stop():
    state.should_stop = True
    state.is_running = False
    return {"success": True}


@app.post("/api/open-output-folder")
async def api_open_output_folder():
    folder = str(state.last_batch_dir if state.last_batch_dir.exists() else OUTPUTS_DIR)
    try:
        os.startfile(folder)
    except Exception:
        subprocess.Popen(["explorer", folder])
    return {"success": True, "path": folder}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    state.ws_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in state.ws_clients:
            state.ws_clients.remove(websocket)


# Serve static frontend assets cleanly
app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8899, log_level="warning")
