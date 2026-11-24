/**
 * RenderX Image Studio - Google Flow MAIN World Bridge
 * Runs passively in MAIN world on flow.google.com/* and labs.google/*
 * Captures Bearer auth token, projectId, recaptcha siteKey, and API payloads with ZERO tab hijacking.
 */

(function () {
  if (window.__renderxFlowBridgeLoaded) return;
  window.__renderxFlowBridgeLoaded = true;

  const ORIGIN_TAG = 'RENDERX_FLOW_BRIDGE';

  function extractProjectIdFromUrl(urlStr) {
    const m = String(urlStr || '').match(/\/projects\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : '';
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
          const client = window.___grecaptcha_cfg.clients[key];
          const str = JSON.stringify(client);
          const m = str.match(/"sitekey"\s*:\s*"([^"]+)"/);
          if (m) return m[1];
        }
      }
    } catch (e) {}
    return '';
  }

  // Passively observe window.fetch on Flow to capture Bearer token, API key, projectId, and payload templates
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function (...args) {
      try {
        const input = args[0];
        const init = args[1] || {};
        const urlStr = (typeof input === 'string') ? input : (input && input.url) || '';

        if (urlStr.includes('aisandbox-pa.googleapis.com') || urlStr.includes('/fx/api/')) {
          const headers = {};
          const rawHeaders = init.headers || (input && input.headers);
          if (rawHeaders) {
            if (typeof rawHeaders.forEach === 'function') {
              rawHeaders.forEach((v, k) => { headers[k.toLowerCase()] = v; });
            } else if (Array.isArray(rawHeaders)) {
              rawHeaders.forEach(([k, v]) => { headers[String(k).toLowerCase()] = v; });
            } else if (typeof rawHeaders === 'object') {
              Object.keys(rawHeaders).forEach(k => { headers[k.toLowerCase()] = rawHeaders[k]; });
            }
          }

          let bodyJson = null;
          if (typeof init.body === 'string' && init.body.trim().startsWith('{')) {
            try { bodyJson = JSON.parse(init.body); } catch (e) {}
          }

          const projectId = extractProjectIdFromUrl(urlStr) ||
            extractProjectIdFromUrl(location.href) ||
            (bodyJson && bodyJson.clientContext && bodyJson.clientContext.projectId) || '';

          window.postMessage({
            source: ORIGIN_TAG,
            type: 'CAPTURED_FLOW_CALL',
            url: urlStr,
            authorization: headers['authorization'] || '',
            apiKey: headers['x-goog-api-key'] || '',
            projectId,
            bodyJson,
            siteKey: findRecaptchaSiteKey()
          }, '*');
        }
      } catch (e) {}

      return origFetch.apply(this, args);
    };
  }

  // Handle direct requests from content_flow.js (get projectId / recaptcha token)
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.source !== 'RENDERX_FLOW_CS') return;

    if (data.type === 'GET_FLOW_CONTEXT') {
      const projectId = extractProjectIdFromUrl(location.href);
      const siteKey = data.siteKey || findRecaptchaSiteKey();
      let recaptchaToken = '';

      if (siteKey && window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.execute === 'function') {
        try {
          recaptchaToken = await window.grecaptcha.enterprise.execute(siteKey, { action: 'FLOW_GENERATION' });
        } catch (e) {}
      }

      window.postMessage({
        source: ORIGIN_TAG,
        type: 'FLOW_CONTEXT_RESULT',
        requestId: data.requestId,
        projectId,
        siteKey,
        recaptchaToken
      }, '*');
    }
  });
})();
