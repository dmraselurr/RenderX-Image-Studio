/**
 * RenderX Image Studio - Background Service Worker (Manifest V3)
 * Dual-Mode Engine Router + 75% Right Split-Screen Window Docking
 * Prevents Chrome Background Tab Throttling by Keeping Both Windows in Foreground
 */

let isQueueRunning = false;
let shouldStopQueue = false;

/**
 * Handle Extension Action Click:
 * Automatically arranges workspace with Left 28% Google Tab and Right 72% Extension Studio
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await setupSplitScreenLayout();
  } catch (err) {
    console.warn('[RenderX] Split-screen layout fallback:', err);
    // Fallback: Open in normal tab if window positioning fails
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const existingTabs = await chrome.tabs.query({ url: dashboardUrl });
    if (existingTabs && existingTabs.length > 0) {
      chrome.tabs.update(existingTabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url: dashboardUrl });
    }
  }
});

/**
 * Split Screen Arranger (Left 28% Google Session | Right 72% Studio)
 */
async function setupSplitScreenLayout() {
  const currentWin = await chrome.windows.getCurrent();
  const screenW = currentWin.width ? Math.max(currentWin.width, 1366) : 1920;
  const screenH = currentWin.height ? Math.max(currentWin.height, 768) : 1080;

  const leftWidth = Math.round(screenW * 0.28);
  const rightWidth = screenW - leftWidth;
  const topPos = 0;

  // 1. Find or create Google Session Tab (Gemini or Flow)
  const googleTabs = await chrome.tabs.query({
    url: ["https://gemini.google.com/*", "https://flow.google.com/*", "https://labs.google/*"]
  });

  let googleWinId = null;
  if (googleTabs && googleTabs.length > 0) {
    googleWinId = googleTabs[0].windowId;
    await chrome.windows.update(googleWinId, {
      left: 0,
      top: topPos,
      width: leftWidth,
      height: screenH,
      state: 'normal',
      focused: false
    });
  } else {
    // Open Gemini in left window
    const newGoogleWin = await chrome.windows.create({
      url: 'https://gemini.google.com/app',
      left: 0,
      top: topPos,
      width: leftWidth,
      height: screenH,
      focused: false
    });
    googleWinId = newGoogleWin.id;
  }

  // 2. Find or create Extension Studio Window (Right 72%)
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const dashTabs = await chrome.tabs.query({ url: dashboardUrl });

  if (dashTabs && dashTabs.length > 0) {
    await chrome.windows.update(dashTabs[0].windowId, {
      left: leftWidth,
      top: topPos,
      width: rightWidth,
      height: screenH,
      state: 'normal',
      focused: true
    });
  } else {
    await chrome.windows.create({
      url: dashboardUrl,
      type: 'popup',
      left: leftWidth,
      top: topPos,
      width: rightWidth,
      height: screenH,
      focused: true
    });
  }
}

/**
 * Locate or launch target engine tab
 */
async function getOrCreateEngineTab(engine) {
  if (engine === 'google-flow') {
    const flowTabs = await chrome.tabs.query({
      url: ["https://flow.google.com/*", "https://labs.google/*"]
    });
    if (flowTabs && flowTabs.length > 0) {
      return flowTabs[0];
    }

    console.log('[RenderX] Launching Google Flow tab...');
    const newTab = await chrome.tabs.create({
      url: 'https://labs.google/fx/tools/flow',
      active: true
    });

    await waitForTabComplete(newTab.id, 20000);
    await new Promise(r => setTimeout(r, 2500));
    return newTab;
  } else {
    // Gemini Canvas Mode
    const geminiTabs = await chrome.tabs.query({ url: "https://gemini.google.com/*" });
    if (geminiTabs && geminiTabs.length > 0) {
      return geminiTabs[0];
    }

    console.log('[RenderX] Launching Gemini tab...');
    const newTab = await chrome.tabs.create({
      url: 'https://gemini.google.com/app',
      active: true
    });

    await waitForTabComplete(newTab.id, 15000);
    await new Promise(r => setTimeout(r, 2000));
    return newTab;
  }
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
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
 * Single Turn Runner with Retry
 */
async function processTurnWithRetry(item, tabId, engine, subMode) {
  const isVideo = (engine === 'google-flow' && (subMode === 'text-to-video' || subMode === 'image-to-video'));
  const maxRetries = isVideo ? 2 : 5;
  const timeoutMs = isVideo ? 125000 : 30000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (shouldStopQueue) throw new Error('Queue stopped by user');

    broadcastToDashboard({
      type: 'ITEM_STATUS_UPDATE',
      itemId: item.id,
      index: item.index,
      status: isVideo ? `Generating video (Clip #${item.index})...` : `Attempt ${attempt}/${maxRetries}...`,
      attempt,
      maxRetries
    });

    try {
      const msgType = (engine === 'google-flow') ? 'GENERATE_FLOW_TURN' : 'GENERATE_CANVAS_TURN';
      const payload = {
        type: msgType,
        prompt: item.fullPrompt,
        subMode: subMode || 'image',
        referenceImage: item.referenceImage || null,
        options: item.options || {}
      };

      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Turn response timeout (${timeoutMs / 1000}s)`));
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

      if (response && response.dataUrl) {
        return response;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[RenderX] Item #${item.index} (attempt ${attempt}) error:`, err.message);

      if (attempt < maxRetries && !shouldStopQueue) {
        await new Promise(r => setTimeout(r, 2200));
      }
    }
  }

  throw new Error(`Media generation failed after ${maxRetries} attempts: ${lastError?.message || 'Timeout'}`);
}

/**
 * Sequential Queue Executor
 */
async function runSequentialQueue(items, engine = 'gemini-canvas', subMode = 'image') {
  if (isQueueRunning) {
    console.warn('[RenderX] Queue is already active.');
    return;
  }

  isQueueRunning = true;
  shouldStopQueue = false;

  broadcastToDashboard({
    type: 'QUEUE_STARTED',
    total: items.length,
    engine,
    subMode
  });

  let engineTab = null;
  try {
    engineTab = await getOrCreateEngineTab(engine);
  } catch (err) {
    broadcastToDashboard({
      type: 'QUEUE_ERROR',
      error: `Could not connect to ${engine} tab: ${err.message}`
    });
    isQueueRunning = false;
    return;
  }

  let completedCount = 0;

  for (let i = 0; i < items.length; i++) {
    if (shouldStopQueue) break;

    const item = items[i];
    broadcastToDashboard({
      type: 'ITEM_STARTED',
      itemId: item.id,
      index: item.index,
      prompt: item.fullPrompt
    });

    try {
      const result = await processTurnWithRetry(item, engineTab.id, engine, subMode);
      completedCount++;

      broadcastToDashboard({
        type: 'ITEM_COMPLETED',
        itemId: item.id,
        index: item.index,
        mediaType: result.mediaType || (subMode.includes('video') ? 'video' : 'image'),
        dataUrl: result.dataUrl,
        duration: result.duration,
        completedCount,
        total: items.length
      });

      if (i < items.length - 1 && !shouldStopQueue) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      broadcastToDashboard({
        type: 'ITEM_FAILED',
        itemId: item.id,
        index: item.index,
        error: err.message,
        completedCount,
        total: items.length
      });
    }
  }

  isQueueRunning = false;
  broadcastToDashboard({
    type: 'QUEUE_FINISHED',
    completedCount,
    total: items.length,
    stopped: shouldStopQueue
  });
}

/**
 * Broadcast message to open dashboard tab(s)
 */
async function broadcastToDashboard(message) {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({ url: dashboardUrl });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
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

  if (request.type === 'ARRANGE_SPLIT_SCREEN') {
    setupSplitScreenLayout().then(() => sendResponse({ success: true }));
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
        geminiConnected: geminiTabs && geminiTabs.length > 0,
        flowConnected: flowTabs && flowTabs.length > 0
      });
    });
    return true;
  }
});
