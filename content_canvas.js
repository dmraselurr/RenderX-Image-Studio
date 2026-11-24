/**
 * RenderX Image Studio - Gemini Canvas Isolated Content Relay
 * Bridges MAIN world page interceptor/iframe runner with background.js.
 */

(function () {
  if (window.__renderexCanvasLoaded) return;
  window.__renderexCanvasLoaded = true;

  const isCanvasIframe = location.hostname.endsWith('.scf.usercontent.goog');
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

    if ((data.type === 'WIZ_TOKENS_RESULT' || data.type === 'IFRAME_TURN_RESULT') && data.requestId) {
      const resolver = pendingRequests.get(data.requestId);
      if (resolver) {
        pendingRequests.delete(data.requestId);
        resolver(data);
      }
    }
  });

  function queryMainBridge(payload, timeoutMs = 32000) {
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
      if (isCanvasIframe) {
        sendResponse({ status: 'READY', isIframe: true, url: window.location.href });
        return true;
      }
      return false;
    }

    if (request.type === 'READ_WIZ_TOKENS' && !isCanvasIframe) {
      queryMainBridge({ type: 'READ_WIZ_TOKENS' }, 2500).then(sendResponse);
      return true;
    }

    // Only respond from the *.scf.usercontent.goog Canvas iframe so main frame never steals sendResponse!
    if (request.type === 'RUN_CANVAS_IFRAME_TURN' && isCanvasIframe) {
      queryMainBridge({
        type: 'RUN_CANVAS_IFRAME_TURN',
        prompt: request.prompt,
        aspectRatio: request.aspectRatio || '1:1'
      }, 32000).then(sendResponse);
      return true;
    }

    return false;
  });
})();
