/**
 * RenderX Image Studio - Zero-Tab Orchestrator & 70vw Dock Controller (Manifest V3)
 * - NEVER performs RPC/API fetch() from background.js (Origin: chrome-extension:// gets rejected).
 * - Routes all batch jobs -> content script -> MAIN-world page bridge (canvas_page_bridge.js / flow_page_bridge.js).
 * - Only fetches CDN image URLs (googleusercontent.com) to Base64 in SW when needed.
 */

let isQueueRunning = false;
let shouldStopQueue = false;
let currentQueueItems = [];
let currentEngine = 'gemini-canvas';
let currentSubMode = 'image';
let activeBatchId = null;

const globalCapturedImages = new Set();
const connectedPorts = new Set();
const dockedTabIds = new Set();

let canvasTemplate = null; // { url, headers, body, promptHint, updatedAt }
let flowTemplate = null;   // { url, headers, body, promptHint, siteKey, updatedAt }
let lastCanvasPromptHint = '';

// Hydrate persisted templates & docked state
chrome.storage.local.get([
  'renderx_canvas_template',
  'renderx_flow_template',
  'renderx_docked_tabs',
  'renderx_selected_engine'
]).then((data) => {
  if (data?.renderx_canvas_template) canvasTemplate = data.renderx_canvas_template;
  if (data?.renderx_flow_template) flowTemplate = data.renderx_flow_template;
  if (Array.isArray(data?.renderx_docked_tabs)) {
    data.renderx_docked_tabs.forEach(id => dockedTabIds.add(id));
  }
  if (data?.renderx_selected_engine) currentEngine = data.renderx_selected_engine;
}).catch(() => {});

function persistDockedTabs() {
  chrome.storage.local.set({ renderx_docked_tabs: Array.from(dockedTabIds) }).catch(() => {});
}

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

// ================= 2. 70vw Dock Management =================
function getTargetHostUrl(engine) {
  return (engine === 'google-flow')
    ? 'https://flow.google.com'
    : 'https://gemini.google.com/share/f8350ff50be0';
}

function isRestrictedUrl(url = '') {
  return !url ||
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.includes('chrome.google.com/webstore') ||
    url.includes('chromewebstore.google.com');
}

function isEngineHostUrl(url = '', engine) {
  if (engine === 'google-flow') {
    return url.includes('flow.google.com') || url.includes('flow.google') || url.includes('labs.google') || url.includes('aitestkitchen.withgoogle.com');
  }
  return url.includes('gemini.google.com');
}

async function mountDockOnTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['overlay_injector.js']
    });
  } catch (err) {
    console.warn('[RenderX] Could not inject overlay_injector on tab', tabId, err.message);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && dockedTabIds.has(tabId) && tab && !isRestrictedUrl(tab.url)) {
    setTimeout(() => mountDockOnTab(tabId), 600);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (dockedTabIds.delete(tabId)) persistDockedTabs();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const url = tab.url || '';
  dockedTabIds.add(tab.id);
  persistDockedTabs();

  if (isRestrictedUrl(url) || !isEngineHostUrl(url, currentEngine)) {
    await chrome.tabs.update(tab.id, { url: getTargetHostUrl(currentEngine) });
    return;
  }

  await mountDockOnTab(tab.id);
});

// ================= 3. Backup webRequest Header/Body Sniffer =================
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

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('batchexecute') && details.url.includes('q4uTj')) {
      const bodyStr = decodeRequestBodyText(details.requestBody);
      if (bodyStr && bodyStr.includes('f.req=')) {
        canvasTemplate = {
          ...(canvasTemplate || {}),
          url: details.url,
          body: bodyStr,
          promptHint: lastCanvasPromptHint || (canvasTemplate && canvasTemplate.promptHint) || '',
          updatedAt: Date.now()
        };
        chrome.storage.local.set({ renderx_canvas_template: canvasTemplate }).catch(() => {});
        broadcastToDashboard({
          type: 'SYNC_STATUS_UPDATED',
          geminiSynced: true,
          flowSynced: Boolean(flowTemplate && flowTemplate.url && flowTemplate.body)
        });
      }
    }

    if (details.url.includes('aisandbox-pa.googleapis.com')) {
      const rawText = decodeRequestBodyText(details.requestBody);
      const isMediaGen = details.url.includes('batchGenerateImages') || details.url.includes('runImageFx') || details.url.includes('flowMedia');
      if (isMediaGen && rawText) {
        let promptHint = '';
        try {
          const j = JSON.parse(rawText);
          promptHint = (j.requests && j.requests[0] && j.requests[0].prompt) || j.prompt || '';
        } catch (e) {}
        flowTemplate = {
          ...(flowTemplate || {}),
          url: details.url,
          body: rawText,
          promptHint: promptHint || (flowTemplate && flowTemplate.promptHint) || '',
          updatedAt: Date.now()
        };
        chrome.storage.local.set({ renderx_flow_template: flowTemplate }).catch(() => {});
      }
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
    const hdrs = {};
    for (const h of details.requestHeaders) {
      if (h.name && h.value) hdrs[h.name] = h.value;
    }
    if (details.url.includes('aisandbox-pa.googleapis.com') && Object.keys(hdrs).length > 0) {
      flowTemplate = {
        ...(flowTemplate || {}),
        headers: { ...(flowTemplate && flowTemplate.headers ? flowTemplate.headers : {}), ...hdrs },
        updatedAt: Date.now()
      };
      chrome.storage.local.set({ renderx_flow_template: flowTemplate }).catch(() => {});
      if (flowTemplate.url && flowTemplate.body) {
        broadcastToDashboard({
          type: 'SYNC_STATUS_UPDATED',
          geminiSynced: Boolean(canvasTemplate && canvasTemplate.url && canvasTemplate.body),
          flowSynced: true
        });
      }
    }
  },
  { urls: ['https://aisandbox-pa.googleapis.com/*'] },
  ['requestHeaders', 'extraHeaders']
);

// ================= 4. Prompt Sanitizer & Queue Persistence =================
async function persistQueueState() {
  try {
    await chrome.storage.local.set({
      renderex_active_queue: {
        isQueueRunning,
        currentEngine,
        currentSubMode,
        items: currentQueueItems,
        lastUpdated: Date.now()
      }
    });
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

// ================= 5. SW CDN Image Fetcher (for googleusercontent / fifeUrl) =================
async function fetchImageBase64InSW(imageUrl) {
  if (!imageUrl) throw new Error('Empty image URL');
  if (imageUrl.startsWith('data:')) return imageUrl;

  const resp = await fetch(imageUrl, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
  });
  if (!resp.ok) throw new Error(`CDN Image fetch HTTP ${resp.status}`);

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

// ================= 6. MAIN-World Batch Orchestrator =================
async function findHostTab(engine) {
  const patterns = (engine === 'google-flow')
    ? ['https://flow.google.com/*', 'https://*.flow.google/*', 'https://labs.google/*', 'https://aitestkitchen.withgoogle.com/*']
    : ['https://gemini.google.com/*'];

  const tabs = await chrome.tabs.query({ url: patterns });
  if (!tabs || tabs.length === 0) return null;
  // Prefer active or share tab
  const preferred = tabs.find(t => t.active) || tabs.find(t => (t.url || '').includes('/share/')) || tabs[0];
  return preferred;
}

async function runMainWorldBatchOrchestration(items, engine = 'gemini-canvas', subMode = 'image') {
  if (isQueueRunning) return;

  isQueueRunning = true;
  shouldStopQueue = false;
  currentQueueItems = items;
  currentEngine = engine;
  currentSubMode = subMode;
  activeBatchId = `batch_${Date.now()}`;

  globalCapturedImages.clear();
  await persistQueueState();

  broadcastToDashboard({ type: 'QUEUE_STARTED', total: items.length, engine, subMode });
  broadcastToDashboard({ type: 'DIAGNOSTIC_LOG', text: `Routing ${items.length} shots to ${engine} MAIN-world bridge...` });

  const hostTab = await findHostTab(engine);
  if (!hostTab) {
    const errMsg = (engine === 'google-flow')
      ? 'No open Google Flow tab found. Switch to Google Flow in the dock so the left 30% loads flow.google.com.'
      : 'No open Gemini tab found. Click the RenderX icon to dock beside gemini.google.com/share/f8350ff50be0.';

    items.forEach(item => {
      item.status = 'failed';
      item.error = errMsg;
      broadcastToDashboard({ type: 'ITEM_FAILED', index: item.index, httpStatus: 0, error: errMsg });
    });
    isQueueRunning = false;
    await persistQueueState();
    broadcastToDashboard({ type: 'DIAGNOSTIC_LOG', text: errMsg });
    broadcastToDashboard({ type: 'QUEUE_FINISHED', completedCount: 0, total: items.length, stopped: true });
    return;
  }

  // Hydrate persisted template if in-memory null
  if (engine === 'gemini-canvas' && !canvasTemplate) {
    const d = await chrome.storage.local.get('renderx_canvas_template');
    if (d?.renderx_canvas_template) canvasTemplate = d.renderx_canvas_template;
  }
  if (engine === 'google-flow' && !flowTemplate) {
    const d = await chrome.storage.local.get('renderx_flow_template');
    if (d?.renderx_flow_template) flowTemplate = d.renderx_flow_template;
  }

  let remainingItems = [...items];

  // Step 1: If no captured raw body template exists yet, execute Shot #1 via the left-pane UI to capture exact raw request template
  const hasTemplate = (engine === 'google-flow')
    ? Boolean(flowTemplate && flowTemplate.url && flowTemplate.body)
    : Boolean(canvasTemplate && canvasTemplate.url && canvasTemplate.body);

  if (!hasTemplate && remainingItems.length > 0) {
    const firstItem = remainingItems.shift();
    const cleanFirstPrompt = sanitizePromptForEngine(firstItem.fullPrompt || firstItem.rawPrompt);
    broadcastToDashboard({ type: 'ITEM_STARTED', index: firstItem.index, timestamp: firstItem.timestamp, prompt: firstItem.rawPrompt });
    broadcastToDashboard({ type: 'DIAGNOSTIC_LOG', text: `Syncing Shot #${firstItem.index} in left pane to capture live ${engine} payload...` });

    try {
      const msgType = (engine === 'google-flow') ? 'RUN_FLOW_LEFT_PANE_TURN' : 'RUN_CANVAS_IFRAME_TURN';
      const res = await chrome.tabs.sendMessage(hostTab.id, {
        type: msgType,
        prompt: cleanFirstPrompt,
        aspectRatio: firstItem.aspectRatio || '1:1',
        subMode
      });

      if (!res || !res.ok || (!res.dataUrl && !res.imageUrl)) {
        throw new Error((res && res.error) || 'Initial sync shot failed to return media');
      }

      const finalDataUrl = res.dataUrl || await fetchImageBase64InSW(res.imageUrl);
      firstItem.dataUrl = finalDataUrl;
      firstItem.status = 'done';
      firstItem.mediaType = res.mediaType || 'image';
      globalCapturedImages.add(finalDataUrl);
      await persistQueueState();

      const completedCount = currentQueueItems.filter(i => i.status === 'done').length;
      broadcastToDashboard({
        type: 'ITEM_COMPLETED',
        index: firstItem.index,
        mediaType: firstItem.mediaType,
        dataUrl: finalDataUrl,
        completedCount,
        total: currentQueueItems.length
      });

      // Small wait so MAIN world capture message settles
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      firstItem.status = 'failed';
      firstItem.error = err.message;
      await persistQueueState();
      broadcastToDashboard({ type: 'ITEM_FAILED', index: firstItem.index, httpStatus: 0, error: err.message });
      broadcastToDashboard({ type: 'DIAGNOSTIC_LOG', text: `Sync Error: ${err.message}` });
    }
  }

  // Step 2: Dispatch remaining shots into MAIN-world 10-channel concurrent fetch() pool
  if (remainingItems.length > 0 && !shouldStopQueue) {
    const dispatchPayload = remainingItems.map(it => ({
      index: it.index,
      prompt: sanitizePromptForEngine(it.fullPrompt || it.rawPrompt),
      aspectRatio: it.aspectRatio || '1:1'
    }));

    const templateToUse = (engine === 'google-flow') ? flowTemplate : canvasTemplate;
    const msgType = (engine === 'google-flow') ? 'EXECUTE_FLOW_MAIN_BATCH' : 'EXECUTE_Q4UTJ_MAIN_BATCH';

    broadcastToDashboard({
      type: 'DIAGNOSTIC_LOG',
      text: `Executing ${dispatchPayload.length} shots inside page MAIN world (10 concurrent channels)...`
    });

    try {
      await chrome.tabs.sendMessage(hostTab.id, {
        type: msgType,
        batchId: activeBatchId,
        items: dispatchPayload,
        template: templateToUse
      });
    } catch (err) {
      const msg = `MAIN-world relay error: ${err.message}`;
      remainingItems.forEach(it => {
        it.status = 'failed';
        it.error = msg;
        broadcastToDashboard({ type: 'ITEM_FAILED', index: it.index, httpStatus: 0, error: msg });
      });
      isQueueRunning = false;
      await persistQueueState();
      broadcastToDashboard({ type: 'DIAGNOSTIC_LOG', text: msg });
      broadcastToDashboard({
        type: 'QUEUE_FINISHED',
        completedCount: currentQueueItems.filter(i => i.status === 'done').length,
        total: currentQueueItems.length,
        stopped: true
      });
    }
  } else {
    isQueueRunning = false;
    await persistQueueState();
    broadcastToDashboard({
      type: 'QUEUE_FINISHED',
      completedCount: currentQueueItems.filter(i => i.status === 'done').length,
      total: currentQueueItems.length,
      stopped: shouldStopQueue
    });
  }
}

// ================= 7. Broadcast & Runtime Listeners =================
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

  if (request.type === 'SWITCH_TO_DOCKED_MODE') {
    const targetEngine = request.engine || currentEngine || 'gemini-canvas';
    currentEngine = targetEngine;
    chrome.storage.local.set({ renderx_selected_engine: targetEngine }).catch(() => {});
    if (sender && sender.tab && sender.tab.id) {
      dockedTabIds.add(sender.tab.id);
      persistDockedTabs();
      chrome.tabs.update(sender.tab.id, { url: getTargetHostUrl(targetEngine) }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'SWITCH_ENGINE_HOST') {
    const targetEngine = request.engine || 'gemini-canvas';
    currentEngine = targetEngine;
    chrome.storage.local.set({ renderx_selected_engine: targetEngine }).catch(() => {});
    if (sender && sender.tab && sender.tab.id) {
      dockedTabIds.add(sender.tab.id);
      persistDockedTabs();
      if (!isEngineHostUrl(sender.tab.url || '', targetEngine)) {
        chrome.tabs.update(sender.tab.id, { url: getTargetHostUrl(targetEngine) }).catch(() => {});
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'CANVAS_PROMPT_HINT') {
    lastCanvasPromptHint = request.prompt || '';
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'CAPTURED_Q4UTJ_RAW') {
    canvasTemplate = {
      url: request.url,
      headers: request.headers || (canvasTemplate && canvasTemplate.headers) || {},
      body: request.body,
      promptHint: request.promptHint || lastCanvasPromptHint || (canvasTemplate && canvasTemplate.promptHint) || '',
      updatedAt: Date.now()
    };
    chrome.storage.local.set({ renderx_canvas_template: canvasTemplate }).catch(() => {});
    broadcastToDashboard({
      type: 'SYNC_STATUS_UPDATED',
      geminiSynced: true,
      flowSynced: Boolean(flowTemplate && flowTemplate.url && flowTemplate.body)
    });
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'CAPTURED_FLOW_RAW') {
    flowTemplate = {
      ...(flowTemplate || {}),
      url: request.url || (flowTemplate && flowTemplate.url) || '',
      headers: { ...(flowTemplate && flowTemplate.headers ? flowTemplate.headers : {}), ...(request.headers || {}) },
      body: request.body || (flowTemplate && flowTemplate.body) || '',
      promptHint: request.promptHint || (flowTemplate && flowTemplate.promptHint) || '',
      siteKey: request.siteKey || (flowTemplate && flowTemplate.siteKey) || '',
      updatedAt: Date.now()
    };
    chrome.storage.local.set({ renderx_flow_template: flowTemplate }).catch(() => {});
    if (flowTemplate.url && flowTemplate.body) {
      broadcastToDashboard({
        type: 'SYNC_STATUS_UPDATED',
        geminiSynced: Boolean(canvasTemplate && canvasTemplate.url && canvasTemplate.body),
        flowSynced: true
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'MAIN_BATCH_SHOT_RESULT') {
    const item = currentQueueItems.find(i => i.index === request.index);
    if (request.ok && (request.dataUrl || request.imageUrl)) {
      Promise.resolve(request.dataUrl ? request.dataUrl : fetchImageBase64InSW(request.imageUrl))
        .then(async (finalDataUrl) => {
          if (item && item.status !== 'done') {
            item.dataUrl = finalDataUrl;
            item.status = 'done';
            item.mediaType = currentSubMode.includes('video') ? 'video' : 'image';
            globalCapturedImages.add(finalDataUrl);
            await persistQueueState();
          }
          const completedCount = currentQueueItems.filter(i => i.status === 'done').length;
          broadcastToDashboard({
            type: 'ITEM_COMPLETED',
            index: request.index,
            httpStatus: request.httpStatus || 200,
            mediaType: item ? item.mediaType : 'image',
            dataUrl: finalDataUrl,
            completedCount,
            total: currentQueueItems.length
          });
          broadcastToDashboard({
            type: 'DIAGNOSTIC_LOG',
            text: `Shot #${request.index}: HTTP ${request.httpStatus || 200} OK (${completedCount}/${currentQueueItems.length})`
          });
        })
        .catch(async (err) => {
          if (item) {
            item.status = 'failed';
            item.error = err.message;
            await persistQueueState();
          }
          broadcastToDashboard({
            type: 'ITEM_FAILED',
            index: request.index,
            httpStatus: request.httpStatus || 0,
            error: err.message
          });
          broadcastToDashboard({ type: 'DIAGNOSTIC_LOG', text: `Shot #${request.index} CDN Error: ${err.message}` });
        });
    } else {
      if (item && item.status !== 'done') {
        item.status = 'failed';
        item.error = request.error || `HTTP ${request.httpStatus || 'ERR'} failure`;
        persistQueueState();
      }
      broadcastToDashboard({
        type: 'ITEM_FAILED',
        index: request.index,
        httpStatus: request.httpStatus || 0,
        error: request.error || `HTTP ${request.httpStatus || 'ERR'} failure`
      });
      broadcastToDashboard({
        type: 'DIAGNOSTIC_LOG',
        text: `Shot #${request.index} Failed (${request.error || 'HTTP ' + request.httpStatus})`
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'MAIN_BATCH_DONE') {
    isQueueRunning = false;
    persistQueueState();
    const finalCompleted = currentQueueItems.filter(i => i.status === 'done').length;
    broadcastToDashboard({
      type: 'QUEUE_FINISHED',
      completedCount: finalCompleted,
      total: currentQueueItems.length,
      stopped: shouldStopQueue
    });
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'START_BATCH_QUEUE') {
    runMainWorldBatchOrchestration(request.items || [], request.engine || 'gemini-canvas', request.subMode || 'image');
    sendResponse({ success: true, running: true });
    return true;
  }

  if (request.type === 'STOP_BATCH_QUEUE') {
    shouldStopQueue = true;
    isQueueRunning = false;
    sendResponse({ success: true, stopped: true });
    return true;
  }

  if (request.type === 'CHECK_STATUS') {
    sendResponse({
      success: true,
      isQueueRunning,
      activeEngine: currentEngine,
      geminiConnected: Boolean(canvasTemplate && canvasTemplate.url && canvasTemplate.body),
      flowConnected: Boolean(flowTemplate && flowTemplate.url && flowTemplate.body)
    });
    return true;
  }

  if (request.type === 'GET_PERSISTED_QUEUE') {
    chrome.storage.local.get('renderex_active_queue').then(d => sendResponse({ success: true, queue: d?.renderex_active_queue || null }));
    return true;
  }

  if (request.type === 'CLEAR_PERSISTED_QUEUE') {
    chrome.storage.local.remove('renderex_active_queue').then(() => sendResponse({ success: true }));
    return true;
  }
});
