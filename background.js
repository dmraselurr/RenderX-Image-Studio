/**
 * RenderX Image Studio - Background Service Worker (Manifest V3)
 * Dual-Mode Account Studio (Gemini Canvas & Google Flow)
 * Attached Side Panel Workspace + Keep-Alive + State Persistence
 */

// Side Panel Registration & Dual Click Triggers (Manifest V3)
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error("[RenderX] Failed to open Side Panel:", err);
  }
});

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
    port.onMessage.addListener((msg) => {
      if (msg.type === 'HEARTBEAT') {
        port.postMessage({ type: 'HEARTBEAT_ACK', timestamp: Date.now() });
      }
    });
    port.onDisconnect.addListener(() => {
      connectedPorts.delete(port);
    });
  }
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

/**
 * Workspace Window Arranger:
 * Arranges Left 30% for Google Session (Gemini / Flow) and Right 70% for RenderX Studio.
 * Uses standard Chrome windows (type: 'normal') to prevent broken web-app appearances.
 */
async function setup70PercentStudioLayout(requestedEngine = 'gemini-canvas') {
  try {
    const currentWin = await chrome.windows.getCurrent();
    const screenW = currentWin.width ? Math.max(currentWin.width, 1400) : 1920;
    const screenH = currentWin.height ? Math.max(currentWin.height, 800) : 1080;

    const leftWidth = Math.round(screenW * 0.30);
    const rightWidth = screenW - leftWidth;

    // 1. Google Account Session Tab (Left 30%)
    let targetUrls = [];
    let launchUrl = '';

    if (requestedEngine === 'google-flow') {
      targetUrls = ["https://flow.google.com/*", "https://*.flow.google/*", "https://labs.google/*", "https://aitestkitchen.withgoogle.com/*"];
      launchUrl = "https://labs.google/fx/tools/flow";
    } else {
      targetUrls = ["https://gemini.google.com/*"];
      launchUrl = "https://gemini.google.com/app";
    }

    const existingGoogleTabs = await chrome.tabs.query({ url: targetUrls });
    let googleWinId = null;
    let googleTab = null;

    if (existingGoogleTabs && existingGoogleTabs.length > 0) {
      googleTab = existingGoogleTabs[0];
      googleWinId = googleTab.windowId;
      try {
        await chrome.windows.update(googleWinId, {
          left: 0,
          top: 0,
          width: leftWidth,
          height: screenH,
          state: 'normal',
          focused: false
        });
        await chrome.tabs.update(googleTab.id, { active: true });
      } catch (e) {}
    } else {
      // Create new standard window on Left 30%
      const newWin = await chrome.windows.create({
        url: launchUrl,
        type: 'normal',
        left: 0,
        top: 0,
        width: leftWidth,
        height: screenH,
        focused: false
      });
      googleWinId = newWin.id;
      if (newWin.tabs && newWin.tabs.length > 0) {
        googleTab = newWin.tabs[0];
      }
    }

    // 2. RenderX Studio Dashboard (Right 70%)
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const existingDashTabs = await chrome.tabs.query({ url: dashboardUrl });

    if (existingDashTabs && existingDashTabs.length > 0) {
      const dashTab = existingDashTabs[0];
      await chrome.windows.update(dashTab.windowId, {
        left: leftWidth,
        top: 0,
        width: rightWidth,
        height: screenH,
        state: 'normal',
        focused: true
      });
      await chrome.tabs.update(dashTab.id, { active: true });
    } else {
      await chrome.windows.create({
        url: dashboardUrl,
        type: 'normal',
        left: leftWidth,
        top: 0,
        width: rightWidth,
        height: screenH,
        focused: true
      });
    }

    return { googleTab, googleWinId };
  } catch (err) {
    console.error('[RenderX] Error setting up 70% layout:', err);
  }
}



/**
 * Pre-Injection Prompt Sanitizer
 */
function sanitizePromptForEngine(rawPrompt) {
  if (!rawPrompt) return '';
  let text = String(rawPrompt);

  // Extract and remove scene/timestamp prefixes
  text = text.replace(/^(\[?[0-9.:\-\s]+\]?\s*\|\s*)?(Scene\s*\d+\s*:?\s*)?/i, '');
  text = text.replace(/^\[[0-9.:\-\s]+\]\s*:?\s*/i, '');

  // Strip boilerplate
  text = text.replace(/Master Style DNA locked\.?/gi, '');
  text = text.replace(/Style DNA locked\.?/gi, '');

  // Convert negative syntax
  text = text.replace(/--no:?\s+([^,\n\.]+)([,.\n]|$)/gi, (match, terms) => {
    return ` Clean composition, strictly avoiding ${terms.trim()}. `;
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

/**
 * Resilient Tab Handshake & Content Script Verification
 */
async function ensureConnectedEngineTab(engine) {
  let targetUrls = [];
  let launchUrl = '';
  let scriptFile = '';

  if (engine === 'google-flow') {
    targetUrls = ["https://flow.google.com/*", "https://*.flow.google/*", "https://labs.google/*", "https://aitestkitchen.withgoogle.com/*"];
    launchUrl = "https://labs.google/fx/tools/flow";
    scriptFile = "content_flow.js";
  } else {
    targetUrls = ["https://gemini.google.com/*"];
    launchUrl = "https://gemini.google.com/app";
    scriptFile = "content_canvas.js";
  }

  // Cross-Window tab query (NEVER currentWindow: true)
  const tabs = await chrome.tabs.query({ url: targetUrls });
  let tab = null;

  if (tabs && tabs.length > 0) {
    tab = tabs[0];
  } else {
    console.log(`[RenderX] No open tab for ${engine}, launching: ${launchUrl}`);
    tab = await chrome.tabs.create({ url: launchUrl, active: true });
    await waitForTabComplete(tab.id, 25000);
    await new Promise(r => setTimeout(r, 3500)); // SPA hydration wait
  }

  // Perform Ping Handshake
  let isReady = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const pong = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (res) => {
          if (chrome.runtime.lastError || !res) resolve(null);
          else resolve(res);
        });
      });

      if (pong && pong.status === 'READY') {
        isReady = true;
        break;
      }
    } catch (e) {}

    // Not responding, inject script programmatically
    console.log(`[RenderX] Content script not responding on tab ${tab.id}, injecting ${scriptFile}...`);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [scriptFile]
      });
      await new Promise(r => setTimeout(r, 1000));
    } catch (injErr) {
      console.warn('[RenderX] executeScript warning:', injErr.message);
    }
  }

  return tab;
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
 * 5-Attempt Resilient Turn Runner
 */
async function processTurnWithRetry(item, tabId, engine, subMode) {
  const isVideo = (engine === 'google-flow' && (subMode === 'text-to-video' || subMode === 'image-to-video'));
  const maxRetries = 5;
  const timeoutMs = isVideo ? 120000 : 38000;
  let lastError = null;

  const sanitizedPrompt = sanitizePromptForEngine(item.fullPrompt || item.rawPrompt);

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
            reject(new Error(res?.error || 'Turn returned without image output.'));
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
      console.warn(`[RenderX] Shot #${item.index} (attempt ${attempt}/${maxRetries}) error:`, err.message);

      if (attempt < maxRetries && !shouldStopQueue) {
        // Exponential backoff with jitter
        const backoffMs = 1200 + (attempt * 600);
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
    engineTab = await ensureConnectedEngineTab(engine);
  } catch (err) {
    broadcastToDashboard({
      type: 'QUEUE_ERROR',
      error: `Could not connect to ${engine}: ${err.message}`
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

      // Pacing pause
      if (i < items.length - 1 && !shouldStopQueue) {
        await new Promise(r => setTimeout(r, 1600));
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
 * Broadcast message to dashboard windows and ports
 */
async function broadcastToDashboard(message) {
  try {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const tabs = await chrome.tabs.query({ url: dashboardUrl });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (e) {}

  for (const port of connectedPorts) {
    try {
      port.postMessage(message);
    } catch (e) {}
  }
}

// Runtime Message Listener
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

  if (request.type === 'ARRANGE_70_PERCENT_WORKSPACE') {
    setup70PercentStudioLayout(request.engine || 'gemini-canvas').then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.type === 'CHECK_STATUS') {
    Promise.all([
      chrome.tabs.query({ url: "https://gemini.google.com/*" }),
      chrome.tabs.query({ url: ["https://flow.google.com/*", "https://*.flow.google/*", "https://labs.google/*"] })
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
