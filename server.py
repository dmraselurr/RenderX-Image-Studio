"""
RenderX Image Studio - Desktop Multi-Profile Cluster Engine (FastAPI + Playwright)
Supports up to 8+ persistent Google/Chrome profiles running Gemini Canvas (q4uTj RPC)
and Google Flow (aisandbox-pa API) concurrently with ZERO visible tabs & disk auto-save.
"""

import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from playwright.async_api import async_playwright, BrowserContext, Page

BASE_DIR = Path(__file__).resolve().parent
PROFILES_DIR = BASE_DIR / "profiles"
OUTPUTS_DIR = BASE_DIR / "outputs"
PROFILES_META_FILE = PROFILES_DIR / "profiles.json"

PROFILES_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
CHROME_EXE = next((p for p in CHROME_CANDIDATES if os.path.exists(p)), None)

GEMINI_SHARE_URL = "https://gemini.google.com/share/f8350ff50be0"
FLOW_URL = "https://flow.google.com"

app = FastAPI(title="RenderX Image Studio Desktop Engine", version="2.0.0")
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
        self.login_contexts: Dict[str, BrowserContext] = {}
        self.worker_contexts: Dict[str, BrowserContext] = {}
        self.profile_locks: Dict[str, asyncio.Lock] = {}
        self.ws_clients: List[WebSocket] = []

        self.is_running = False
        self.should_stop = False
        self.current_items: List[Dict[str, Any]] = []
        self.current_engine = "gemini-canvas"
        self.current_sub_mode = "image"
        self.last_batch_dir: Path = OUTPUTS_DIR
        self.captured_images: set = set()


state = EngineState()


def get_profile_lock(pid: str) -> asyncio.Lock:
    if pid not in state.profile_locks:
        state.profile_locks[pid] = asyncio.Lock()
    return state.profile_locks[pid]


# ================= Profile Storage =================
def default_profiles() -> List[Dict[str, Any]]:
    profiles = []
    for i in range(1, 9):
        pid = f"profile_{i:02d}"
        (PROFILES_DIR / pid).mkdir(parents=True, exist_ok=True)
        profiles.append({
            "id": pid,
            "name": f"Chrome Profile {i:02d}",
            "email": "",
            "enabled": (i == 1),
            "logged_in": False,
            "canvas_ready": False,
            "flow_ready": False,
            "canvas_template": None,
            "flow_template": None,
        })
    return profiles


def load_profiles() -> List[Dict[str, Any]]:
    if not PROFILES_META_FILE.exists():
        profs = default_profiles()
        save_profiles(profs)
        return profs
    try:
        data = json.loads(PROFILES_META_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list) and len(data) > 0:
            for p in data:
                (PROFILES_DIR / p["id"]).mkdir(parents=True, exist_ok=True)
            return data
    except Exception:
        pass
    profs = default_profiles()
    save_profiles(profs)
    return profs


def save_profiles(profiles: List[Dict[str, Any]]):
    PROFILES_META_FILE.write_text(json.dumps(profiles, indent=2), encoding="utf-8")


def public_profile_view(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": p["id"],
        "name": p["name"],
        "email": p.get("email", ""),
        "enabled": bool(p.get("enabled", False)),
        "logged_in": bool(p.get("logged_in", False)),
        "canvas_ready": bool(p.get("canvas_template")),
        "flow_ready": bool(p.get("flow_template")),
        "is_login_open": p["id"] in state.login_contexts,
        "is_worker_active": p["id"] in state.worker_contexts,
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
    text = str(raw)
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


async def launch_chrome_context(pid: str, headless: bool) -> BrowserContext:
    user_dir = str(PROFILES_DIR / pid)
    kwargs: Dict[str, Any] = {
        "user_data_dir": user_dir,
        "headless": headless,
        "ignore_default_args": ["--enable-automation"],
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ],
        "viewport": {"width": 1280, "height": 860},
    }
    if CHROME_EXE:
        kwargs["executable_path"] = CHROME_EXE
    return await state.pw.chromium.launch_persistent_context(**kwargs)


async def detect_google_login(ctx: BrowserContext) -> bool:
    try:
        cookies = await ctx.cookies(["https://gemini.google.com", "https://accounts.google.com", "https://labs.google"])
        names = {c.get("name") for c in cookies}
        return bool({"SID", "__Secure-1PSID", "__Secure-3PSID"} & names)
    except Exception:
        return False


async def get_or_open_worker_context(pid: str) -> BrowserContext:
    # Reuse visible login window if open (prevents Windows Chrome profile directory lock!)
    if pid in state.login_contexts:
        return state.login_contexts[pid]
    if pid in state.worker_contexts:
        try:
            _ = state.worker_contexts[pid].pages
            return state.worker_contexts[pid]
        except Exception:
            state.worker_contexts.pop(pid, None)
    ctx = await launch_chrome_context(pid, headless=True)
    state.worker_contexts[pid] = ctx
    return ctx


# ================= Playwright In-Page Runners =================
CANVAS_EVAL_BATCH_JS = r"""
async ({ items, template }) => {
  const results = [];
  const rawUrl = template.url;
  const rawBody = template.body;
  const promptHint = template.promptHint || '';
  let reqCounter = Math.floor(100000 + Math.random() * 800000);

  function looksLikeJson(s) {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
  }

  function cloneAndPatchBody(rawBodyStr, capturedPrompt, newPrompt, targetRatio) {
    const params = new URLSearchParams(rawBodyStr);
    const fReqRaw = params.get('f.req');
    if (!fReqRaw) throw new Error('Captured q4uTj body missing f.req');
    const outer = JSON.parse(fReqRaw);
    const innerStr = outer[0][1];
    const ratioWord = (targetRatio === '16:9') ? 'landscape' : (targetRatio === '9:16' ? 'portrait' : 'square');
    let replaced = false;

    function transformNode(node, parentKey = '') {
      if (typeof node === 'string') {
        if (looksLikeJson(node)) {
          try { return JSON.stringify(transformNode(JSON.parse(node), parentKey)); } catch (e) {}
        }
        if (capturedPrompt && node === capturedPrompt) { replaced = true; return newPrompt; }
        if (capturedPrompt && node.includes(capturedPrompt)) { replaced = true; return node.split(capturedPrompt).join(newPrompt); }
        if (node === '1:1' || node === '16:9' || node === '9:16') return targetRatio;
        if (node === 'square' || node === 'landscape' || node === 'portrait') return ratioWord;
        const k = String(parentKey).toLowerCase();
        if ((k === 'prompt' || k === 'text') && node.length > 2 && !node.startsWith('http')) {
          replaced = true;
          return newPrompt;
        }
        return node;
      }
      if (Array.isArray(node)) return node.map(c => transformNode(c, parentKey));
      if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
          if ((k === 'aspectRatio' || k === 'aspect_ratio') && typeof v === 'string') out[k] = targetRatio;
          else out[k] = transformNode(v, k);
        }
        return out;
      }
      return node;
    }

    let parsedInner = looksLikeJson(innerStr) ? JSON.parse(innerStr) : innerStr;
    parsedInner = transformNode(parsedInner, '');

    if (!replaced) {
      let bestPath = null, bestLen = 0;
      function scanLongest(node, path) {
        if (typeof node === 'string') {
          if (looksLikeJson(node)) {
            try { scanLongest(JSON.parse(node), path.concat(['__JSON__'])); return; } catch (e) {}
          }
          const isUrl = node.startsWith('http') || node.startsWith('/') || node.startsWith('data:');
          const isId = /^(models\/|gemini-|imagen-|projects\/|[a-f0-9-]{20,})/i.test(node);
          if (!isUrl && !isId && node.includes(' ') && node.length > bestLen) {
            bestLen = node.length;
            bestPath = path;
          }
        } else if (Array.isArray(node)) node.forEach((c, idx) => scanLongest(c, path.concat([idx])));
        else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => scanLongest(v, path.concat([k])));
      }
      scanLongest(parsedInner, []);
      if (bestPath) {
        function setAtPath(node, path, idx = 0) {
          const seg = path[idx];
          if (seg === '__JSON__') return JSON.stringify(setAtPath(JSON.parse(node), path, idx + 1));
          if (idx === path.length - 1) { node[seg] = newPrompt; return node; }
          node[seg] = setAtPath(node[seg], path, idx + 1);
          return node;
        }
        parsedInner = setAtPath(parsedInner, bestPath);
      }
    }

    outer[0][1] = typeof parsedInner === 'string' ? parsedInner : JSON.stringify(parsedInner);
    params.set('f.req', JSON.stringify(outer));
    const wiz = window.WIZ_global_data || {};
    if (wiz.SNlM0e) params.set('at', wiz.SNlM0e);
    return params.toString();
  }

  function buildUrl(tplUrl) {
    const u = new URL(tplUrl, location.origin);
    reqCounter += 100000;
    u.searchParams.set('_reqid', String(reqCounter));
    const wiz = window.WIZ_global_data || {};
    if (wiz.cfb2h) u.searchParams.set('bl', wiz.cfb2h);
    if (wiz.FdrFJe) u.searchParams.set('f.sid', wiz.FdrFJe);
    return u.toString();
  }

  function extractImage(rawText) {
    const cleaned = rawText.replace(/^\)\]\}'\s*/, '');
    let foundPayload = null, rpcErr = null;
    for (const line of cleaned.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('[')) continue;
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) {
          for (const e of arr) {
            if (Array.isArray(e) && e[0] === 'wrb.fr' && e[1] === 'q4uTj') {
              if (e[2]) foundPayload = e[2];
              else if (e[5]) rpcErr = JSON.stringify(e[5]);
            }
          }
        }
      } catch (e) {}
    }
    if (!foundPayload) throw new Error(rpcErr ? `RPC ${rpcErr}` : `No q4uTj payload: ${cleaned.slice(0, 120)}`);

    let img = null, mime = 'image/png', apiErr = null;
    function walk(node) {
      if (img) return;
      if (typeof node === 'string') {
        if (looksLikeJson(node)) { try { walk(JSON.parse(node)); return; } catch (e) {} }
        if (node.startsWith('data:image/')) { img = node; return; }
        if (node.length > 1000) {
          if (node.startsWith('iVBORw0KGgo')) { img = `data:image/png;base64,${node}`; return; }
          if (node.startsWith('/9j/')) { img = `data:image/jpeg;base64,${node}`; return; }
          if (node.startsWith('UklGR')) { img = `data:image/webp;base64,${node}`; return; }
        }
        if (node.startsWith('https://') && node.includes('googleusercontent.com') && !node.includes('avatar')) {
          img = node; return;
        }
        return;
      }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') {
        if (node.error && node.error.message) apiErr = node.error.message;
        if (node.bytesBase64Encoded) { img = `data:${node.mimeType || mime};base64,${node.bytesBase64Encoded}`; return; }
        if (node.inlineData && node.inlineData.data) { img = `data:${node.inlineData.mimeType || mime};base64,${node.inlineData.data}`; return; }
        if (node.encodedImage) { img = node.encodedImage.startsWith('data:') ? node.encodedImage : `data:image/png;base64,${node.encodedImage}`; return; }
        if (node.mimeType && String(node.mimeType).startsWith('image/')) mime = node.mimeType;
        Object.values(node).forEach(walk);
      }
    }
    walk(foundPayload);
    if (!img) throw new Error(apiErr || `No image found: ${String(foundPayload).slice(0, 120)}`);
    return img;
  }

  let idx = 0;
  const concurrency = Math.min(10, items.length);
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      const item = items[i];
      let done = false, status = 0, errMsg = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await fetch(buildUrl(rawUrl), {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
              'X-Same-Domain': '1'
            },
            body: cloneAndPatchBody(rawBody, promptHint, item.prompt, item.aspectRatio || '1:1')
          });
          status = resp.status;
          const txt = await resp.text();
          if (!resp.ok) {
            errMsg = `HTTP ${resp.status}: ${txt.replace(/\s+/g, ' ').slice(0, 150)}`;
            if (resp.status === 429 || resp.status >= 500) { await new Promise(r => setTimeout(r, 800 * attempt)); continue; }
            break;
          }
          const dataUrl = extractImage(txt);
          results.push({ index: item.index, ok: true, httpStatus: status, dataUrl });
          if (window.__rxOnShotDone) window.__rxOnShotDone({ index: item.index, ok: true, httpStatus: status, dataUrl });
          done = true;
          break;
        } catch (e) {
          errMsg = `HTTP ${status || 'ERR'}: ${e.message}`;
          if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
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


FLOW_EVAL_BATCH_JS = r"""
async ({ items, template }) => {
  const results = [];
  const rawUrl = template.url;
  const rawBody = template.body;
  const rawHeaders = template.headers || {};
  const promptHint = template.promptHint || '';
  const siteKey = template.siteKey || '';

  const FORBIDDEN = new Set(['content-length', 'host', 'origin', 'referer', 'cookie', 'user-agent', 'accept-encoding', 'connection', 'priority']);
  const safeHeaders = { 'Content-Type': 'application/json' };
  for (const [k, v] of Object.entries(rawHeaders)) {
    const low = k.toLowerCase();
    if (!FORBIDDEN.has(low) && !low.startsWith('sec-') && v) safeHeaders[k] = v;
  }

  function findSiteKey() {
    if (siteKey) return siteKey;
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
  const concurrency = Math.min(8, items.length);
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      const item = items[i];
      let done = false, status = 0, errMsg = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
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
            errMsg = `HTTP ${resp.status}: ${txt.replace(/\s+/g, ' ').slice(0, 150)}`;
            if (resp.status === 429 || resp.status >= 500) { await new Promise(r => setTimeout(r, 800 * attempt)); continue; }
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
          if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
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


async def handle_shot_result(pid: str, res: Dict[str, Any], item_map: Dict[int, Dict[str, Any]], batch_dir: Path, sub_mode: str):
    idx = res["index"]
    item = item_map.get(idx)
    if not item or item.get("status") == "done":
        return

    if res.get("ok") and res.get("dataUrl"):
        data_url = res["dataUrl"]
        # If fifeUrl / https URL, fetch inside Playwright or Python? Convert if http
        if data_url.startswith("https://"):
            try:
                import aiohttp
                async with aiohttp.ClientSession() as sess:
                    async with sess.get(data_url) as r:
                        if r.status == 200:
                            raw_bytes = await r.read()
                            ct = r.headers.get("content-type", "image/png").split(";")[0]
                            data_url = f"data:{ct};base64,{base64.b64encode(raw_bytes).decode('ascii')}"
            except Exception:
                pass

        item["dataUrl"] = data_url
        item["status"] = "done"
        fn = item.get("filename") or f"{idx:02d}.png"
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
            "text": f"[{pid}] Shot #{idx}: HTTP {res.get('httpStatus', 200)} OK ({completed}/{len(state.current_items)})"
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


async def run_canvas_profile_worker(profile: Dict[str, Any], assigned_items: List[Dict[str, Any]], item_map: Dict[int, Dict[str, Any]], batch_dir: Path):
    pid = profile["id"]
    async with get_profile_lock(pid):
        ctx = await get_or_open_worker_context(pid)
        page: Page = await ctx.new_page()

        captured = profile.get("canvas_template") or None

        def on_request(req):
            nonlocal captured
            if "batchexecute" in req.url and "q4uTj" in req.url and req.method == "POST":
                pd = req.post_data or ""
                if "f.req=" in pd:
                    captured = {
                        "url": req.url,
                        "body": pd,
                        "promptHint": captured.get("promptHint", "") if captured else "",
                    }

        page.on("request", on_request)

        try:
            await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Connecting to Gemini Canvas session..."})
            await page.goto(GEMINI_SHARE_URL, wait_until="domcontentloaded", timeout=35000)

            # Expose streaming callback back to Python
            async def on_shot_done(res):
                await handle_shot_result(pid, res, item_map, batch_dir, "image")

            await page.expose_function("__rxOnShotDone", on_shot_done)

            remaining = list(assigned_items)

            # Step 1: If no captured template for this profile yet, execute Shot #1 via the Canvas iframe to capture q4uTj raw payload!
            if not captured or not captured.get("body"):
                first = remaining.pop(0)
                await broadcast_ws({"type": "ITEM_STARTED", "index": first["index"]})
                await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Syncing q4uTj via Shot #{first['index']}..."})

                iframe_el = page.locator('iframe[title="Preview"]')
                await iframe_el.wait_for(state="attached", timeout=25000)
                frame = page.frame_locator('iframe[title="Preview"]')
                await frame.locator('#prompts').wait_for(state="visible", timeout=20000)

                ar_val = "landscape" if first.get("aspectRatio") == "16:9" else ("portrait" if first.get("aspectRatio") == "9:16" else "square")
                await frame.locator('#aspectRatio').select_option(ar_val)
                clean_p = sanitize_prompt(first["fullPrompt"])
                captured = {"promptHint": clean_p}
                await frame.locator('#prompts').fill(clean_p)
                await frame.locator('#generate-btn').click()

                # Wait for first generated blob image in #image-grid
                img_loc = frame.locator('#image-grid img').first
                await img_loc.wait_for(state="visible", timeout=35000)
                src = await img_loc.get_attribute("src")
                data_url = await frame.locator('#image-grid img').first.evaluate(
                    """async (img) => {
                        const r = await fetch(img.src);
                        const b = await r.blob();
                        return await new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(b); });
                    }"""
                )
                await handle_shot_result(pid, {"index": first["index"], "ok": True, "httpStatus": 200, "dataUrl": data_url}, item_map, batch_dir, "image")

                if captured and captured.get("url") and captured.get("body"):
                    profiles = load_profiles()
                    for p in profiles:
                        if p["id"] == pid:
                            p["canvas_template"] = captured
                            p["canvas_ready"] = True
                    save_profiles(profiles)
                    await broadcast_ws({"type": "PROFILES_UPDATED"})

            # Step 2: Execute all remaining assigned items concurrently via 10-way fetch() inside page MAIN world!
            if remaining and not state.should_stop:
                if not captured or not captured.get("url") or not captured.get("body"):
                    raise RuntimeError("Could not capture q4uTj request template on this profile.")
                for it in remaining:
                    await broadcast_ws({"type": "ITEM_STARTED", "index": it["index"]})

                eval_items = [
                    {"index": it["index"], "prompt": sanitize_prompt(it["fullPrompt"]), "aspectRatio": it.get("aspectRatio", "1:1")}
                    for it in remaining
                ]
                await page.evaluate(CANVAS_EVAL_BATCH_JS, {"items": eval_items, "template": captured})

        except Exception as err:
            for it in assigned_items:
                if it.get("status") not in ("done", "failed"):
                    await handle_shot_result(pid, {"index": it["index"], "ok": False, "httpStatus": 0, "error": str(err)}, item_map, batch_dir, "image")
        finally:
            try:
                await page.close()
            except Exception:
                pass


async def run_flow_profile_worker(profile: Dict[str, Any], assigned_items: List[Dict[str, Any]], item_map: Dict[int, Dict[str, Any]], sub_mode: str, batch_dir: Path):
    pid = profile["id"]
    async with get_profile_lock(pid):
        ctx = await get_or_open_worker_context(pid)
        page: Page = await ctx.new_page()

        captured = profile.get("flow_template") or {}

        def on_request(req):
            nonlocal captured
            if "aisandbox-pa.googleapis.com" in req.url:
                hdrs = dict(req.headers)
                is_gen = any(k in req.url for k in ("batchGenerateImages", "runImageFx", "flowMedia", "batchGenerateVideo"))
                if is_gen and req.post_data:
                    captured = {
                        "url": req.url,
                        "headers": hdrs,
                        "body": req.post_data,
                        "promptHint": captured.get("promptHint", ""),
                    }
                elif hdrs.get("authorization"):
                    captured["headers"] = {**captured.get("headers", {}), **hdrs}

        page.on("request", on_request)

        try:
            await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Connecting to Google Flow session..."})
            await page.goto(FLOW_URL, wait_until="domcontentloaded", timeout=35000)
            await asyncio.sleep(2.5)

            async def on_shot_done(res):
                await handle_shot_result(pid, res, item_map, batch_dir, sub_mode)

            await page.expose_function("__rxOnShotDone", on_shot_done)

            remaining = list(assigned_items)

            # Step 1: If Flow payload not captured yet, run Shot #1 in Flow page UI to capture live Bearer + projectId + payload!
            if not captured.get("url") or not captured.get("body"):
                first = remaining.pop(0)
                await broadcast_ws({"type": "ITEM_STARTED", "index": first["index"]})
                await broadcast_ws({"type": "DIAGNOSTIC_LOG", "text": f"[{pid}] Syncing Flow Bearer & Project via Shot #{first['index']}..."})

                # Auto-click New project if present
                new_btn = page.locator('button:has-text("New project"), [role="button"]:has-text("New project")').first
                if await new_btn.count() > 0 and await new_btn.is_visible():
                    await new_btn.click()
                    await asyncio.sleep(2.5)

                textarea = page.locator('textarea').first
                await textarea.wait_for(state="visible", timeout=20000)
                clean_p = sanitize_prompt(first["fullPrompt"])
                captured["promptHint"] = clean_p
                await textarea.fill(clean_p)
                await asyncio.sleep(0.3)
                await textarea.press("Enter")

                # Wait for generated image/video to appear and request template to be intercepted
                img_loc = page.locator('img[src*="googleusercontent"], img[src^="blob:"], img[src^="data:"]').last
                await img_loc.wait_for(state="visible", timeout=35000)
                src = await img_loc.get_attribute("src")
                await handle_shot_result(pid, {"index": first["index"], "ok": True, "httpStatus": 200, "dataUrl": src}, item_map, batch_dir, sub_mode)

                if captured.get("url") and captured.get("body"):
                    profiles = load_profiles()
                    for p in profiles:
                        if p["id"] == pid:
                            p["flow_template"] = captured
                            p["flow_ready"] = True
                    save_profiles(profiles)
                    await broadcast_ws({"type": "PROFILES_UPDATED"})

            if remaining and not state.should_stop:
                if not captured.get("url") or not captured.get("body"):
                    raise RuntimeError("Google Flow auth/payload not captured. Please login to this Chrome profile first.")
                for it in remaining:
                    await broadcast_ws({"type": "ITEM_STARTED", "index": it["index"]})

                eval_items = [
                    {"index": it["index"], "prompt": sanitize_prompt(it["fullPrompt"]), "aspectRatio": it.get("aspectRatio", "1:1")}
                    for it in remaining
                ]
                await page.evaluate(FLOW_EVAL_BATCH_JS, {"items": eval_items, "template": captured})

        except Exception as err:
            for it in assigned_items:
                if it.get("status") not in ("done", "failed"):
                    await handle_shot_result(pid, {"index": it["index"], "ok": False, "httpStatus": 0, "error": str(err)}, item_map, batch_dir, sub_mode)
        finally:
            try:
                await page.close()
            except Exception:
                pass


# ================= FastAPI Lifecycle & Endpoints =================
@app.on_event("startup")
async def on_startup():
    state.pw = await async_playwright().start()
    load_profiles()


@app.on_event("shutdown")
async def on_shutdown():
    for ctx in list(state.login_contexts.values()) + list(state.worker_contexts.values()):
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
    profiles = load_profiles()
    return {
        "success": True,
        "desktopMode": True,
        "isQueueRunning": state.is_running,
        "chromeFound": bool(CHROME_EXE),
        "outputDir": str(state.last_batch_dir),
        "profiles": [public_profile_view(p) for p in profiles],
    }


@app.get("/api/profiles")
async def api_list_profiles():
    return {"success": True, "profiles": [public_profile_view(p) for p in load_profiles()]}


@app.post("/api/profiles")
async def api_add_profile():
    profiles = load_profiles()
    next_num = len(profiles) + 1
    pid = f"profile_{next_num:02d}"
    (PROFILES_DIR / pid).mkdir(parents=True, exist_ok=True)
    new_prof = {
        "id": pid,
        "name": f"Chrome Profile {next_num:02d}",
        "email": "",
        "enabled": True,
        "logged_in": False,
        "canvas_ready": False,
        "flow_ready": False,
        "canvas_template": None,
        "flow_template": None,
    }
    profiles.append(new_prof)
    save_profiles(profiles)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True, "profile": public_profile_view(new_prof)}


class LoginReq(BaseModel):
    engine: str = "gemini-canvas"


@app.post("/api/profiles/{pid}/login")
async def api_login_profile(pid: str, req: LoginReq):
    profiles = load_profiles()
    target = next((p for p in profiles if p["id"] == pid), None)
    if not target:
        raise HTTPException(404, "Profile not found")

    # Close headless worker on this profile if open before opening visible window
    if pid in state.worker_contexts:
        try:
            await state.worker_contexts[pid].close()
        except Exception:
            pass
        state.worker_contexts.pop(pid, None)

    if pid in state.login_contexts:
        ctx = state.login_contexts[pid]
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.bring_to_front()
        return {"success": True, "message": "Login Chrome window already open"}

    ctx = await launch_chrome_context(pid, headless=False)
    state.login_contexts[pid] = ctx

    def on_close(_):
        state.login_contexts.pop(pid, None)
        asyncio.create_task(broadcast_ws({"type": "PROFILES_UPDATED"}))

    ctx.on("close", on_close)

    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    # Passively capture templates & login cookies while user signs in
    def on_req(r):
        if "batchexecute" in r.url and "q4uTj" in r.url and r.post_data:
            profs = load_profiles()
            for p in profs:
                if p["id"] == pid:
                    p["canvas_template"] = {"url": r.url, "body": r.post_data, "promptHint": ""}
                    p["canvas_ready"] = True
            save_profiles(profs)
        elif "aisandbox-pa.googleapis.com" in r.url:
            is_gen = any(k in r.url for k in ("batchGenerateImages", "runImageFx", "flowMedia"))
            profs = load_profiles()
            for p in profs:
                if p["id"] == pid:
                    tpl = p.get("flow_template") or {}
                    tpl["headers"] = {**tpl.get("headers", {}), **dict(r.headers)}
                    if is_gen and r.post_data:
                        tpl["url"] = r.url
                        tpl["body"] = r.post_data
                        p["flow_ready"] = True
                    p["flow_template"] = tpl
            save_profiles(profs)

    page.on("request", on_req)

    async def monitor_cookies():
        while pid in state.login_contexts:
            await asyncio.sleep(2.5)
            try:
                logged = await detect_google_login(ctx)
                if logged:
                    profs = load_profiles()
                    changed = False
                    for p in profs:
                        if p["id"] == pid and not p.get("logged_in"):
                            p["logged_in"] = True
                            p["enabled"] = True
                            changed = True
                    if changed:
                        save_profiles(profs)
                        await broadcast_ws({"type": "PROFILES_UPDATED"})
            except Exception:
                break

    asyncio.create_task(monitor_cookies())

    target_url = FLOW_URL if req.engine == "google-flow" else GEMINI_SHARE_URL
    await page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True, "message": f"Opened Chrome login window for {pid}"}


@app.post("/api/profiles/{pid}/close-login")
async def api_close_login(pid: str):
    if pid in state.login_contexts:
        ctx = state.login_contexts.pop(pid)
        logged = await detect_google_login(ctx)
        try:
            await ctx.close()
        except Exception:
            pass
        profiles = load_profiles()
        for p in profiles:
            if p["id"] == pid:
                p["logged_in"] = logged
                if logged:
                    p["enabled"] = True
        save_profiles(profiles)
        await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True}


class ToggleReq(BaseModel):
    enabled: bool


@app.post("/api/profiles/{pid}/toggle")
async def api_toggle_profile(pid: str, req: ToggleReq):
    profiles = load_profiles()
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
    profiles = load_profiles()
    for p in profiles:
        if p["id"] == pid:
            p["name"] = req.name.strip() or p["name"]
    save_profiles(profiles)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True}


@app.delete("/api/profiles/{pid}")
async def api_reset_profile(pid: str):
    for store in (state.login_contexts, state.worker_contexts):
        if pid in store:
            try:
                await store[pid].close()
            except Exception:
                pass
            store.pop(pid, None)
    pdir = PROFILES_DIR / pid
    if pdir.exists():
        shutil.rmtree(pdir, ignore_errors=True)
    pdir.mkdir(parents=True, exist_ok=True)
    profiles = load_profiles()
    for p in profiles:
        if p["id"] == pid:
            p["logged_in"] = False
            p["canvas_ready"] = False
            p["flow_ready"] = False
            p["canvas_template"] = None
            p["flow_template"] = None
    save_profiles(profiles)
    await broadcast_ws({"type": "PROFILES_UPDATED"})
    return {"success": True}


class BatchStartReq(BaseModel):
    items: List[Dict[str, Any]]
    engine: str = "gemini-canvas"
    subMode: str = "image"


@app.post("/api/batch/start")
async def api_batch_start(req: BatchStartReq):
    if state.is_running:
        return JSONResponse(status_code=409, content={"success": False, "error": "Batch already running"})

    profiles = load_profiles()
    active_profiles = [p for p in profiles if p.get("enabled")]
    if not active_profiles:
        active_profiles = [profiles[0]]

    state.is_running = True
    state.should_stop = False
    state.current_items = req.items
    state.current_engine = req.engine
    state.current_sub_mode = req.subMode
    state.captured_images.clear()

    batch_stamp = time.strftime("batch_%Y%m%d_%H%M%S")
    batch_dir = OUTPUTS_DIR / batch_stamp
    batch_dir.mkdir(parents=True, exist_ok=True)
    state.last_batch_dir = batch_dir

    item_map = {it["index"]: it for it in state.current_items}

    # Distribute items round-robin across all enabled Chrome profiles!
    buckets: Dict[str, List[Dict[str, Any]]] = {p["id"]: [] for p in active_profiles}
    for i, item in enumerate(state.current_items):
        chosen = active_profiles[i % len(active_profiles)]
        buckets[chosen["id"]].append(item)

    async def orchestrate():
        await broadcast_ws({
            "type": "DIAGNOSTIC_LOG",
            "text": f"Cluster dispatching {len(state.current_items)} shots across {len(active_profiles)} Chrome profile(s)..."
        })
        tasks = []
        for p in active_profiles:
            chunk = buckets[p["id"]]
            if not chunk:
                continue
            if req.engine == "google-flow":
                tasks.append(run_flow_profile_worker(p, chunk, item_map, req.subMode, batch_dir))
            else:
                tasks.append(run_canvas_profile_worker(p, chunk, item_map, batch_dir))
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
        subprocess.Popen(["explorer", folder])
    except Exception:
        pass
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
