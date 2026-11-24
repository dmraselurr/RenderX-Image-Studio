/**
 * RenderX Image Studio - Google Flow MAIN World Bridge
 * Runs in world: "MAIN" on flow.google.com/* and labs.google/*.
 * 1. Hooks BOTH window.fetch and XMLHttpRequest.prototype.send to capture raw aisandbox-pa URL, headers (Authorization, X-Goog-Api-Key), body, and prompt.
 * 2. Executes 10-channel concurrent Promise.all fetch() directly inside Flow's MAIN world (authentic Origin/Referer/cookies + reCAPTCHA).
 */

(function () {
  if (window.__renderxFlowBridgeLoaded) return;
  window.__renderxFlowBridgeLoaded = true;

  const ORIGIN_TAG = 'RENDERX_FLOW_BRIDGE';
  const CONCURRENCY = 10;
  const FORBIDDEN_HEADERS = new Set([
    'content-length', 'host', 'origin', 'referer', 'cookie', 'user-agent',
    'accept-encoding', 'connection', 'priority'
  ]);

  let lastCapturedUrl = '';
  let lastCapturedHeaders = {};
  let lastCapturedBody = '';
  let lastCapturedPrompt = '';
  let lastCapturedSiteKey = '';

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
    const safe = { 'Content-Type': 'application/json' };
    if (hdrs && typeof hdrs === 'object') {
      for (const [k, v] of Object.entries(hdrs)) {
        const lower = k.toLowerCase();
        if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith('sec-')) continue;
        if (v) safe[k] = v;
      }
    }
    return safe;
  }

  function findRecaptchaSiteKey() {
    try {
      const scripts = Array.from(document.querySelectorAll('script[src*="recaptcha"]'));
      for (const s of scripts) {
        const m = (s.src || '').match(/[?&]render=([^&]+)/);
        if (m && m[1] && m[1] !== 'explicit') return m[1];
      }
      if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
        for (const key of Object.keys(window.___grecaptcha_cfg.clients)) {
          const str = JSON.stringify(window.___grecaptcha_cfg.clients[key]);
          const m = str.match(/"sitekey"\s*:\s*"([^"]+)"/);
          if (m) return m[1];
        }
      }
    } catch (e) {}
    return '';
  }

  function extractPromptFromFlowBody(bodyStr) {
    try {
      const obj = JSON.parse(bodyStr);
      if (Array.isArray(obj.requests) && obj.requests[0] && obj.requests[0].prompt) return obj.requests[0].prompt;
      if (obj.prompt) return obj.prompt;
    } catch (e) {}
    return '';
  }

  function recordCapturedFlow(urlStr, hdrs, bodyStr) {
    if (!urlStr || !urlStr.includes('aisandbox-pa.googleapis.com')) return;

    const plainHdrs = headersToPlainObject(hdrs);
    const isMediaGen = urlStr.includes('batchGenerateImages') ||
      urlStr.includes('runImageFx') ||
      urlStr.includes('batchGenerateVideo') ||
      urlStr.includes('flowMedia');

    const siteKey = findRecaptchaSiteKey() || lastCapturedSiteKey;
    if (siteKey) lastCapturedSiteKey = siteKey;

    if (isMediaGen && bodyStr) {
      lastCapturedUrl = urlStr;
      lastCapturedBody = bodyStr;
      lastCapturedPrompt = extractPromptFromFlowBody(bodyStr) || lastCapturedPrompt;
    }

    if (Object.keys(plainHdrs).length > 0) {
      lastCapturedHeaders = { ...lastCapturedHeaders, ...plainHdrs };
    }

    window.postMessage({
      source: ORIGIN_TAG,
      type: 'CAPTURED_FLOW_RAW',
      url: isMediaGen ? urlStr : lastCapturedUrl,
      headers: lastCapturedHeaders,
      body: isMediaGen ? bodyStr : lastCapturedBody,
      promptHint: lastCapturedPrompt,
      siteKey: lastCapturedSiteKey,
      isMediaGen
    }, '*');
  }

  // Hook window.fetch in MAIN world
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function (...args) {
      try {
        const input = args[0];
        const init = args[1] || {};
        const urlStr = (typeof input === 'string') ? input : (input && input.url) || '';
        if (urlStr.includes('aisandbox-pa.googleapis.com')) {
          const bodyStr = (typeof init.body === 'string') ? init.body : '';
          recordCapturedFlow(urlStr, init.headers || (input && input.headers), bodyStr);
        }
      } catch (e) {}
      return origFetch.apply(this, args);
    };
  }

  // Hook XMLHttpRequest.prototype in MAIN world
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rxFlowUrl = url ? String(url) : '';
    this.__rxFlowHeaders = {};
    return origXhrOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__rxFlowHeaders) this.__rxFlowHeaders[name] = value;
    return origXhrSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      const urlStr = this.__rxFlowUrl || '';
      if (urlStr.includes('aisandbox-pa.googleapis.com')) {
        const bodyStr = (typeof body === 'string') ? body : '';
        recordCapturedFlow(urlStr, this.__rxFlowHeaders, bodyStr);
      }
    } catch (e) {}
    return origXhrSend.apply(this, arguments);
  };

  function mapAspectToFlowEnum(aspectRatio) {
    if (aspectRatio === '16:9') return 'IMAGE_ASPECT_RATIO_LANDSCAPE';
    if (aspectRatio === '9:16') return 'IMAGE_ASPECT_RATIO_PORTRAIT';
    return 'IMAGE_ASPECT_RATIO_SQUARE';
  }

  async function getFreshRecaptcha(siteKey) {
    const sk = siteKey || lastCapturedSiteKey || findRecaptchaSiteKey();
    if (sk && window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.execute === 'function') {
      try {
        return await window.grecaptcha.enterprise.execute(sk, { action: 'FLOW_GENERATION' });
      } catch (e) {}
    }
    return '';
  }

  function cloneAndPatchFlowBody(rawBody, capturedPrompt, newPrompt, aspectRatio, freshRecaptcha) {
    const obj = JSON.parse(rawBody);
    const seed = Math.floor(100000 + Math.random() * 9000000);
    const aspectEnum = mapAspectToFlowEnum(aspectRatio || '1:1');

    if (obj.clientContext) {
      obj.clientContext.sessionId = `;${Date.now()}`;
      if (freshRecaptcha) {
        obj.clientContext.recaptchaContext = {
          applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
          token: freshRecaptcha
        };
      }
    }

    if (Array.isArray(obj.requests) && obj.requests.length > 0) {
      const req0 = { ...obj.requests[0] };
      req0.prompt = newPrompt;
      if ('seed' in req0) req0.seed = seed;
      if ('imageAspectRatio' in req0) req0.imageAspectRatio = aspectEnum;
      obj.requests = [req0];
    } else if (typeof obj.prompt === 'string') {
      obj.prompt = newPrompt;
    } else if (capturedPrompt) {
      // Exact recursive JSON replacement if custom structure
      function walk(node) {
        if (typeof node === 'string') {
          return node === capturedPrompt ? newPrompt : (node.includes(capturedPrompt) ? node.split(capturedPrompt).join(newPrompt) : node);
        }
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
          const out = {};
          for (const [k, v] of Object.entries(node)) out[k] = walk(v);
          return out;
        }
        return node;
      }
      return JSON.stringify(walk(obj));
    }

    return JSON.stringify(obj);
  }

  function extractFlowMediaFromResponse(json) {
    let found = null;
    function scan(node) {
      if (found || !node) return;
      if (typeof node === 'object') {
        if (node.encodedImage && typeof node.encodedImage === 'string') {
          found = node.encodedImage.startsWith('data:') ? node.encodedImage : `data:image/png;base64,${node.encodedImage}`;
          return;
        }
        if (node.fifeUrl && typeof node.fifeUrl === 'string') { found = node.fifeUrl; return; }
        if (node.videoUrl && typeof node.videoUrl === 'string') { found = node.videoUrl; return; }
        if (Array.isArray(node)) node.forEach(scan);
        else Object.values(node).forEach(scan);
      }
    }
    scan(json);
    return found;
  }

  /**
   * 10-Channel Concurrent fetch() Pool executed directly inside Flow MAIN world
   */
  async function executeFlowMainBatch(items, template, batchId) {
    const rawUrl = lastCapturedUrl || (template && template.url);
    const rawBody = lastCapturedBody || (template && template.body);
    const rawHeaders = Object.keys(lastCapturedHeaders).length ? lastCapturedHeaders : (template && template.headers) || {};
    const promptHint = lastCapturedPrompt || (template && template.promptHint) || '';
    const siteKey = lastCapturedSiteKey || (template && template.siteKey) || '';

    if (!rawUrl || !rawBody) {
      items.forEach(item => {
        window.postMessage({
          source: ORIGIN_TAG,
          type: 'MAIN_BATCH_SHOT_RESULT',
          batchId,
          index: item.index,
          ok: false,
          httpStatus: 0,
          error: 'No captured Flow aisandbox-pa payload in MAIN world yet.'
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
            const freshRecaptcha = await getFreshRecaptcha(siteKey);
            const clonedBody = cloneAndPatchFlowBody(rawBody, promptHint, item.prompt, item.aspectRatio || '1:1', freshRecaptcha);

            const resp = await origFetch.call(window, rawUrl, {
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

            let json;
            try {
              json = JSON.parse(respText);
            } catch (parseErr) {
              lastErr = `HTTP ${resp.status} (Parse Failed): ${respText.slice(0, 140)}`;
              break;
            }

            const media = extractFlowMediaFromResponse(json);
            if (!media) {
              lastErr = `HTTP ${resp.status} (No media): ${respText.slice(0, 140)}`;
              break;
            }

            window.postMessage({
              source: ORIGIN_TAG,
              type: 'MAIN_BATCH_SHOT_RESULT',
              batchId,
              index: item.index,
              ok: true,
              httpStatus: resp.status,
              dataUrl: media.startsWith('data:') ? media : null,
              imageUrl: media.startsWith('http') ? media : null
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
            error: lastErr || 'Unknown Flow MAIN-world fetch failure'
          }, '*');
        }
      }
    }

    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    window.postMessage({ source: ORIGIN_TAG, type: 'MAIN_BATCH_DONE', batchId }, '*');
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'RENDERX_FLOW_CS') return;

    if (data.type === 'EXECUTE_FLOW_MAIN_BATCH') {
      executeFlowMainBatch(data.items || [], data.template || null, data.batchId);
    }
  });
})();
