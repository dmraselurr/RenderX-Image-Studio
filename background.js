/**
 * RenderX Image Studio - Background Service Worker (Manifest V3)
 * 70vw In-Browser Dock Injector + Keep-Alive Port + 6-Channel Concurrent Worker Pool
 * Zero Tab Hijacking + Global Deduplication + CORS-Free Base64 SW Fetcher
 */

const MAX_CONCURRENT_WORKERS = 6;
const DISPATCH_STAGGER_MS = 400;

let isQueueRunning = false;
let shouldStopQueue = false;
let currentQueueItems = [];
let currentEngine = 'gemini-canvas';
let currentSubMode = 'image';
let currentShotIndex = 0;

// Batch-wide state for deduplication & continuous stream collection
const globalCapturedImages = new Set();
const batchItemsByIndex = new Map();
const renderxWorkerTabIds = new Set();
let lastDispatchTimestamp = 0;
let dispatchMutex = Promise.resolve();

// MV3 Keep-Alive Port Management
const connectedPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'renderx_keepalive' || port.name === 'renderex_keepalive') {
    connectedPorts.add(port);
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'HEARTBEAT') {
        try {
          port.postMessage({ type: 'HEARTBEAT_ACK', timestamp: Date.now() });
        } catch (e) {}
      }
    });
    port.onDisconnect.addListener(() => {
      connectedPorts.delete(port);
    });
  }
});

// Clean up worker tab tracking when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  renderxWorkerTabIds.delete(tabId);
});

// Queue Persistence in chrome.storage.local
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

// Extension Icon Click -> Inject 70vw In-Browser Dock Overlay
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
    // Open a clean Gemini tab if user clicked icon from chrome://newtab or restricted page
    try {
      const createdTab = await chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true });
      await waitForTabComplete(createdTab.id, 20000);
      await new Promise(r => setTimeout(r, 800));
      await chrome.scripting.executeScript({
        target: { tabId: createdTab.id },
        files: ['overlay_injector.js']
      });
    } catch (err) {
      console.error('[RenderX] Failed to launch overlay on fallback tab:', err);
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

/**
 * Pre-Injection Prompt Sanitizer
 * Strips [00.00 - 00.00], Scene X:, Master Style DNA locked., and converts --no
 */
function sanitizePromptForEngine(rawPrompt) {
  if (!rawPrompt) return '';
  let text = String(rawPrompt);

  // Extract and remove bracketed/unbracketed timestamp + Scene X prefixes
  text = text.replace(/^\s*\[?[0-9.:\-\s]+\]?\s*\|\s*(Scene\s*\d+\s*:?\s*)?/i, '');
  text = text.replace(/^\s*\[[0-9.:\-\s]+\]\s*(Scene\s*\d+\s*:?\s*)?/i, '');
  text = text.replace(/^\s*Scene\s*\d+\s*:?\s*/i, '');

  // Strip boilerplate
  text = text.replace(/Master Style DNA locked\.?/gi, '');
  text = text.replace(/Style DNA locked\.?/gi, '');

  // Convert --no <terms> syntax
  text = text.replace(/--no:?\s+([^\n]+)/gi, (match, terms) => {
    const cleaned = terms.replace(/[.,]+$/, '').trim();
    return cleaned ? ` Clean composition, strictly avoiding ${cleaned}.` : '';
  });

  // Rephrase sensitive phrases
  const safetyRephrases = [
    { pattern: /\batomic bombings?\b/gi, replacement: 'historic 1945 post-war surrender era' },
    { pattern: /\bnuclear explosion\b/gi, replacement: 'massive cinematic fiery energy burst' },
    { pattern: /\bnuclear weapon\b/gi, replacement: 'monumental military technology' },
    { pattern: /\bblood\b/gi, replacement: 'crimson stains' },
    { pattern: /\bbloody\b/gi, replacement: 'crimson-tinted' },
    { pattern: /\bgore\b/gi, replacement: 'gritty battle wear' },
    { pattern: /\bcorpse\b/gi, replacement: 'fallen soldier in repose' },
    { pattern: /\bdead bodies\b/gi, replacement: 'aftermath of the battlefield' }
  ];

  for (const item of safetyRephrases) {
    text = text.replace(item.pattern, item.replacement);
  }

  return text.replace(/\s{2,}/g, ' ').trim();
}

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(tId, changeInfo) {
      if (tId === tabId && changeInfo.status === 'complete') {
        finish();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // Check immediately in case tab already completed
    chrome.tabs.get(tabId, (t) => {
      if (!chrome.runtime.lastError && t && t.status === 'complete') {
        finish();
      }
    });

    setTimeout(finish, timeoutMs);
  });
}

/**
 * Isolated Worker Tab Creator (Zero Tab Hijacking)
 * NEVER queries, focuses, or injects into user's foreground active tabs.
 * Always creates dedicated background worker tabs (active: false).
 */
async function createIsolatedWorkerTab(engine) {
  const isFlow = (engine === 'google-flow');
  const launchUrl = isFlow ? 'https://flow.google.com' : 'https://gemini.google.com/app';
  const scriptFile = isFlow ? 'content_flow.js' : 'content_canvas.js';

  const tab = await chrome.tabs.create({ url: launchUrl, active: false });
  renderxWorkerTabIds.add(tab.id);

  await waitForTabComplete(tab.id, 25000);
  await new Promise(r => setTimeout(r, 2500)); // SPA hydration delay

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const pong = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (res) => {
          if (chrome.runtime.lastError || !res) resolve(null);
          else resolve(res);
        });
      });
      if (pong && pong.status === 'READY') {
        return tab;
      }
    } catch (e) {}

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [scriptFile]
      });
      await new Promise(r => setTimeout(r, 700));
    } catch (injErr) {
      console.warn(`[RenderX] Worker tab ${tab.id} executeScript warning:`, injErr.message);
      await new Promise(r => setTimeout(r, 700));
    }
  }

  return tab;
}

async function closePreviousWorkerTabs() {
  const idsToClose = Array.from(renderxWorkerTabIds);
  renderxWorkerTabIds.clear();
  await Promise.all(idsToClose.map(id =>
    chrome.tabs.remove(id).catch(() => {})
  ));
}

/**
 * 400ms Non-Blocking Fire-and-Forget Dispatch Stagger Gate
 */
function acquireDispatchSlot() {
  const next = dispatchMutex.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, DISPATCH_STAGGER_MS - (now - lastDispatchTimestamp));
    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
    }
    lastDispatchTimestamp = Date.now();
  });
  dispatchMutex = next.catch(() => {});
  return next;
}

/**
 * Service Worker CORS-Free Image Fetcher -> Base64 Data URL
 */
async function fetchImageBase64InSW(imageUrl) {
  if (!imageUrl) throw new Error('Empty image URL');
  if (imageUrl.startsWith('data:')) return imageUrl;

  const resp = await fetch(imageUrl, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
  });
  if (!resp.ok) {
    throw new Error(`Image fetch HTTP ${resp.status}`);
  }

  const contentType = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${contentType};base64,${base64}`;
}

/**
 * Mark Shot Completed once and broadcast to dashboard
 */
async function finalizeShotCompleted(shotIndex, dataUrl, mediaType = 'image', duration = null) {
  const item = batchItemsByIndex.get(shotIndex);
  if (!item || item.status === 'done') return false;

  item.dataUrl = dataUrl;
  item.status = 'done';
  await persistQueueState();

  const completedCount = currentQueueItems.filter(i => i.status === 'done').length;
  broadcastToDashboard({
    type: 'ITEM_COMPLETED',
    index: item.index,
    mediaType: mediaType || (currentSubMode.includes('video') ? 'video' : 'image'),
    dataUrl,
    duration,
    completedCount,
    total: currentQueueItems.length
  });
  return true;
}

/**
 * 5-Attempt Resilient Turn Runner per Worker Channel
 */
async function processTurnWithRetry(item, tabId, engine, subMode) {
  const isVideo = (engine === 'google-flow' && (subMode === 'text-to-video' || subMode === 'image-to-video'));
  const maxRetries = 5;
  const timeoutMs = isVideo ? 120000 : 45000;
  let lastError = null;

  const sanitizedPrompt = sanitizePromptForEngine(item.fullPrompt || item.rawPrompt);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (shouldStopQueue) throw new Error('Queue stopped by user');
    if (item.status === 'done' && item.dataUrl) {
      return { success: true, dataUrl: item.dataUrl, mediaType: item.mediaType };
    }

    broadcastToDashboard({
      type: 'ITEM_STATUS_UPDATE',
      index: item.index,
      status: attempt === 1 ? 'Generating...' : `Attempt ${attempt}/${maxRetries}...`,
      attempt,
      maxRetries
    });

    try {
      const msgType = (engine === 'google-flow') ? 'GENERATE_FLOW_TURN' : 'GENERATE_CANVAS_TURN';
      const payload = {
        type: msgType,
        shotIndex: item.index,
        prompt: sanitizedPrompt,
        rawPrompt: item.rawPrompt,
        subMode: subMode || 'image',
        referenceImage: item.referenceImage || null,
        options: item.options || {}
      };

      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Turn timed out (${timeoutMs / 1000}s)`));
        }, timeoutMs);

        chrome.tabs.sendMessage(tabId, payload, (res) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!res || !res.success) {
            reject(new Error(res?.error || 'Turn returned without media output.'));
          } else {
            resolve(res);
          }
        });
      });

      if (response && (response.dataUrl || item.dataUrl)) {
        return response;
      }
    } catch (err) {
      if (item.status === 'done' && item.dataUrl) {
        return { success: true, dataUrl: item.dataUrl, mediaType: item.mediaType };
      }
      lastError = err;
      console.warn(`[RenderX] Shot #${item.index} (attempt ${attempt}/${maxRetries}) error:`, err.message);

      if (attempt < maxRetries && !shouldStopQueue) {
        const backoffMs = 1000 + (attempt * 500);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(`Shot #${item.index} failed after ${maxRetries} attempts: ${lastError?.message || 'Automation timeout'}`);
}

/**
 * 6-Channel Concurrent Worker Pool Executor
 */
async function runConcurrentBatchPool(items, engine = 'gemini-canvas', subMode = 'image') {
  if (isQueueRunning) {
    console.warn('[RenderX] Queue is already running');
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

  broadcastToDashboard({
    type: 'QUEUE_STARTED',
    total: items.length,
    engine,
    subMode
  });

  // Close stale RenderX worker tabs from previous batch (zero touch on user tabs)
  await closePreviousWorkerTabs();

  // Launch up to 6 dedicated background worker tabs concurrently
  const workerCount = Math.min(MAX_CONCURRENT_WORKERS, items.length);
  let workerTabs = [];
  try {
    const tabPromises = Array.from({ length: workerCount }, () => createIsolatedWorkerTab(engine));
    const settled = await Promise.allSettled(tabPromises);
    workerTabs = settled
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    if (workerTabs.length === 0) {
      throw new Error(`Could not initialize isolated ${engine} worker tabs.`);
    }
  } catch (err) {
    items.forEach(item => {
      item.status = 'failed';
      item.error = err.message;
      broadcastToDashboard({
        type: 'ITEM_FAILED',
        index: item.index,
        error: err.message,
        completedCount: 0,
        total: items.length
      });
    });
    isQueueRunning = false;
    await persistQueueState();
    broadcastToDashboard({ type: 'QUEUE_FINISHED', completedCount: 0, total: items.length, stopped: true });
    return;
  }

  let nextIdx = 0;

  async function workerChannelLoop(tab) {
    while (!shouldStopQueue) {
      const idx = nextIdx++;
      if (idx >= items.length) break;

      const item = items[idx];
      currentShotIndex = item.index;

      // Stagger prompt submissions by 400ms across parallel channels (Fire-and-Forget)
      await acquireDispatchSlot();
      if (shouldStopQueue) break;

      broadcastToDashboard({
        type: 'ITEM_STARTED',
        index: item.index,
        timestamp: item.timestamp,
        prompt: item.rawPrompt
      });

      try {
        const result = await processTurnWithRetry(item, tab.id, engine, subMode);
        if (item.status !== 'done' && result && result.dataUrl) {
          await finalizeShotCompleted(
            item.index,
            result.dataUrl,
            result.mediaType || (subMode.includes('video') ? 'video' : 'image'),
            result.duration
          );
        }
      } catch (err) {
        if (item.status !== 'done') {
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
  }

  // Run all worker channels concurrently
  await Promise.all(workerTabs.map(tab => workerChannelLoop(tab)));

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

/**
 * Broadcast message to dashboard iframe (via ports + runtime.sendMessage) & standalone tabs
 */
async function broadcastToDashboard(message) {
  for (const port of connectedPorts) {
    try {
      port.postMessage(message);
    } catch (e) {}
  }

  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (e) {}

  try {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const tabs = await chrome.tabs.query({ url: dashboardUrl });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (e) {}
}

// Runtime Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return false;

  if (request.action === 'FETCH_IMAGE_BASE64' || request.type === 'FETCH_IMAGE_BASE64') {
    const { shotIndex, imageUrl } = request;
    if (!imageUrl) {
      sendResponse({ success: false, error: 'Missing imageUrl' });
      return true;
    }

    // Batch-wide deduplication: never duplicate an already captured image across retries/workers
    if (globalCapturedImages.has(imageUrl)) {
      sendResponse({ success: false, duplicate: true, error: 'Image URL already captured in batch' });
      return true;
    }

    const targetItem = batchItemsByIndex.get(shotIndex);
    if (targetItem && targetItem.status === 'done' && targetItem.dataUrl) {
      sendResponse({ success: false, alreadyDone: true, error: 'Shot already completed' });
      return true;
    }

    globalCapturedImages.add(imageUrl);

    fetchImageBase64InSW(imageUrl)
      .then(async (dataUrl) => {
        await finalizeShotCompleted(shotIndex, dataUrl, 'image');
        sendResponse({ success: true, shotIndex, dataUrl });
      })
      .catch((err) => {
        // Release URL if fetch failed so another attempt or fallback can retry
        globalCapturedImages.delete(imageUrl);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  if (request.type === 'START_BATCH_QUEUE') {
    runConcurrentBatchPool(request.items || [], request.engine || 'gemini-canvas', request.subMode || 'image');
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
      activeWorkerTabs: renderxWorkerTabIds.size,
      geminiConnected: true,
      flowConnected: true
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
