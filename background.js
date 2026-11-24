/**
 * RenderX Image Studio - Hardened Background Service Worker (Manifest V3)
 * Attached Side Panel Workspace + Cross-Window Tab Discovery + SW Keep-Alive
 * Snapshot-Diff DOM Automation & 5-Attempt Resilient Retry Queue
 */

// 1. Attached Side Panel Workspace (Never floating popup windows)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => console.log('[RenderX] Side panel configured: openPanelOnActionClick = true'))
    .catch(err => console.error('[RenderX] Side panel config error:', err));
}

// State
let isQueueRunning = false;
let shouldStopQueue = false;
let currentQueueItems = [];
let currentEngine = 'gemini-canvas';
let currentSubMode = 'image';
let currentShotIndex = 0;

// MV3 Keep-Alive Port Management
const connectedPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'renderex_keepalive') {
    connectedPorts.add(port);
    console.log('[RenderX KeepAlive] Connected from dashboard. Active ports:', connectedPorts.size);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'HEARTBEAT') {
        port.postMessage({ type: 'HEARTBEAT_ACK', timestamp: Date.now() });
      }
    });

    port.onDisconnect.addListener(() => {
      connectedPorts.delete(port);
      console.log('[RenderX KeepAlive] Port disconnected. Remaining:', connectedPorts.size);
    });
  }
});

// Queue State Persistence in chrome.storage.local
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
  } catch (e) {
    console.warn('[RenderX] Failed to persist queue state:', e);
  }
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

/**
 * 4. Pre-Injection Prompt Sanitizer
 * Strips scene headers, boilerplate DNA locks, converts negative syntax, and rephrases sensitive terms.
 */
function sanitizePromptForEngine(rawPrompt) {
  if (!rawPrompt) return '';
  let text = String(rawPrompt);

  // 1. Extract and remove timestamp and scene prefixes (e.g., "[00.00 - 04.35] Scene 1:", "00.00-04.35 | Scene 1:", "Scene 1:")
  text = text.replace(/^(\[?[0-9.:\-\s]+\]?\s*\|\s*)?(Scene\s*\d+\s*:?\s*)?/i, '');
  text = text.replace(/^\[[0-9.:\-\s]+\]\s*:?\s*/i, '');

  // 2. Strip "Master Style DNA locked." or similar boilerplate
  text = text.replace(/Master Style DNA locked\.?/gi, '');
  text = text.replace(/Style DNA locked\.?/gi, '');

  // 3. Convert "--no <terms>" into "Clean composition, strictly avoiding <terms>."
  text = text.replace(/--no:?\s+([^,\n\.]+)([,.\n]|$)/gi, (match, terms) => {
    return ` Clean composition, strictly avoiding ${terms.trim()}. `;
  });

  // 4. Rephrase sensitive conflict / sensitive historical phrases to prevent safety blocks
  const safetyRephrases = [
    { pattern: /\batomic bombings?\b/gi, replacement: 'historic 1945 post-war surrender era' },
    { pattern: /\bnuclear explosion\b/gi, replacement: 'massive cinematic fiery energy burst' },
    { pattern: /\bnuclear weapon\b/gi, replacement: 'monumental military technology' },
    { pattern: /\bblood\b/gi, replacement: 'crimson stains' },
    { pattern: /\bbloody\b/gi, replacement: 'crimson-tinted' },
    { pattern: /\bgore\b/gi, replacement: 'gritty battle wear' },
    { pattern: /\bcorpse\b/gi, replacement: 'fallen soldier in repose' },
    { pattern: /\bdead bodies\b/gi, replacement: 'aftermath of the battlefield' },
    { pattern: /\bweapon of mass destruction\b/gi, replacement: 'monumental strategic weapon' }
  ];

  for (const item of safetyRephrases) {
    text = text.replace(item.pattern, item.replacement);
  }

  // Remove redundant whitespace
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

/**
 * 3. Cross-Window Tab Discovery & Programmatic Injection
 * Finds target Google session across ALL windows (never currentWindow: true).
 * Ensures content script is injected with idempotency guard (window.__renderexLoaded).
 */
async function ensureEngineTabAndScript(engine) {
  let targetUrls = [];
  let launchUrl = '';
  let scriptFile = '';

  if (engine === 'google-flow') {
    targetUrls = ["https://flow.google.com/*", "https://labs.google/*"];
    launchUrl = "https://labs.google/fx/tools/flow";
    scriptFile = "content_flow.js";
  } else {
    targetUrls = ["https://gemini.google.com/*"];
    launchUrl = "https://gemini.google.com/app";
    scriptFile = "content_canvas.js";
  }

  // Cross-Window search (NEVER currentWindow: true)
  const matchingTabs = await chrome.tabs.query({ url: targetUrls });
  let targetTab = null;

  if (matchingTabs && matchingTabs.length > 0) {
    targetTab = matchingTabs[0];
    console.log(`[RenderX] Found existing ${engine} tab (ID: ${targetTab.id}, windowId: ${targetTab.windowId})`);
  } else {
    console.log(`[RenderX] No open tab found for ${engine}. Creating: ${launchUrl}`);
    targetTab = await chrome.tabs.create({ url: launchUrl, active: true });

    // Wait for page load complete
    await waitForTabComplete(targetTab.id, 25000);
    // Extra 3000ms delay for SPA hydration (React / Angular / Lit)
    await new Promise(r => setTimeout(r, 3000));
  }

  // Verify and programmatically inject content script with idempotency guard
  try {
    const checkResults = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => window.__renderexLoaded === true
    });

    const isLoaded = checkResults && checkResults[0] && checkResults[0].result === true;
    if (!isLoaded) {
      console.log(`[RenderX] Programmatically injecting ${scriptFile} into tab ${targetTab.id}...`);
      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        files: [scriptFile]
      });
      await new Promise(r => setTimeout(r, 800));
    } else {
      console.log(`[RenderX] Content script already active in tab ${targetTab.id}`);
    }
  } catch (err) {
    console.warn(`[RenderX] Script injection check note:`, err.message);
  }

  return targetTab;
}

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    function listener(tId, changeInfo) {
      if (tId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
  });
}

/**
 * 6. 5-Attempt Retry Loop with Exponential/Jittered Backoff
 */
async function processTurnWithRetry(item, tabId, engine, subMode) {
  const isVideo = (engine === 'google-flow' && (subMode === 'text-to-video' || subMode === 'image-to-video'));
  const maxRetries = 5;
  const timeoutMs = isVideo ? 120000 : 35000;
  let lastError = null;

  // Sanitize the prompt before injecting into the engine
  const sanitizedPrompt = sanitizePromptForEngine(item.fullPrompt || item.rawPrompt);
  console.log(`[RenderX] Shot #${item.index} sanitized prompt:`, sanitizedPrompt.slice(0, 70));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (shouldStopQueue) throw new Error('Queue stopped by user');

    broadcastToDashboard({
      type: 'ITEM_STATUS_UPDATE',
      index: item.index,
      status: `Attempt ${attempt}/${maxRetries}...`,
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
            reject(new Error(res?.error || 'No media returned'));
          } else {
            resolve(res);
          }
        });
      });

      if (response && response.dataUrl) {
        return response;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[RenderX] Shot #${item.index} (attempt ${attempt}/${maxRetries}) failed:`, err.message);

      if (attempt < maxRetries && !shouldStopQueue) {
        const backoffMs = 1000 + (attempt * 500); // 1.5s - 3s
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(`Shot #${item.index} failed after ${maxRetries} attempts: ${lastError?.message || 'Automation timeout'}`);
}

/**
 * Sequential Queue Executor
 */
async function runSequentialQueue(items, engine = 'gemini-canvas', subMode = 'image') {
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

  await persistQueueState();

  broadcastToDashboard({
    type: 'QUEUE_STARTED',
    total: items.length,
    engine,
    subMode
  });

  let engineTab = null;
  try {
    engineTab = await ensureEngineTabAndScript(engine);
  } catch (err) {
    broadcastToDashboard({
      type: 'QUEUE_ERROR',
      error: `Could not launch or connect to ${engine}: ${err.message}`
    });
    isQueueRunning = false;
    await persistQueueState();
    return;
  }

  let completedCount = 0;

  for (let i = 0; i < items.length; i++) {
    if (shouldStopQueue) break;

    const item = items[i];
    currentShotIndex = item.index;
    await persistQueueState();

    broadcastToDashboard({
      type: 'ITEM_STARTED',
      index: item.index,
      timestamp: item.timestamp,
      prompt: item.rawPrompt
    });

    try {
      const result = await processTurnWithRetry(item, engineTab.id, engine, subMode);
      completedCount++;
      item.dataUrl = result.dataUrl;
      item.status = 'done';
      await persistQueueState();

      broadcastToDashboard({
        type: 'ITEM_COMPLETED',
        index: item.index,
        mediaType: result.mediaType || (subMode.includes('video') ? 'video' : 'image'),
        dataUrl: result.dataUrl,
        duration: result.duration,
        completedCount,
        total: items.length
      });

      // Brief pacing pause between shots
      if (i < items.length - 1 && !shouldStopQueue) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      item.status = 'failed';
      item.error = err.message;
      await persistQueueState();

      broadcastToDashboard({
        type: 'ITEM_FAILED',
        index: item.index,
        error: err.message,
        completedCount,
        total: items.length
      });
    }
  }

  isQueueRunning = false;
  await persistQueueState();

  broadcastToDashboard({
    type: 'QUEUE_FINISHED',
    completedCount,
    total: items.length,
    stopped: shouldStopQueue
  });
}

/**
 * Broadcast message to open dashboard / sidepanel
 */
async function broadcastToDashboard(message) {
  try {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const tabs = await chrome.tabs.query({ url: dashboardUrl });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (e) {}

  // Also broadcast via runtime ports
  for (const port of connectedPorts) {
    try {
      port.postMessage(message);
    } catch (e) {}
  }
}

// -----------------------------------------------------------------
// Runtime Message Listener
// -----------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_BATCH_QUEUE') {
    runSequentialQueue(request.items || [], request.engine || 'gemini-canvas', request.subMode || 'image');
    sendResponse({ success: true, running: true });
    return true;
  }

  if (request.type === 'STOP_BATCH_QUEUE') {
    shouldStopQueue = true;
    sendResponse({ success: true, stopped: true });
    return true;
  }

  if (request.type === 'CHECK_STATUS') {
    Promise.all([
      chrome.tabs.query({ url: "https://gemini.google.com/*" }),
      chrome.tabs.query({ url: ["https://flow.google.com/*", "https://labs.google/*"] })
    ]).then(([geminiTabs, flowTabs]) => {
      sendResponse({
        success: true,
        isQueueRunning,
        currentShotIndex,
        geminiConnected: geminiTabs && geminiTabs.length > 0,
        flowConnected: flowTabs && flowTabs.length > 0
      });
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
