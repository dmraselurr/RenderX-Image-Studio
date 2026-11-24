/**
 * RenderX Image Studio - Gemini Canvas Isolated Content Relay
 * Bridges background.js <-> MAIN world canvas_page_bridge.js across top frame and sandboxed iframes.
 */

(function () {
  if (window.__renderexCanvasLoaded) return;
  window.__renderexCanvasLoaded = true;

  const isTopFrame = (window.top === window);
  const isCanvasIframe = !isTopFrame && (location.hostname.endsWith('.scf.usercontent.goog') || location.hostname.endsWith('.googleusercontent.com'));
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

    if (data.type === 'CAPTURED_Q4UTJ_RAW') {
      chrome.runtime.sendMessage({
        type: 'CAPTURED_Q4UTJ_RAW',
        url: data.url,
        headers: data.headers,
        body: data.body,
        promptHint: data.promptHint
      }).catch(() => {});
    }

    if (data.type === 'MAIN_BATCH_SHOT_RESULT') {
      chrome.runtime.sendMessage({
        type: 'MAIN_BATCH_SHOT_RESULT',
        engine: 'gemini-canvas',
        batchId: data.batchId,
        index: data.index,
        ok: data.ok,
        httpStatus: data.httpStatus,
        dataUrl: data.dataUrl,
        imageUrl: data.imageUrl,
        error: data.error
      }).catch(() => {});
    }

    if (data.type === 'MAIN_BATCH_DONE') {
      chrome.runtime.sendMessage({
        type: 'MAIN_BATCH_DONE',
        engine: 'gemini-canvas',
        batchId: data.batchId
      }).catch(() => {});
    }

    if (data.type === 'IFRAME_TURN_RESULT' && data.requestId) {
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

    if (request.type === 'PING' && isTopFrame) {
      sendResponse({ status: 'READY', frame: 'top', url: window.location.href });
      return true;
    }

    if (request.type === 'EXECUTE_Q4UTJ_MAIN_BATCH' && isTopFrame) {
      window.postMessage({
        source: 'RENDERX_CANVAS_CS',
        type: 'EXECUTE_Q4UTJ_MAIN_BATCH',
        items: request.items,
        template: request.template,
        batchId: request.batchId
      }, '*');
      sendResponse({ ok: true, dispatched: true });
      return true;
    }

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
