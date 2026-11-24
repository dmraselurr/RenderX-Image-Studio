/**
 * RenderX Image Studio - Gemini Canvas MAIN World Bridge
 * Runs in world: "MAIN" across ALL frames (gemini.google.com/*, *.googleusercontent.com/*, *.scf.usercontent.goog/*).
 * 1. Hooks BOTH window.fetch and XMLHttpRequest.prototype.send to capture raw q4uTj URL, headers, body, and prompt.
 * 2. Executes 10-channel concurrent Promise.all fetch() directly inside MAIN world (authentic Origin/Referer/cookies).
 * 3. Clones the exact intercepted payload template without hand-crafted JSON.
 */

(function () {
  if (window.__renderxCanvasBridgeLoaded) return;
  window.__renderxCanvasBridgeLoaded = true;

  const ORIGIN_TAG = 'RENDERX_CANVAS_BRIDGE';
  const CONCURRENCY = 10;
  const FORBIDDEN_HEADERS = new Set([
    'content-length', 'host', 'origin', 'referer', 'cookie', 'user-agent',
    'accept-encoding', 'connection', 'priority'
  ]);

  let lastCapturedUrl = '';
  let lastCapturedHeaders = {};
  let lastCapturedBody = '';
  let lastCapturedPrompt = '';
  let reqSeqCounter = Math.floor(100000 + Math.random() * 800000);

  function headersToPlainObject(rawHeaders) {
    const out = {};
    if (!rawHeaders) return out;
    try {
      if (typeof rawHeaders.forEach === 'function') {
        rawHeaders.forEach((v, k) => { out[k] = v; });
      } else if (Array.isArray(rawHeaders)) {
        rawHeaders.forEach(([k, v]) => { out[String(k)] = v; });
      } else if (typeof rawHeaders === 'object') {
        Object.keys(rawHeaders).forEach(k => { out[k] = rawHeaders[k]; });
      }
    } catch (e) {}
    return out;
  }

  function sanitizeHeadersForReplay(hdrs) {
    const safe = { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'X-Same-Domain': '1' };
    if (hdrs && typeof hdrs === 'object') {
      for (const [k, v] of Object.entries(hdrs)) {
        const lower = k.toLowerCase();
        if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith('sec-')) continue;
        if (v) safe[k] = v;
      }
    }
    return safe;
  }

  function recordCapturedQ4uTj(urlStr, hdrs, bodyStr) {
    if (!urlStr || !urlStr.includes('batchexecute') || !urlStr.includes('q4uTj')) return;
    if (!bodyStr || !bodyStr.includes('f.req=')) return;

    lastCapturedUrl = urlStr;
    lastCapturedHeaders = headersToPlainObject(hdrs);
    lastCapturedBody = bodyStr;

    window.postMessage({
      source: ORIGIN_TAG,
      type: 'CAPTURED_Q4UTJ_RAW',
      url: lastCapturedUrl,
      headers: lastCapturedHeaders,
      body: lastCapturedBody,
      promptHint: lastCapturedPrompt
    }, '*');
  }

  // Capture prompt text from Canvas Bulk Image Generator iframe before generate runs
  if (location.hostname.endsWith('.scf.usercontent.goog') || location.hostname.endsWith('.googleusercontent.com')) {
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('#generate-btn, button');
      if (!btn) return;
      const promptsEl = document.getElementById('prompts');
      if (promptsEl && promptsEl.value) {
        const lines = promptsEl.value.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          lastCapturedPrompt = lines[0];
          window.postMessage({
            source: ORIGIN_TAG,
            type: 'CANVAS_PROMPT_HINT',
            prompt: lastCapturedPrompt,
            aspectRatio: (document.getElementById('aspectRatio') || {}).value || 'square'
          }, '*');
        }
      }
    }, true);
  }

  // Hook window.fetch in MAIN world
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function (...args) {
      try {
        const input = args[0];
        const init = args[1] || {};
        const urlStr = (typeof input === 'string') ? input : (input && input.url) || '';

        if (urlStr.includes('batchexecute') && urlStr.includes('q4uTj')) {
          let bodyStr = '';
          if (typeof init.body === 'string') bodyStr = init.body;
          else if (init.body instanceof URLSearchParams) bodyStr = init.body.toString();
          recordCapturedQ4uTj(urlStr, init.headers || (input && input.headers), bodyStr);
        }
      } catch (e) {}
      return origFetch.apply(this, args);
    };
  }

  // Hook XMLHttpRequest.prototype (open, setRequestHeader, send) in MAIN world
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rxUrl = url ? String(url) : '';
    this.__rxHeaders = {};
    return origXhrOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__rxHeaders) this.__rxHeaders[name] = value;
    return origXhrSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      const urlStr = this.__rxUrl || '';
      if (urlStr.includes('batchexecute') && urlStr.includes('q4uTj')) {
        let bodyStr = '';
        if (typeof body === 'string') bodyStr = body;
        else if (body instanceof URLSearchParams) bodyStr = body.toString();
        recordCapturedQ4uTj(urlStr, this.__rxHeaders, bodyStr);
      }
    } catch (e) {}
    return origXhrSend.apply(this, arguments);
  };

  function looksLikeJson(str) {
    if (typeof str !== 'string') return false;
    const t = str.trim();
    return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
  }

  /**
   * Clone captured body cleanly and replace prompt + aspectRatio with proper JSON escaping
   */
  function cloneAndPatchBody(rawBody, capturedPrompt, newPrompt, targetRatio) {
    const params = new URLSearchParams(rawBody);
    const fReqRaw = params.get('f.req');
    if (!fReqRaw) throw new Error('Captured q4uTj body missing f.req');

    const outer = JSON.parse(fReqRaw);
    const innerStr = outer[0][1];
    const ratioWord = (targetRatio === '16:9') ? 'landscape' : (targetRatio === '9:16' ? 'portrait' : 'square');

    let replaced = false;

    function transformNode(node, parentKey = '') {
      if (typeof node === 'string') {
        if (looksLikeJson(node)) {
          try {
            return JSON.stringify(transformNode(JSON.parse(node), parentKey));
          } catch (e) {}
        }

        if (capturedPrompt && node === capturedPrompt) {
          replaced = true;
          return newPrompt;
        }
        if (capturedPrompt && node.includes(capturedPrompt)) {
          replaced = true;
          return node.split(capturedPrompt).join(newPrompt);
        }

        if (node === '1:1' || node === '16:9' || node === '9:16') return targetRatio;
        if (node === 'square' || node === 'landscape' || node === 'portrait') return ratioWord;

        const keyLower = String(parentKey).toLowerCase();
        if ((keyLower === 'prompt' || keyLower === 'text') && node.length > 2 && !node.startsWith('http')) {
          replaced = true;
          return newPrompt;
        }
        return node;
      }

      if (Array.isArray(node)) {
        return node.map(child => transformNode(child, parentKey));
      }

      if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
          if ((k === 'aspectRatio' || k === 'aspect_ratio') && typeof v === 'string') {
            out[k] = targetRatio;
          } else {
            out[k] = transformNode(v, k);
          }
        }
        return out;
      }
      return node;
    }

    let parsedInner = looksLikeJson(innerStr) ? JSON.parse(innerStr) : innerStr;
    parsedInner = transformNode(parsedInner, '');

    if (!replaced) {
      let bestPath = null;
      let bestLen = 0;
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
        } else if (Array.isArray(node)) {
          node.forEach((child, idx) => scanLongest(child, path.concat([idx])));
        } else if (node && typeof node === 'object') {
          Object.entries(node).forEach(([k, v]) => scanLongest(v, path.concat([k])));
        }
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

    // Refresh 'at' CSRF token from page WIZ_global_data if available
    const wiz = window.WIZ_global_data || {};
    if (wiz.SNlM0e) {
      params.set('at', wiz.SNlM0e);
    }

    return params.toString();
  }

  function buildClonedUrl(templateUrl) {
    const urlObj = new URL(templateUrl, location.origin);
    reqSeqCounter += 100000;
    urlObj.searchParams.set('_reqid', String(reqSeqCounter));

    const wiz = window.WIZ_global_data || {};
    if (wiz.cfb2h) urlObj.searchParams.set('bl', wiz.cfb2h);
    if (wiz.FdrFJe) urlObj.searchParams.set('f.sid', wiz.FdrFJe);
    return urlObj.toString();
  }

  function extractImageFromBatchText(rawText) {
    if (!rawText) throw new Error('Empty response body');

    const cleaned = rawText.replace(/^\)\]\}'\s*/, '');
    const lines = cleaned.split('\n');
    let foundPayload = null;
    let foundRpcError = null;

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('[')) continue;
      try {
        const arr = JSON.parse(t);
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
          if (Array.isArray(entry) && entry[0] === 'wrb.fr' && entry[1] === 'q4uTj') {
            if (entry[2]) foundPayload = entry[2];
            else if (entry[5]) foundRpcError = JSON.stringify(entry[5]);
          }
        }
      } catch (e) {}
    }

    if (!foundPayload) {
      const snippet = cleaned.replace(/\s+/g, ' ').slice(0, 140);
      throw new Error(foundRpcError ? `RPC Error ${foundRpcError}` : `Missing q4uTj payload (${snippet})`);
    }

    let candidateImage = null;
    let candidateMime = 'image/png';
    let apiErrorMsg = null;

    function inspectNode(node) {
      if (candidateImage) return;
      if (typeof node === 'string') {
        if (looksLikeJson(node)) {
          try { inspectNode(JSON.parse(node)); return; } catch (e) {}
        }
        if (node.startsWith('data:image/')) { candidateImage = node; return; }
        if (node.length > 1000) {
          if (node.startsWith('iVBORw0KGgo')) { candidateImage = `data:image/png;base64,${node}`; return; }
          if (node.startsWith('/9j/')) { candidateImage = `data:image/jpeg;base64,${node}`; return; }
          if (node.startsWith('UklGR')) { candidateImage = `data:image/webp;base64,${node}`; return; }
        }
        if (node.startsWith('https://') && node.includes('googleusercontent.com') && !node.includes('avatar') && !node.includes('profile')) {
          candidateImage = node;
          return;
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) { inspectNode(item); if (candidateImage) return; }
        return;
      }
      if (node && typeof node === 'object') {
        if (node.error && node.error.message) apiErrorMsg = node.error.message;
        if (node.bytesBase64Encoded && typeof node.bytesBase64Encoded === 'string') {
          candidateImage = `data:${node.mimeType || candidateMime};base64,${node.bytesBase64Encoded}`;
          return;
        }
        if (node.inlineData && node.inlineData.data) {
          candidateImage = `data:${node.inlineData.mimeType || candidateMime};base64,${node.inlineData.data}`;
          return;
        }
        if (node.encodedImage && typeof node.encodedImage === 'string') {
          candidateImage = node.encodedImage.startsWith('data:') ? node.encodedImage : `data:image/png;base64,${node.encodedImage}`;
          return;
        }
        if (node.mimeType && typeof node.mimeType === 'string' && node.mimeType.startsWith('image/')) {
          candidateMime = node.mimeType;
        }
        for (const v of Object.values(node)) { inspectNode(v); if (candidateImage) return; }
      }
    }

    inspectNode(foundPayload);
    if (!candidateImage) {
      throw new Error(apiErrorMsg || `Parse failed: ${String(foundPayload).slice(0, 120)}`);
    }
    return candidateImage;
  }

  /**
   * 10-Channel Concurrent fetch() Pool executed directly inside gemini.google.com MAIN world
   */
  async function executeMainWorldBatch(items, template, batchId) {
    const rawUrl = lastCapturedUrl || (template && template.url);
    const rawBody = lastCapturedBody || (template && template.body);
    const rawHeaders = Object.keys(lastCapturedHeaders).length ? lastCapturedHeaders : (template && template.headers) || {};
    const promptHint = lastCapturedPrompt || (template && template.promptHint) || '';

    if (!rawUrl || !rawBody) {
      items.forEach(item => {
        window.postMessage({
          source: ORIGIN_TAG,
          type: 'MAIN_BATCH_SHOT_RESULT',
          batchId,
          index: item.index,
          ok: false,
          httpStatus: 0,
          error: 'No captured q4uTj template in MAIN world yet.'
        }, '*');
      });
      window.postMessage({ source: ORIGIN_TAG, type: 'MAIN_BATCH_DONE', batchId }, '*');
      return;
    }

    const safeHeaders = sanitizeHeadersForReplay(rawHeaders);
    let nextIdx = 0;
    const poolSize = Math.min(CONCURRENCY, items.length);

    async function worker() {
      while (true) {
        const idx = nextIdx++;
        if (idx >= items.length) break;
        const item = items[idx];

        let lastStatus = 0;
        let lastErr = '';
        let succeeded = false;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const clonedUrl = buildClonedUrl(rawUrl);
            const clonedBody = cloneAndPatchBody(rawBody, promptHint, item.prompt, item.aspectRatio || '1:1');

            const resp = await origFetch.call(window, clonedUrl, {
              method: 'POST',
              credentials: 'include',
              headers: safeHeaders,
              body: clonedBody
            });

            lastStatus = resp.status;
            const respText = await resp.text();

            if (!resp.ok) {
              const snippet = respText.replace(/\s+/g, ' ').slice(0, 160);
              lastErr = `HTTP ${resp.status}: ${snippet || resp.statusText}`;
              if (resp.status === 429 || resp.status >= 500) {
                await new Promise(r => setTimeout(r, 800 * attempt));
                continue;
              }
              break;
            }

            const imageResult = extractImageFromBatchText(respText);
            window.postMessage({
              source: ORIGIN_TAG,
              type: 'MAIN_BATCH_SHOT_RESULT',
              batchId,
              index: item.index,
              ok: true,
              httpStatus: resp.status,
              dataUrl: imageResult.startsWith('data:') ? imageResult : null,
              imageUrl: imageResult.startsWith('http') ? imageResult : null
            }, '*');
            succeeded = true;
            break;
          } catch (err) {
            lastErr = `HTTP ${lastStatus || 'ERR'}: ${err.message}`;
            if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
          }
        }

        if (!succeeded) {
          window.postMessage({
            source: ORIGIN_TAG,
            type: 'MAIN_BATCH_SHOT_RESULT',
            batchId,
            index: item.index,
            ok: false,
            httpStatus: lastStatus,
            error: lastErr || 'Unknown MAIN-world fetch failure'
          }, '*');
        }
      }
    }

    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    window.postMessage({ source: ORIGIN_TAG, type: 'MAIN_BATCH_DONE', batchId }, '*');
  }

  async function blobUrlToDataUrl(blobUrl) {
    const resp = await origFetch.call(window, blobUrl);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Blob read failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function runCanvasIframeTurn(promptText, aspectRatio = '1:1') {
    const promptsEl = document.getElementById('prompts');
    const genBtn = document.getElementById('generate-btn');
    const aspectEl = document.getElementById('aspectRatio');
    const gridEl = document.getElementById('image-grid');

    if (!promptsEl || !genBtn) {
      throw new Error('Bulk Image Generator controls not loaded yet in Canvas iframe');
    }

    const existingSrcs = new Set();
    document.querySelectorAll('#image-grid img, img[src^="blob:"]').forEach(img => {
      if (img.src) existingSrcs.add(img.src);
    });

    if (aspectEl) {
      const mapped = (aspectRatio === '16:9') ? 'landscape' : (aspectRatio === '9:16' ? 'portrait' : 'square');
      aspectEl.value = mapped;
      aspectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    lastCapturedPrompt = promptText;
    window.postMessage({
      source: ORIGIN_TAG,
      type: 'CANVAS_PROMPT_HINT',
      prompt: promptText,
      aspectRatio: aspectEl ? aspectEl.value : 'square'
    }, '*');

    promptsEl.value = promptText;
    promptsEl.dispatchEvent(new Event('input', { bubbles: true }));
    promptsEl.dispatchEvent(new Event('change', { bubbles: true }));
    if (genBtn.disabled) genBtn.disabled = false;
    genBtn.click();

    return await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(poller);
        reject(new Error('Canvas iframe generation timed out (30s)'));
      }, 30000);

      async function checkGrid() {
        if (settled) return;
        const imgs = Array.from(document.querySelectorAll('#image-grid img, img[src^="blob:"]'));
        for (const img of imgs) {
          if (!img.src || existingSrcs.has(img.src)) continue;
          if (img.complete && (img.naturalWidth > 128 || img.src.startsWith('blob:'))) {
            settled = true;
            clearTimeout(timer);
            observer.disconnect();
            clearInterval(poller);
            try {
              const dataUrl = img.src.startsWith('blob:') ? await blobUrlToDataUrl(img.src) : img.src;
              resolve({ ok: true, dataUrl });
            } catch (err) {
              reject(err);
            }
            return;
          }
        }
      }

      const observer = new MutationObserver(checkGrid);
      observer.observe(gridEl || document.body, { childList: true, subtree: true, attributes: true });
      const poller = setInterval(checkGrid, 400);
    });
  }

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.source !== 'RENDERX_CANVAS_CS') return;

    if (data.type === 'EXECUTE_Q4UTJ_MAIN_BATCH' && window.top === window) {
      executeMainWorldBatch(data.items || [], data.template || null, data.batchId);
    }

    if (data.type === 'RUN_CANVAS_IFRAME_TURN' && (location.hostname.endsWith('.scf.usercontent.goog') || location.hostname.endsWith('.googleusercontent.com'))) {
      try {
        const res = await runCanvasIframeTurn(data.prompt, data.aspectRatio || '1:1');
        window.postMessage({ source: ORIGIN_TAG, type: 'IFRAME_TURN_RESULT', requestId: data.requestId, ok: true, dataUrl: res.dataUrl }, '*');
      } catch (err) {
        window.postMessage({ source: ORIGIN_TAG, type: 'IFRAME_TURN_RESULT', requestId: data.requestId, ok: false, error: err.message }, '*');
      }
    }
  });
})();
