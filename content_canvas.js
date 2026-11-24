/**
 * RenderX Image Studio - Gemini Canvas Isolated Content Relay
 * Bridges MAIN world page interceptor/probe with background.js (Zero tab hijacking).
 */

(function () {
  if (window.__renderexCanvasLoaded) return;
  window.__renderexCanvasLoaded = true;

  const pendingRequests = new Map();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'RENDERX_CANVAS_BRIDGE') return;

    if (data.type === 'CANVAS_PROMPT_HINT') {
      chrome.runtime.sendMessage({
        type: 'CANVAS_PROMPT_HINT',
        prompt: data.prompt,
        aspectRatio: data.aspectRatio
      }).catch(() => {});
    }

    if (data.type === 'CAPTURED_Q4UTJ_FETCH') {
      chrome.runtime.sendMessage({
        type: 'CAPTURED_Q4UTJ_FETCH',
        url: data.url,
        body: data.body,
        promptHint: data.promptHint
      }).catch(() => {});
    }

    if ((data.type === 'WIZ_TOKENS_RESULT' || data.type === 'PROBE_RESULT') && data.requestId) {
      const resolver = pendingRequests.get(data.requestId);
      if (resolver) {
        pendingRequests.delete(data.requestId);
        resolver(data);
      }
    }
  });

  function queryMainBridge(payload, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        resolve({ ok: false, error: 'Bridge timeout' });
      }, timeoutMs);

      pendingRequests.set(requestId, (res) => {
        clearTimeout(timer);
        resolve(res);
      });

      window.postMessage({ ...payload, source: 'RENDERX_CANVAS_CS', requestId }, '*');
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return false;

    if (request.type === 'PING') {
      sendResponse({
        status: 'READY',
        mode: 'gemini-canvas-relay',
        isIframe: location.hostname.endsWith('.scf.usercontent.goog'),
        url: window.location.href
      });
      return true;
    }

    if (request.type === 'READ_WIZ_TOKENS' && !location.hostname.endsWith('.scf.usercontent.goog')) {
      queryMainBridge({ type: 'READ_WIZ_TOKENS' }, 2500).then(sendResponse);
      return true;
    }

    if (request.type === 'PROBE_CANVAS_IFRAME' && location.hostname.endsWith('.scf.usercontent.goog')) {
      queryMainBridge({ type: 'PROBE_CANVAS_IFRAME', probePrompt: request.probePrompt }, 4000).then(sendResponse);
      return true;
    }
  });
})();
