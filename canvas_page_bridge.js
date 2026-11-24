/**
 * RenderX Image Studio - Gemini Canvas MAIN World Bridge
 * Runs passively in MAIN world on gemini.google.com/* and *.scf.usercontent.goog/*
 * Captures batchexecute?rpcids=q4uTj payload/URL + page WIZ tokens with ZERO extra tabs.
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

  // Allow content_canvas.js to trigger a 1-time silent probe inside existing Canvas iframe (if open and unsynced)
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

    if (data.type === 'PROBE_CANVAS_IFRAME' && location.hostname.endsWith('.scf.usercontent.goog')) {
      try {
        const promptsEl = document.getElementById('prompts');
        const genBtn = document.getElementById('generate-btn');
        if (!promptsEl || !genBtn) {
          window.postMessage({ source: ORIGIN_TAG, type: 'PROBE_RESULT', requestId: data.requestId, ok: false, error: 'Canvas controls not present in iframe' }, '*');
          return;
        }
        const prevVal = promptsEl.value;
        const probeText = data.probePrompt || 'a clean minimal geometric cube';
        lastSubmittedPrompt = probeText;
        promptsEl.value = probeText;
        promptsEl.dispatchEvent(new Event('input', { bubbles: true }));
        window.postMessage({ source: ORIGIN_TAG, type: 'CANVAS_PROMPT_HINT', prompt: probeText, aspectRatio: 'square' }, '*');
        genBtn.click();
        setTimeout(() => {
          promptsEl.value = prevVal;
          promptsEl.dispatchEvent(new Event('input', { bubbles: true }));
        }, 300);
        window.postMessage({ source: ORIGIN_TAG, type: 'PROBE_RESULT', requestId: data.requestId, ok: true }, '*');
      } catch (err) {
        window.postMessage({ source: ORIGIN_TAG, type: 'PROBE_RESULT', requestId: data.requestId, ok: false, error: err.message }, '*');
      }
    }
  });
})();
