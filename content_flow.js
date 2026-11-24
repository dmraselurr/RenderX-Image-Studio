/**
 * RenderX Image Studio - Google Flow Isolated Content Relay
 * Passively bridges MAIN world auth/project/recaptcha capture to background.js (Zero DOM automation / Zero new tabs).
 */

(function () {
  if (window.__renderexFlowLoaded) return;
  window.__renderexFlowLoaded = true;

  const pendingRequests = new Map();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'RENDERX_FLOW_BRIDGE') return;

    if (data.type === 'CAPTURED_FLOW_CALL') {
      chrome.runtime.sendMessage({
        type: 'CAPTURED_FLOW_CALL',
        url: data.url,
        authorization: data.authorization,
        apiKey: data.apiKey,
        projectId: data.projectId,
        bodyJson: data.bodyJson,
        siteKey: data.siteKey
      }).catch(() => {});
    }

    if (data.type === 'FLOW_CONTEXT_RESULT' && data.requestId) {
      const resolver = pendingRequests.get(data.requestId);
      if (resolver) {
        pendingRequests.delete(data.requestId);
        resolver(data);
      }
    }
  });

  function queryFlowBridge(payload, timeoutMs = 4500) {
    return new Promise((resolve) => {
      const requestId = `flow_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        resolve({ ok: false, error: 'Flow bridge timeout' });
      }, timeoutMs);

      pendingRequests.set(requestId, (res) => {
        clearTimeout(timer);
        resolve(res);
      });

      window.postMessage({ ...payload, source: 'RENDERX_FLOW_CS', requestId }, '*');
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return false;

    if (request.type === 'PING') {
      sendResponse({ status: 'READY', mode: 'google-flow-relay', url: window.location.href });
      return true;
    }

    if (request.type === 'GET_FLOW_CONTEXT') {
      queryFlowBridge({ type: 'GET_FLOW_CONTEXT', siteKey: request.siteKey || '' }, 4500)
        .then(sendResponse);
      return true;
    }
  });
})();
