/**
 * RenderX Image Studio - Gemini Canvas MAIN World Bridge
 * Runs passively in MAIN world on gemini.google.com/* and *.scf.usercontent.goog/*
 * 1. Captures q4uTj batchexecute calls for Zero-Tab direct fetch execution.
 * 2. Executes live Canvas iframe turn inside the already-open 30vw left Canvas pane for instant 1-time auto-sync & fallback.
 */

(function () {
  if (window.__renderxCanvasBridgeLoaded) return;
  window.__renderxCanvasBridgeLoaded = true;

  const ORIGIN_TAG = 'RENDERX_CANVAS_BRIDGE';
  let lastSubmittedPrompt = '';

  // Capture prompt text from Canvas Bulk Image Generator iframe before generate runs
  if (location.hostname.endsWith('.scf.usercontent.goog')) {
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('#generate-btn, button');
      if (!btn) return;
      const promptsEl = document.getElementById('prompts');
      if (promptsEl && promptsEl.value) {
        const lines = promptsEl.value.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          lastSubmittedPrompt = lines[0];
          window.postMessage({
            source: ORIGIN_TAG,
            type: 'CANVAS_PROMPT_HINT',
            prompt: lastSubmittedPrompt,
            aspectRatio: (document.getElementById('aspectRatio') || {}).value || 'square'
          }, '*');
        }
      }
    }, true);
  }

  // Passively intercept window.fetch on gemini.google.com to capture q4uTj f.req + session tokens
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function (...args) {
      try {
        const input = args[0];
        const init = args[1] || {};
        const urlStr = (typeof input === 'string') ? input : (input && input.url) || '';

        if (urlStr.includes('batchexecute') && urlStr.includes('q4uTj')) {
          let bodyStr = '';
          if (typeof init.body === 'string') {
            bodyStr = init.body;
          } else if (init.body instanceof URLSearchParams) {
            bodyStr = init.body.toString();
          }

          if (bodyStr && bodyStr.includes('f.req=')) {
            window.postMessage({
              source: ORIGIN_TAG,
              type: 'CAPTURED_Q4UTJ_FETCH',
              url: urlStr,
              body: bodyStr,
              promptHint: lastSubmittedPrompt || ''
            }, '*');
          }
        }
      } catch (e) {}

      return origFetch.apply(this, args);
    };
  }

  async function blobUrlToDataUrl(blobUrl) {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Blob read failed'));
      reader.readAsDataURL(blob);
    });
  }

  // Run 1 prompt inside the Bulk Image Generator iframe (triggers q4uTj capture + returns real image)
  async function runCanvasIframeTurn(promptText, aspectRatio = '1:1') {
    const promptsEl = document.getElementById('prompts');
    const genBtn = document.getElementById('generate-btn');
    const aspectEl = document.getElementById('aspectRatio');
    const gridEl = document.getElementById('image-grid');

    if (!promptsEl || !genBtn) {
      throw new Error('Bulk Image Generator controls not loaded yet in Canvas iframe');
    }

    // Snapshot existing blob srcs so we only pick up the newly generated image
    const existingSrcs = new Set();
    document.querySelectorAll('#image-grid img, img[src^="blob:"]').forEach(img => {
      if (img.src) existingSrcs.add(img.src);
    });

    if (aspectEl) {
      const mapped = (aspectRatio === '16:9') ? 'landscape' : (aspectRatio === '9:16' ? 'portrait' : 'square');
      aspectEl.value = mapped;
      aspectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    lastSubmittedPrompt = promptText;
    window.postMessage({
      source: ORIGIN_TAG,
      type: 'CANVAS_PROMPT_HINT',
      prompt: promptText,
      aspectRatio: aspectEl ? aspectEl.value : 'square'
    }, '*');

    promptsEl.value = promptText;
    promptsEl.dispatchEvent(new Event('input', { bubbles: true }));
    promptsEl.dispatchEvent(new Event('change', { bubbles: true }));

    // Ensure button is enabled before clicking
    if (genBtn.disabled) genBtn.disabled = false;
    genBtn.click();

    // Wait for newly rendered blob image in #image-grid (up to 30s)
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

  // Handle commands from content_canvas.js
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.source !== 'RENDERX_CANVAS_CS') return;

    if (data.type === 'READ_WIZ_TOKENS') {
      const wiz = window.WIZ_global_data || {};
      window.postMessage({
        source: ORIGIN_TAG,
        type: 'WIZ_TOKENS_RESULT',
        requestId: data.requestId,
        bl: wiz.cfb2h || '',
        fsid: wiz.FdrFJe || '',
        at: wiz.SNlM0e || ''
      }, '*');
    }

    if (data.type === 'RUN_CANVAS_IFRAME_TURN' && location.hostname.endsWith('.scf.usercontent.goog')) {
      try {
        const res = await runCanvasIframeTurn(data.prompt, data.aspectRatio || '1:1');
        window.postMessage({
          source: ORIGIN_TAG,
          type: 'IFRAME_TURN_RESULT',
          requestId: data.requestId,
          ok: true,
          dataUrl: res.dataUrl
        }, '*');
      } catch (err) {
        window.postMessage({
          source: ORIGIN_TAG,
          type: 'IFRAME_TURN_RESULT',
          requestId: data.requestId,
          ok: false,
          error: err.message
        }, '*');
      }
    }
  });
})();
