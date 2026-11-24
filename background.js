/**
 * RenderX Image Studio - Zero-Tab Direct RPC & API Engine (Manifest V3)
 * 70vw In-Browser Dock + MV3 Keep-Alive + webRequest Protocol Capture
 * Gemini Canvas (Direct batchexecute q4uTj Pool) & Google Flow (Direct aisandbox-pa Pool)
 * ZERO chrome.tabs.create during generation | ZERO main chat clutter
 */

const DIRECT_FETCH_CONCURRENCY = 20;
const MICRO_STAGGER_MS = 60;

let isQueueRunning = false;
let shouldStopQueue = false;
let currentQueueItems = [];
let currentEngine = 'gemini-canvas';
let currentSubMode = 'image';
let currentShotIndex = 0;

const globalCapturedImages = new Set();
const batchItemsByIndex = new Map();
const connectedPorts = new Set();

let reqSeqCounter = Math.floor(100000 + Math.random() * 800000);
let lastDispatchTime = 0;
let dispatchMutex = Promise.resolve();

// In-memory + persisted protocol caches
let q4uTjTemplate = null;     // { url, sourcePath, bl, fsid, at, fReqRaw, promptHint, aspectRatioHint, updatedAt }
let lastCanvasPromptHint = '';
let lastCanvasAspectHint = 'square';
let flowAuthContext = null;   // { authorization, apiKey, projectId, endpointTemplate, bodyTemplate, siteKey, updatedAt }

// Hydrate saved templates on SW startup
chrome.storage.local.get(['renderx_q4utj_template', 'renderx_flow_auth']).then((data) => {
  if (data?.renderx_q4utj_template) q4uTjTemplate = data.renderx_q4utj_template;
  if (data?.renderx_flow_auth) flowAuthContext = data.renderx_flow_auth;
}).catch(() => {});

// ================= 1. MV3 Keep-Alive Port =================
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'renderx_keepalive' || port.name === 'renderex_keepalive') {
    connectedPorts.add(port);
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'HEARTBEAT') {
        try { port.postMessage({ type: 'HEARTBEAT_ACK', timestamp: Date.now() }); } catch (e) {}
      }
    });
    port.onDisconnect.addListener(() => connectedPorts.delete(port));
  }
});

// ================= 2. 70vw In-Browser Dock Injector =================
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const url = tab.url || '';
  const isRestricted = url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.includes('chrome.google.com/webstore') ||
    url.includes('chromewebstore.google.com');

  if (isRestricted) {
    // Update the current restricted blank tab directly (no extra tab spawned)
    try {
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('dashboard.html') });
    } catch (err) {
      console.error('[RenderX] Cannot navigate restricted tab:', err);
    }
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['overlay_injector.js']
    });
  } catch (err) {
    console.error('[RenderX] Failed to inject 70vw dock overlay:', err);
  }
});

// ================= 3. Passive webRequest Protocol Sniffers =================
function decodeRequestBodyText(requestBody) {
  if (!requestBody) return '';
  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const [k, vals] of Object.entries(requestBody.formData)) {
      if (Array.isArray(vals)) vals.forEach(v => params.append(k, v));
    }
    return params.toString();
  }
  if (requestBody.raw && requestBody.raw.length > 0) {
    try {
      const decoder = new TextDecoder('utf-8');
      return requestBody.raw.map(part => part.bytes ? decoder.decode(part.bytes) : '').join('');
    } catch (e) {}
  }
  return '';
}

function saveCapturedQ4uTj(urlStr, bodyStr, promptHint = '') {
  try {
    if (!bodyStr || !bodyStr.includes('f.req=')) return false;
    const params = new URLSearchParams(bodyStr);
    const fReqRaw = params.get('f.req');
    if (!fReqRaw || !fReqRaw.includes('q4uTj')) return false;

    const urlObj = new URL(urlStr);
    const bl = urlObj.searchParams.get('bl') || (q4uTjTemplate && q4uTjTemplate.bl) || '';
    const fsid = urlObj.searchParams.get('f.sid') || (q4uTjTemplate && q4uTjTemplate.fsid) || '';
    const sourcePath = urlObj.searchParams.get('source-path') || '/share/f8350ff50be0';
    const at = params.get('at') || (q4uTjTemplate && q4uTjTemplate.at) || '';

    q4uTjTemplate = {
      url: urlStr,
      sourcePath,
      bl,
      fsid,
      at,
      fReqRaw,
      promptHint: promptHint || lastCanvasPromptHint || (q4uTjTemplate && q4uTjTemplate.promptHint) || '',
      aspectRatioHint: lastCanvasAspectHint || 'square',
      updatedAt: Date.now()
    };

    chrome.storage.local.set({ renderx_q4utj_template: q4uTjTemplate }).catch(() => {});
    console.log('[RenderX] Captured live Gemini Canvas q4uTj RPC template!');
    return true;
  } catch (e) {
    return false;
  }
}

// Listen for Gemini batchexecute q4uTj requests & Flow aisandbox-pa requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('batchexecute') && details.url.includes('q4uTj')) {
      const bodyStr = decodeRequestBodyText(details.requestBody);
      if (bodyStr) saveCapturedQ4uTj(details.url, bodyStr);
    }

    if (details.url.includes('aisandbox-pa.googleapis.com')) {
      const rawText = decodeRequestBodyText(details.requestBody);
      let bodyJson = null;
      if (rawText && rawText.trim().startsWith('{')) {
        try { bodyJson = JSON.parse(rawText); } catch (e) {}
      }
      const projMatch = details.url.match(/\/projects\/([a-zA-Z0-9_-]+)/);
      const projectId = (projMatch && projMatch[1]) ||
        (bodyJson && bodyJson.clientContext && bodyJson.clientContext.projectId) ||
        (flowAuthContext && flowAuthContext.projectId) || '';

      flowAuthContext = {
        ...(flowAuthContext || {}),
        projectId,
        lastEndpoint: details.url,
        bodyTemplate: details.url.includes('batchGenerateImages') || details.url.includes('runImageFx')
          ? (bodyJson || (flowAuthContext && flowAuthContext.bodyTemplate))
          : (flowAuthContext && flowAuthContext.bodyTemplate) || bodyJson,
        updatedAt: Date.now()
      };
      chrome.storage.local.set({ renderx_flow_auth: flowAuthContext }).catch(() => {});
    }
  },
  {
    urls: [
      'https://gemini.google.com/_/BardChatUi/data/batchexecute*',
      'https://aisandbox-pa.googleapis.com/*'
    ]
  },
  ['requestBody']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details.requestHeaders) return;
    let auth = '';
    let apiKey = '';
    for (const h of details.requestHeaders) {
      const name = (h.name || '').toLowerCase();
      if (name === 'authorization' && h.value) auth = h.value;
      if (name === 'x-goog-api-key' && h.value) apiKey = h.value;
    }
    if (auth || apiKey) {
      flowAuthContext = {
        ...(flowAuthContext || {}),
        authorization: auth || (flowAuthContext && flowAuthContext.authorization) || '',
        apiKey: apiKey || (flowAuthContext && flowAuthContext.apiKey) || '',
        updatedAt: Date.now()
      };
      chrome.storage.local.set({ renderx_flow_auth: flowAuthContext }).catch(() => {});
    }
  },
  {
    urls: ['https://aisandbox-pa.googleapis.com/*']
  },
  ['requestHeaders', 'extraHeaders']
);

// ================= 4. Prompt Sanitizer & Queue Persistence =================
async function persistQueueState() {
  try {
    await chrome.storage.local.set({
      renderex_active_queue: {
        isQueueRunning,
        currentShotIndex,
        currentEngine,
        currentSubMode,
        items: currentQueueItems,
        lastUpdated: Date.now()
      }
    });
  } catch (e) {}
}

async function loadPersistedQueueState() {
  try {
    const data = await chrome.storage.local.get('renderex_active_queue');
    return data?.renderex_active_queue || null;
  } catch (e) {
    return null;
  }
}

async function clearPersistedQueueState() {
  try {
    await chrome.storage.local.remove('renderex_active_queue');
  } catch (e) {}
}

function sanitizePromptForEngine(rawPrompt) {
  if (!rawPrompt) return '';
  let text = String(rawPrompt);

  text = text.replace(/^\s*\[?[0-9.:\-\s]+\]?\s*\|\s*(Scene\s*\d+\s*:?\s*)?/i, '');
  text = text.replace(/^\s*\[[0-9.:\-\s]+\]\s*(Scene\s*\d+\s*:?\s*)?/i, '');
  text = text.replace(/^\s*Scene\s*\d+\s*:?\s*/i, '');
  text = text.replace(/Master Style DNA locked\.?/gi, '');
  text = text.replace(/Style DNA locked\.?/gi, '');

  text = text.replace(/--no:?\s+([^\n]+)/gi, (match, terms) => {
    const cleaned = terms.replace(/[.,]+$/, '').trim();
    return cleaned ? ` Clean composition, strictly avoiding ${cleaned}.` : '';
  });

  return text.replace(/\s{2,}/g, ' ').trim();
}

function acquireMicroSlot() {
  const next = dispatchMutex.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, MICRO_STAGGER_MS - (now - lastDispatchTime));
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    lastDispatchTime = Date.now();
  });
  dispatchMutex = next.catch(() => {});
  return next;
}

// ================= 5. Gemini Canvas Direct RPC Engine (q4uTj) =================

/**
 * Fetch fresh bl, f.sid, and SNlM0e ('at') silently in background (0 tabs!)
 */
async function refreshGeminiSessionMeta(sourcePath = '/share/f8350ff50be0') {
  try {
    const targetUrl = `https://gemini.google.com${sourcePath.startsWith('/') ? sourcePath : '/' + sourcePath}`;
    const resp = await fetch(targetUrl, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'text/html,application/xhtml+xml' }
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const bl = (html.match(/"cfb2h":"([^"]+)"/) || [])[1] || '';
    const fsid = (html.match(/"FdrFJe":"([^"]+)"/) || [])[1] || '';
    const at = (html.match(/"SNlM0e":"([^"]+)"/) || [])[1] || '';
    return { bl, fsid, at };
  } catch (e) {
    return null;
  }
}

/**
 * If q4uTj template is not cached yet, silently probe an ALREADY-OPEN Canvas share tab (never opens new tabs!)
 */
async function ensureQ4uTjTemplateAvailable() {
  if (q4uTjTemplate && q4uTjTemplate.fReqRaw) return q4uTjTemplate;

  const stored = await chrome.storage.local.get('renderx_q4utj_template');
  if (stored?.renderx_q4utj_template?.fReqRaw) {
    q4uTjTemplate = stored.renderx_q4utj_template;
    return q4uTjTemplate;
  }

  // Check if user already has a gemini.google.com/share/* tab open (zero new tabs created!)
  const existingShareTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/share/*' });
  if (existingShareTabs && existingShareTabs.length > 0) {
    for (const tab of existingShareTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'PROBE_CANVAS_IFRAME',
          probePrompt: 'minimalist white geometric sphere on dark navy background'
        });

        // Wait up to 4s for webRequest / page bridge to capture q4uTj
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 200));
          if (q4uTjTemplate && q4uTjTemplate.fReqRaw) {
            return q4uTjTemplate;
          }
        }
      } catch (e) {}
    }
  }

  throw new Error('Gemini Canvas RPC not synced yet. Open https://gemini.google.com/share/f8350ff50be0 in a tab and generate 1 test image (or reload it with RenderX open) so the q4uTj engine auto-syncs once.');
}

/**
 * Recursively patch prompt & aspect ratio inside captured q4uTj f.req JSON
 */
function patchQ4uTjPayload(template, item) {
  const outer = JSON.parse(template.fReqRaw);
  const innerStr = outer[0][1];
  const promptText = sanitizePromptForEngine(item.fullPrompt || item.rawPrompt);
  const targetRatio = item.aspectRatio || '1:1';
  const promptHint = (template.promptHint || '').trim();

  function looksLikeJson(str) {
    if (typeof str !== 'string') return false;
    const t = str.trim();
    return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
  }

  let replacedPrompt = false;

  function transformNode(node, parentKey = '') {
    if (typeof node === 'string') {
      if (looksLikeJson(node)) {
        try {
          const parsed = JSON.parse(node);
          const transformed = transformNode(parsed, parentKey);
          return JSON.stringify(transformed);
        } catch (e) {}
      }

      // Match exact aspect ratio strings
      if (node === '1:1' || node === '16:9' || node === '9:16') {
        return targetRatio;
      }
      if (node === 'square' || node === 'landscape' || node === 'portrait') {
        return targetRatio === '16:9' ? 'landscape' : (targetRatio === '9:16' ? 'portrait' : 'square');
      }

      // Match prompt hint if captured
      if (promptHint && node.includes(promptHint)) {
        replacedPrompt = true;
        return promptText;
      }

      // Match prompt / text object keys
      const keyLower = String(parentKey).toLowerCase();
      if ((keyLower === 'prompt' || keyLower === 'text') && node.length > 2 && !node.startsWith('http')) {
        replacedPrompt = true;
        return promptText;
      }

      return node;
    }

    if (Array.isArray(node)) {
      return node.map((child) => transformNode(child, parentKey));
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

  // Fallback: if no key/hint matched, replace the longest natural-language non-URL/non-ID string inside the payload
  if (!replacedPrompt) {
    let bestPath = null;
    let bestLen = 0;

    function scanLongestText(node, path) {
      if (typeof node === 'string') {
        if (looksLikeJson(node)) {
          try {
            scanLongestText(JSON.parse(node), path.concat(['__JSON__']));
            return;
          } catch (e) {}
        }
        const isUrl = node.startsWith('http') || node.startsWith('/') || node.startsWith('data:');
        const isModelOrId = /^(models\/|gemini-|imagen-|projects\/|[a-f0-9-]{20,})/i.test(node);
        if (!isUrl && !isModelOrId && node.includes(' ') && node.length > bestLen) {
          bestLen = node.length;
          bestPath = path;
        }
      } else if (Array.isArray(node)) {
        node.forEach((child, idx) => scanLongestText(child, path.concat([idx])));
      } else if (node && typeof node === 'object') {
        Object.entries(node).forEach(([k, v]) => scanLongestText(v, path.concat([k])));
      }
    }

    scanLongestText(parsedInner, []);

    if (bestPath) {
      function setAtPath(node, path, idx = 0) {
        const seg = path[idx];
        if (seg === '__JSON__') {
          const innerObj = JSON.parse(node);
          return JSON.stringify(setAtPath(innerObj, path, idx + 1));
        }
        if (idx === path.length - 1) {
          node[seg] = promptText;
          return node;
        }
        node[seg] = setAtPath(node[seg], path, idx + 1);
        return node;
      }
      parsedInner = setAtPath(parsedInner, bestPath);
    }
  }

  outer[0][1] = typeof parsedInner === 'string' ? parsedInner : JSON.stringify(parsedInner);
  return JSON.stringify(outer);
}

/**
 * Recursively extract generated image Base64 or Googleusercontent URL from batchexecute response
 */
async function extractImageFromBatchExecuteResponse(rawText) {
  if (!rawText) throw new Error('Empty batchexecute response');

  const cleaned = rawText.replace(/^\)\]\}'\s*/, '');
  const lines = cleaned.split('\n');
  let foundPayload = null;
  let foundError = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (Array.isArray(entry) && entry[0] === 'wrb.fr' && entry[1] === 'q4uTj') {
          if (entry[2]) {
            foundPayload = entry[2];
          } else if (entry[5]) {
            foundError = JSON.stringify(entry[5]);
          }
        }
      }
    } catch (e) {}
  }

  if (!foundPayload) {
    if (foundError) throw new Error(`Canvas RPC returned error: ${foundError}`);
    throw new Error('No q4uTj payload found in Gemini response (session may require refresh).');
  }

  function looksLikeJson(str) {
    const t = str.trim();
    return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
  }

  let candidateImage = null;
  let candidateMime = 'image/png';
  let apiErrorMsg = null;

  function inspectNode(node) {
    if (candidateImage) return;

    if (typeof node === 'string') {
      if (looksLikeJson(node)) {
        try {
          inspectNode(JSON.parse(node));
          return;
        } catch (e) {}
      }

      if (node.startsWith('data:image/')) {
        candidateImage = node;
        return;
      }

      // Raw base64 image signatures (PNG / JPEG / WEBP)
      if (node.length > 1000) {
        if (node.startsWith('iVBORw0KGgo')) {
          candidateImage = `data:image/png;base64,${node}`;
          return;
        }
        if (node.startsWith('/9j/')) {
          candidateImage = `data:image/jpeg;base64,${node}`;
          return;
        }
        if (node.startsWith('UklGR')) {
          candidateImage = `data:image/webp;base64,${node}`;
          return;
        }
      }

      if (node.startsWith('https://') && node.includes('googleusercontent.com') && !node.includes('avatar') && !node.includes('profile')) {
        candidateImage = node;
        return;
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        inspectNode(item);
        if (candidateImage) return;
      }
      return;
    }

    if (node && typeof node === 'object') {
      if (node.error && node.error.message) {
        apiErrorMsg = node.error.message;
      }
      if (node.bytesBase64Encoded && typeof node.bytesBase64Encoded === 'string') {
        const mime = node.mimeType || candidateMime;
        candidateImage = `data:${mime};base64,${node.bytesBase64Encoded}`;
        return;
      }
      if (node.inlineData && node.inlineData.data) {
        const mime = node.inlineData.mimeType || candidateMime;
        candidateImage = `data:${mime};base64,${node.inlineData.data}`;
        return;
      }
      if (node.encodedImage && typeof node.encodedImage === 'string') {
        candidateImage = node.encodedImage.startsWith('data:')
          ? node.encodedImage
          : `data:image/png;base64,${node.encodedImage}`;
        return;
      }
      if (node.mimeType && typeof node.mimeType === 'string' && node.mimeType.startsWith('image/')) {
        candidateMime = node.mimeType;
      }
      for (const v of Object.values(node)) {
        inspectNode(v);
        if (candidateImage) return;
      }
    }
  }

  inspectNode(foundPayload);

  if (!candidateImage) {
    throw new Error(apiErrorMsg || 'Gemini Canvas RPC succeeded but contained no image data.');
  }

  if (candidateImage.startsWith('https://')) {
    return await fetchImageBase64InSW(candidateImage);
  }
  return candidateImage;
}

async function executeCanvasDirectRPC(item, sessionMeta) {
  const template = await ensureQ4uTjTemplateAvailable();
  const bl = (sessionMeta && sessionMeta.bl) || template.bl;
  const fsid = (sessionMeta && sessionMeta.fsid) || template.fsid;
  const at = (sessionMeta && sessionMeta.at) || template.at;
  const sourcePath = template.sourcePath || '/share/f8350ff50be0';

  reqSeqCounter += 100000;
  const qs = new URLSearchParams({
    rpcids: 'q4uTj',
    'source-path': sourcePath,
    bl,
    'f.sid': fsid,
    hl: 'en',
    _reqid: String(reqSeqCounter),
    rt: 'c'
  });

  const fReqPatched = patchQ4uTjPayload(template, item);
  const bodyParams = new URLSearchParams();
  bodyParams.set('f.req', fReqPatched);
  if (at) bodyParams.set('at', at);

  const resp = await fetch(`https://gemini.google.com/_/BardChatUi/data/batchexecute?${qs.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'X-Same-Domain': '1'
    },
    body: bodyParams.toString()
  });

  if (!resp.ok) {
    throw new Error(`Gemini RPC HTTP ${resp.status}`);
  }

  const rawText = await resp.text();
  const dataUrl = await extractImageFromBatchExecuteResponse(rawText);
  return { success: true, dataUrl, mediaType: 'image' };
}

// ================= 6. Google Flow Direct API Engine (aisandbox-pa) =================

async function getFlowRecaptchaFromOpenTab(siteKey) {
  try {
    const flowTabs = await chrome.tabs.query({
      url: ['https://flow.google.com/*', 'https://*.flow.google/*', 'https://labs.google/*', 'https://aitestkitchen.withgoogle.com/*']
    });
    if (flowTabs && flowTabs.length > 0) {
      const ctx = await chrome.tabs.sendMessage(flowTabs[0].id, { type: 'GET_FLOW_CONTEXT', siteKey });
      if (ctx) return ctx;
    }
  } catch (e) {}
  return null;
}

function mapAspectToFlowEnum(aspectRatio) {
  if (aspectRatio === '16:9') return 'IMAGE_ASPECT_RATIO_LANDSCAPE';
  if (aspectRatio === '9:16') return 'IMAGE_ASPECT_RATIO_PORTRAIT';
  return 'IMAGE_ASPECT_RATIO_SQUARE';
}

async function executeFlowDirectAPI(item, subMode = 'image') {
  if (!flowAuthContext) {
    const stored = await chrome.storage.local.get('renderx_flow_auth');
    if (stored?.renderx_flow_auth) flowAuthContext = stored.renderx_flow_auth;
  }

  const openCtx = await getFlowRecaptchaFromOpenTab(flowAuthContext && flowAuthContext.siteKey);
  const projectId = (openCtx && openCtx.projectId) || (flowAuthContext && flowAuthContext.projectId) || '';
  const authorization = (flowAuthContext && flowAuthContext.authorization) || '';
  const apiKey = (flowAuthContext && flowAuthContext.apiKey) || '';

  if (!authorization || !projectId) {
    throw new Error('Google Flow API session not synced yet. Open Google Flow on the left and generate 1 test prompt (or open a project) to auto-capture your live Bearer token & Project ID — after that RenderX runs 100% tab-free.');
  }

  const promptText = sanitizePromptForEngine(item.fullPrompt || item.rawPrompt);
  const aspectEnum = mapAspectToFlowEnum(item.aspectRatio || '1:1');
  const seed = Math.floor(100000 + Math.random() * 9000000);

  // Clone captured body template if available, otherwise construct standard flowMedia:batchGenerateImages body
  let payload;
  if (flowAuthContext.bodyTemplate && typeof flowAuthContext.bodyTemplate === 'object') {
    payload = JSON.parse(JSON.stringify(flowAuthContext.bodyTemplate));
    if (payload.clientContext) {
      payload.clientContext.projectId = projectId;
      payload.clientContext.sessionId = `;${Date.now()}`;
      if (openCtx && openCtx.recaptchaToken) {
        payload.clientContext.recaptchaContext = {
          applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
          token: openCtx.recaptchaToken
        };
      }
    }
    if (Array.isArray(payload.requests) && payload.requests.length > 0) {
      const req0 = { ...payload.requests[0], seed, prompt: promptText, imageAspectRatio: aspectEnum };
      payload.requests = [req0];
    } else {
      payload.prompt = promptText;
    }
  } else {
    payload = {
      clientContext: {
        projectId,
        sessionId: `;${Date.now()}`,
        tool: 'PINHOLE'
      },
      requests: [
        {
          seed,
          prompt: promptText,
          imageAspectRatio: aspectEnum,
          imageModelName: 'GEM_PIX_2'
        }
      ]
    };
    if (openCtx && openCtx.recaptchaToken) {
      payload.clientContext.recaptchaContext = {
        applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
        token: openCtx.recaptchaToken
      };
    }
  }

  const endpoint = (flowAuthContext.lastEndpoint && flowAuthContext.lastEndpoint.includes('batchGenerateImages'))
    ? flowAuthContext.lastEndpoint
    : `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia:batchGenerateImages`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': authorization
  };
  if (apiKey) headers['x-goog-api-key'] = apiKey;

  const resp = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Flow API HTTP ${resp.status}: ${errText.slice(0, 180)}`);
  }

  const json = await resp.json();

  // Extract Base64 / fifeUrl from Flow response recursively
  let foundMedia = null;
  function scanFlowJson(node) {
    if (foundMedia || !node) return;
    if (typeof node === 'object') {
      if (node.encodedImage && typeof node.encodedImage === 'string') {
        foundMedia = node.encodedImage.startsWith('data:')
          ? node.encodedImage
          : `data:image/png;base64,${node.encodedImage}`;
        return;
      }
      if (node.fifeUrl && typeof node.fifeUrl === 'string') {
        foundMedia = node.fifeUrl;
        return;
      }
      if (node.videoUrl && typeof node.videoUrl === 'string') {
        foundMedia = node.videoUrl;
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(scanFlowJson);
      } else {
        Object.values(node).forEach(scanFlowJson);
      }
    }
  }

  scanFlowJson(json);
  if (!foundMedia) {
    throw new Error('Flow API returned no encodedImage or media URL.');
  }

  const dataUrl = foundMedia.startsWith('http') ? await fetchImageBase64InSW(foundMedia) : foundMedia;
  return { success: true, dataUrl, mediaType: subMode.includes('video') ? 'video' : 'image' };
}

// ================= 7. Service Worker CORS-Free Base64 Fetcher =================
async function fetchImageBase64InSW(imageUrl) {
  if (!imageUrl) throw new Error('Empty image URL');
  if (imageUrl.startsWith('data:')) return imageUrl;

  const resp = await fetch(imageUrl, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
  });
  if (!resp.ok) throw new Error(`Image fetch HTTP ${resp.status}`);

  const contentType = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

// ================= 8. Zero-Tab High-Concurrency Direct Batch Pool =================
async function processShotDirectWithRetry(item, engine, subMode, sessionMeta) {
  const maxRetries = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (shouldStopQueue) throw new Error('Queue stopped by user');
    if (item.status === 'done' && item.dataUrl) {
      return { success: true, dataUrl: item.dataUrl, mediaType: item.mediaType };
    }

    broadcastToDashboard({
      type: 'ITEM_STATUS_UPDATE',
      index: item.index,
      status: attempt === 1 ? 'Generating...' : `Retry ${attempt}/${maxRetries}...`
    });

    try {
      const result = (engine === 'google-flow')
        ? await executeFlowDirectAPI(item, subMode)
        : await executeCanvasDirectRPC(item, sessionMeta);

      if (result && result.dataUrl) {
        if (globalCapturedImages.has(result.dataUrl)) {
          throw new Error('Duplicate media detected; retrying');
        }
        globalCapturedImages.add(result.dataUrl);
        return result;
      }
    } catch (err) {
      lastError = err;
      // Do not burn retries if protocol hasn't been synced yet
      if (err.message.includes('not synced yet')) {
        throw err;
      }
      if (attempt < maxRetries && !shouldStopQueue) {
        const backoffMs = 800 + attempt * 700;
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(lastError?.message || 'Direct RPC failed');
}

async function runZeroTabDirectBatch(items, engine = 'gemini-canvas', subMode = 'image') {
  if (isQueueRunning) {
    console.warn('[RenderX] Queue already running');
    return;
  }

  isQueueRunning = true;
  shouldStopQueue = false;
  currentQueueItems = items;
  currentEngine = engine;
  currentSubMode = subMode;
  currentShotIndex = 0;

  globalCapturedImages.clear();
  batchItemsByIndex.clear();
  items.forEach(it => batchItemsByIndex.set(it.index, it));
  await persistQueueState();

  broadcastToDashboard({ type: 'QUEUE_STARTED', total: items.length, engine, subMode });

  let sessionMeta = null;
  if (engine === 'gemini-canvas') {
    const sourcePath = (q4uTjTemplate && q4uTjTemplate.sourcePath) || '/share/f8350ff50be0';
    sessionMeta = await refreshGeminiSessionMeta(sourcePath);
  }

  let nextIdx = 0;
  const poolSize = Math.min(DIRECT_FETCH_CONCURRENCY, items.length);

  async function workerLoop() {
    while (!shouldStopQueue) {
      const idx = nextIdx++;
      if (idx >= items.length) break;

      const item = items[idx];
      currentShotIndex = item.index;

      await acquireMicroSlot();
      if (shouldStopQueue) break;

      broadcastToDashboard({
        type: 'ITEM_STARTED',
        index: item.index,
        timestamp: item.timestamp,
        prompt: item.rawPrompt
      });

      try {
        const result = await processShotDirectWithRetry(item, engine, subMode, sessionMeta);
        item.dataUrl = result.dataUrl;
        item.status = 'done';
        item.mediaType = result.mediaType || 'image';
        await persistQueueState();

        const completedCount = currentQueueItems.filter(i => i.status === 'done').length;
        broadcastToDashboard({
          type: 'ITEM_COMPLETED',
          index: item.index,
          mediaType: item.mediaType,
          dataUrl: item.dataUrl,
          completedCount,
          total: items.length
        });
      } catch (err) {
        item.status = 'failed';
        item.error = err.message;
        await persistQueueState();

        const completedCount = currentQueueItems.filter(i => i.status === 'done').length;
        broadcastToDashboard({
          type: 'ITEM_FAILED',
          index: item.index,
          error: err.message,
          completedCount,
          total: items.length
        });
      }
    }
  }

  await Promise.all(Array.from({ length: poolSize }, () => workerLoop()));

  isQueueRunning = false;
  await persistQueueState();

  const finalCompleted = currentQueueItems.filter(i => i.status === 'done').length;
  broadcastToDashboard({
    type: 'QUEUE_FINISHED',
    completedCount: finalCompleted,
    total: items.length,
    stopped: shouldStopQueue
  });
}

// ================= 9. Broadcast & Runtime Listeners =================
async function broadcastToDashboard(message) {
  for (const port of connectedPorts) {
    try { port.postMessage(message); } catch (e) {}
  }
  try { chrome.runtime.sendMessage(message).catch(() => {}); } catch (e) {}
  try {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const tabs = await chrome.tabs.query({ url: dashboardUrl });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (e) {}
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return false;

  if (request.type === 'CANVAS_PROMPT_HINT') {
    lastCanvasPromptHint = request.prompt || '';
    lastCanvasAspectHint = request.aspectRatio || 'square';
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'CAPTURED_Q4UTJ_FETCH') {
    const ok = saveCapturedQ4uTj(request.url, request.body, request.promptHint);
    if (ok) broadcastToDashboard({ type: 'SYNC_STATUS_UPDATED', geminiSynced: true, flowSynced: Boolean(flowAuthContext?.authorization) });
    sendResponse({ ok });
    return true;
  }

  if (request.type === 'CAPTURED_FLOW_CALL') {
    flowAuthContext = {
      ...(flowAuthContext || {}),
      authorization: request.authorization || (flowAuthContext && flowAuthContext.authorization) || '',
      apiKey: request.apiKey || (flowAuthContext && flowAuthContext.apiKey) || '',
      projectId: request.projectId || (flowAuthContext && flowAuthContext.projectId) || '',
      siteKey: request.siteKey || (flowAuthContext && flowAuthContext.siteKey) || '',
      lastEndpoint: request.url || (flowAuthContext && flowAuthContext.lastEndpoint) || '',
      bodyTemplate: request.bodyJson || (flowAuthContext && flowAuthContext.bodyTemplate) || null,
      updatedAt: Date.now()
    };
    chrome.storage.local.set({ renderx_flow_auth: flowAuthContext }).catch(() => {});
    broadcastToDashboard({ type: 'SYNC_STATUS_UPDATED', geminiSynced: Boolean(q4uTjTemplate?.fReqRaw), flowSynced: Boolean(flowAuthContext?.authorization) });
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'FETCH_IMAGE_BASE64' || request.type === 'FETCH_IMAGE_BASE64') {
    fetchImageBase64InSW(request.imageUrl)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'START_BATCH_QUEUE') {
    runZeroTabDirectBatch(request.items || [], request.engine || 'gemini-canvas', request.subMode || 'image');
    sendResponse({ success: true, running: true });
    return true;
  }

  if (request.type === 'STOP_BATCH_QUEUE') {
    shouldStopQueue = true;
    sendResponse({ success: true, stopped: true });
    return true;
  }

  if (request.type === 'CHECK_STATUS') {
    sendResponse({
      success: true,
      isQueueRunning,
      currentShotIndex,
      geminiConnected: Boolean(q4uTjTemplate && q4uTjTemplate.fReqRaw),
      flowConnected: Boolean(flowAuthContext && flowAuthContext.authorization && flowAuthContext.projectId)
    });
    return true;
  }

  if (request.type === 'GET_PERSISTED_QUEUE') {
    loadPersistedQueueState().then(data => sendResponse({ success: true, queue: data }));
    return true;
  }

  if (request.type === 'CLEAR_PERSISTED_QUEUE') {
    clearPersistedQueueState().then(() => sendResponse({ success: true }));
    return true;
  }
});
