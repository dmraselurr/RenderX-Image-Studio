/**
 * RenderX Image Studio - Studio Dashboard Controller (v1.0.9 PRO)
 * Dual-Mode Account Studio (Gemini Canvas & Google Flow)
 * Attached Side Panel Workspace + Keep-Alive + State Persistence
 */

document.addEventListener('DOMContentLoaded', () => {
  // Application State
  const state = {
    engine: 'gemini-canvas',       // 'gemini-canvas' | 'google-flow'
    subMode: 'image',              // 'image' | 'text-to-video' | 'image-to-video'
    aspectRatio: '1:1',            // '1:1' | '16:9' | '9:16'
    isGenerating: false,
    items: [],
    flowReferenceImage: null,
    charImageBase64: null,
    styleImageBase64: null
  };

  const $ = (id) => document.getElementById(id);

  // Topbar Elements
  const sessionStatusPill = $('sessionStatusPill');
  const sessionDot = $('sessionDot');
  const sessionStatusText = $('sessionStatusText');
  const btnSidePanelInfo = $('btnSidePanelInfo');
  const sessionInfoBtn = $('sessionInfoBtn');
  const globalResetBtn = $('globalResetBtn');

  // Box 1: Engine & Aspect Elements
  const btnEngineCanvas = $('btnEngineCanvas');
  const btnEngineFlow = $('btnEngineFlow');
  const engineActiveBadge = $('engineActiveBadge');
  const clusterStateText = $('clusterStateText');
  const clusterProfileName = $('clusterProfileName');
  const flowSubmodesWrap = $('flowSubmodesWrap');
  const flowSubmodeBtnRow = $('flowSubmodeBtnRow');
  const flowInitFrameSlot = $('flowInitFrameSlot');
  const flowInitFrameInput = $('flowInitFrameInput');
  const flowInitFramePreview = $('flowInitFramePreview');
  const flowInitFrameImg = $('flowInitFrameImg');
  const flowInitFrameRemoveBtn = $('flowInitFrameRemoveBtn');
  const aspectBtnGroup = $('aspectBtnGroup');

  // Box 2: Character Consistency
  const charToggle = $('charToggle');
  const charPromptText = $('charPromptText');
  const charInputFile = $('charInputFile');
  const charPreviewBox = $('charPreviewBox');
  const charPreviewImg = $('charPreviewImg');
  const charRemoveBtn = $('charRemoveBtn');

  // Box 3: Style Consistency
  const styleToggle = $('styleToggle');
  const stylePromptText = $('stylePromptText');
  const styleInputFile = $('styleInputFile');
  const stylePreviewBox = $('stylePreviewBox');
  const stylePreviewImg = $('stylePreviewImg');
  const styleRemoveBtn = $('styleRemoveBtn');

  // Box 4: Negative Prompts
  const negativeChipsContainer = $('negativeChipsContainer');
  const negActiveCount = $('negActiveCount');
  const customNegativeInput = $('customNegativeInput');

  // Box 5: Timeline Prompts
  const autoSyncBtn = $('autoSyncBtn');
  const loadSampleScriptBtn = $('loadSampleScriptBtn');
  const promptCountBadge = $('promptCountBadge');
  const promptsTextarea = $('promptsTextarea');
  const generateBatchBtn = $('generateBatchBtn');
  const generateBtnText = $('generateBtnText');
  const stopBatchBtn = $('stopBatchBtn');
  const downloadZipBtn = $('downloadZipBtn');

  // Gallery Toolbar & Grid
  const galleryReadyPill = $('galleryReadyPill');
  const galleryTimelineHint = $('galleryTimelineHint');
  const progressBarWrap = $('progressBarWrap');
  const progressBarFill = $('progressBarFill');
  const clearGalleryBtn = $('clearGalleryBtn');
  const downloadZipTopBtn = $('downloadZipTopBtn');
  const pushTimelineBtn = $('pushTimelineBtn');
  const thumbnailGrid = $('thumbnailGrid');
  const dummyContinuationRow = $('dummyContinuationRow');

  // Lightbox Modal
  const lightboxModal = $('lightboxModal');
  const closeLightboxBtn = $('closeLightboxBtn');
  const lightboxImg = $('lightboxImg');
  const lightboxVideo = $('lightboxVideo');
  const lightboxTitle = $('lightboxTitle');
  const lightboxPromptText = $('lightboxPromptText');
  const lightboxDownloadBtn = $('lightboxDownloadBtn');
  const lightboxAnimateBtn = $('lightboxAnimateBtn');
  let currentLightboxItem = null;

  // Session Info Modal
  const sessionInfoModal = $('sessionInfoModal');
  const closeSessionModalBtn = $('closeSessionModalBtn');
  const infoGeminiState = $('infoGeminiState');
  const infoFlowState = $('infoFlowState');

  // Toast
  const toastCapsule = $('toastCapsule');
  const toastText = $('toastText');

  function showToast(msg, duration = 3000) {
    if (!toastCapsule || !toastText) return;
    toastText.textContent = msg;
    toastCapsule.classList.add('show');
    setTimeout(() => toastCapsule.classList.remove('show'), duration);
  }

  // Enforce Real Chrome Extension Context (No localhost illusion)
  const isExtensionContext = Boolean(window.chrome && chrome.runtime && chrome.runtime.id);
  document.documentElement.style.scrollBehavior = 'smooth';
  if (!isExtensionContext) {
    document.querySelectorAll('#localhostAlertBanner, .extension-context-banner').forEach(el => {
      el.style.display = 'flex';
    });
  }

  // ================= 1. MV3 Keep-Alive Port & Heartbeat =================
  let keepAlivePort = null;
  let heartbeatTimer = null;

  function startKeepAlive() {
    if (keepAlivePort) return;
    if (!isExtensionContext || !chrome.runtime.connect) return;

    try {
      keepAlivePort = chrome.runtime.connect({ name: 'renderx_keepalive' });
      console.log('[RenderX] KeepAlive long-lived port connected');

      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        setTimeout(startKeepAlive, 1000);
      });

      keepAlivePort.onMessage.addListener((msg) => {
        handleIncomingMessage(msg);
      });

      // 20s heartbeat ping to keep MV3 service worker active
      heartbeatTimer = setInterval(() => {
        if (keepAlivePort) {
          try {
            keepAlivePort.postMessage({ type: 'HEARTBEAT', timestamp: Date.now() });
          } catch (e) {}
        }
      }, 20000);
    } catch (e) {
      console.warn('[RenderX] KeepAlive connection note:', e);
    }
  }

  if (isExtensionContext) {
    startKeepAlive();
  }

  function stopKeepAlive() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (keepAlivePort) {
      try { keepAlivePort.disconnect(); } catch (e) {}
      keepAlivePort = null;
    }
  }

  // ================= 2. Dual Engine Switching =================
  function setEngine(engine) {
    state.engine = engine;

    if (engine === 'google-flow') {
      if (btnEngineCanvas) btnEngineCanvas.classList.remove('active');
      if (btnEngineFlow) btnEngineFlow.classList.add('active');
      if (engineActiveBadge) engineActiveBadge.textContent = 'FLOW';
      if (flowSubmodesWrap) flowSubmodesWrap.style.display = 'flex';
      if (sessionStatusText) sessionStatusText.textContent = 'Google Flow Active Session';
      if (clusterProfileName) clusterProfileName.textContent = 'Google Flow Account Session';
      updateGenerateButtonText();
      showToast('Switched to Google Flow Pipeline (Video & Images)');
    } else {
      if (btnEngineFlow) btnEngineFlow.classList.remove('active');
      if (btnEngineCanvas) btnEngineCanvas.classList.add('active');
      if (engineActiveBadge) engineActiveBadge.textContent = 'CANVAS';
      if (flowSubmodesWrap) flowSubmodesWrap.style.display = 'none';
      if (sessionStatusText) sessionStatusText.textContent = 'Gemini Canvas (Free Google Session)';
      if (clusterProfileName) clusterProfileName.textContent = 'Google Active Session (Zero API Key)';
      updateGenerateButtonText();
      showToast('Switched to Gemini Canvas Pipeline');
    }
  }

  if (btnEngineCanvas) btnEngineCanvas.addEventListener('click', () => setEngine('gemini-canvas'));
  if (btnEngineFlow) btnEngineFlow.addEventListener('click', () => setEngine('google-flow'));

  // Flow Sub-Modes
  if (flowSubmodeBtnRow) {
    flowSubmodeBtnRow.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-submode-opt');
      if (!btn) return;

      flowSubmodeBtnRow.querySelectorAll('.btn-submode-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.subMode = btn.dataset.submode;
      if (flowInitFrameSlot) {
        flowInitFrameSlot.style.display = (state.subMode === 'image-to-video') ? 'flex' : 'none';
      }
      updateGenerateButtonText();
      showToast(`Flow Mode: ${btn.textContent.trim()}`);
    });
  }

  // Flow Reference Frame Upload
  if (flowInitFrameInput) {
    flowInitFrameInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.flowReferenceImage = ev.target.result;
        if (flowInitFrameImg) flowInitFrameImg.src = ev.target.result;
        if (flowInitFramePreview) flowInitFramePreview.style.display = 'flex';
        showToast('Initial frame attached for Flow Video');
      };
      reader.readAsDataURL(file);
    });
  }

  if (flowInitFrameRemoveBtn) {
    flowInitFrameRemoveBtn.addEventListener('click', () => {
      state.flowReferenceImage = null;
      if (flowInitFrameInput) flowInitFrameInput.value = '';
      if (flowInitFramePreview) flowInitFramePreview.style.display = 'none';
    });
  }

  // Dock Info Button
  if (btnSidePanelInfo) {
    btnSidePanelInfo.addEventListener('click', () => {
      showToast('RenderX runs in 70vw In-Browser Dock (Zero Extra Tabs)');
    });
  }

  function applySyncStatusUI(geminiConnected, flowConnected) {
    if (sessionDot) {
      sessionDot.className = (geminiConnected || flowConnected) ? 'dot' : 'dot amber';
    }
    if (clusterStateText) {
      clusterStateText.textContent = (geminiConnected || flowConnected) ? '🟢 RPC Synced (Zero-Tab)' : '🟡 Standby (Needs Sync)';
    }
    if (infoGeminiState) infoGeminiState.textContent = geminiConnected ? 'Synced (q4uTj Direct RPC)' : 'Open Canvas Share Once to Sync';
    if (infoFlowState) infoFlowState.textContent = flowConnected ? 'Synced (Bearer Token Ready)' : 'Open Flow Once to Sync';
  }

  // Session & Status Check
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (res) => {
      if (res && res.success) {
        applySyncStatusUI(res.geminiConnected, res.flowConnected);
      }
    });

    // Restore Persisted Queue State if SW was restarted
    chrome.runtime.sendMessage({ type: 'GET_PERSISTED_QUEUE' }, (res) => {
      if (res && res.success && res.queue && res.queue.items && res.queue.items.length > 0) {
        const q = res.queue;
        if (q.isQueueRunning) {
          state.items = q.items;
          state.isGenerating = true;
          state.engine = q.currentEngine || 'gemini-canvas';
          state.subMode = q.currentSubMode || 'image';
          renderLiveGrid(state.items);

          state.items.forEach(i => {
            if (i.status === 'done' && i.dataUrl) {
              updateCardCompleted(i);
            } else if (i.status === 'failed') {
              updateCardFailed(i.index, i.error || 'Failed');
            } else if (i.index === q.currentShotIndex) {
              updateCardStatus(i.index, 'Generating...');
            }
          });

          updateOverallProgress();
          startKeepAlive();
          if (generateBatchBtn) generateBatchBtn.disabled = true;
          if (stopBatchBtn) stopBatchBtn.disabled = false;
          showToast('Resumed active queue from local storage');
        }
      }
    });
  }

  // ================= 3. Aspect Ratio Selection =================
  if (aspectBtnGroup) {
    aspectBtnGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-aspect');
      if (!btn) return;

      aspectBtnGroup.querySelectorAll('.btn-aspect').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.aspectRatio = btn.dataset.aspect;

      // Update previews in gallery
      const aspectClass = `aspect-${state.aspectRatio === '1:1' ? 'square' : (state.aspectRatio === '16:9' ? 'landscape' : 'portrait')}`;
      document.querySelectorAll('.card-preview').forEach(box => {
        box.className = `card-preview ${aspectClass}`;
      });

      showToast(`Aspect set to ${btn.dataset.label}`);
    });
  }

  // ================= 4. Character & Style Reference Uploads =================
  function setupUploadHandler(fileInput, thumbBox, imgEl, removeBtn, stateKey, toastLabel) {
    if (!fileInput || !imgEl) return;

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        state[stateKey] = ev.target.result;
        imgEl.src = ev.target.result;
        if (thumbBox) thumbBox.style.display = 'flex';
        showToast(`${toastLabel} image attached`);
      };
      reader.readAsDataURL(file);
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        state[stateKey] = null;
        fileInput.value = '';
        if (thumbBox) thumbBox.style.display = 'none';
        imgEl.src = '';
      });
    }
  }

  setupUploadHandler(charInputFile, charPreviewBox, charPreviewImg, charRemoveBtn, 'charImageBase64', 'Character');
  setupUploadHandler(styleInputFile, stylePreviewBox, stylePreviewImg, styleRemoveBtn, 'styleImageBase64', 'Style');

  // ================= 5. Negative Prompts Chips =================
  function updateNegativeCount() {
    if (!negativeChipsContainer || !negActiveCount) return;
    const activeChips = negativeChipsContainer.querySelectorAll('.chip-tag.active');
    negActiveCount.textContent = `${activeChips.length} ACTIVE`;
  }

  if (negativeChipsContainer) {
    negativeChipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-tag');
      if (!chip) return;
      chip.classList.toggle('active');
      updateNegativeCount();
    });
  }

  function getCombinedNegativePrompt() {
    const activeTags = [];
    if (negativeChipsContainer) {
      negativeChipsContainer.querySelectorAll('.chip-tag.active').forEach(c => {
        activeTags.push(c.dataset.tag || c.textContent.trim().toLowerCase());
      });
    }
    if (customNegativeInput && customNegativeInput.value.trim()) {
      activeTags.push(customNegativeInput.value.trim());
    }
    return activeTags.join(', ');
  }

  // ================= 6. Timeline Prompts & Parsing =================
  function parsePromptLines(text) {
    if (!text) return [];
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map((line, idx) => {
        let timestamp = `00.${String(idx * 4).padStart(2, '0')}-00.${String((idx + 1) * 4).padStart(2, '0')}`;
        let cleanPrompt = line;

        // Extract [00.00 - 04.35] | Scene X: ... OR [00.00 - 04.35] Scene X: ... OR 00.00-04.35 | ...
        const bracketPipeMatch = line.match(/^\[([0-9.:\-\s]+)\]\s*\|\s*(.+)$/);
        const bracketMatch = line.match(/^\[([0-9.:\-\s]+)\]\s*(.+)$/);
        const pipeMatch = line.match(/^([0-9.:\-\s]+)\s*\|\s*(.+)$/);

        if (bracketPipeMatch) {
          timestamp = bracketPipeMatch[1].trim();
          cleanPrompt = bracketPipeMatch[2].trim();
        } else if (bracketMatch) {
          timestamp = bracketMatch[1].trim();
          cleanPrompt = bracketMatch[2].trim();
        } else if (pipeMatch) {
          timestamp = pipeMatch[1].trim();
          cleanPrompt = pipeMatch[2].trim();
        }

        const compactTs = timestamp.replace(/\s+/g, '');
        return {
          index: idx + 1,
          timestamp: timestamp,
          cleanTimestamp: compactTs.replace(/[^a-zA-Z0-9.-]/g, '_'),
          rawPrompt: cleanPrompt
        };
      });
  }

  function updatePromptCount() {
    const raw = promptsTextarea ? promptsTextarea.value : '';
    const parsed = parsePromptLines(raw);
    const count = parsed.length;

    if (promptCountBadge) promptCountBadge.textContent = count;
    updateGenerateButtonText(count);
  }

  function updateGenerateButtonText(countOverride) {
    if (!generateBtnText) return;
    const count = (typeof countOverride === 'number') ? countOverride : parsePromptLines(promptsTextarea ? promptsTextarea.value : '').length;
    const isVideo = (state.engine === 'google-flow' && state.subMode.includes('video'));
    const typeLabel = isVideo ? 'Videos' : 'Images';

    if (count > 0) {
      generateBtnText.textContent = `⚡ Generate ${count} ${typeLabel}`;
    } else {
      generateBtnText.textContent = `⚡ Generate ${typeLabel}`;
    }
  }

  if (promptsTextarea) {
    promptsTextarea.addEventListener('input', updatePromptCount);
  }

  if (loadSampleScriptBtn && promptsTextarea) {
    loadSampleScriptBtn.addEventListener('click', () => {
      const sample = `00.00-04.35 | Scene 1: Medium Action Shot, subject in dynamic motion, 35mm shallow depth of field
04.35-07.83 | Scene 2: Cinematic Close-Up detail shot, high emotional tension, soft volumetric lighting
07.83-11.74 | Scene 3: Extreme Wide Establishing Angle, sweeping cinematic horizon, atmospheric haze
11.74-16.52 | Scene 4: Over-The-Shoulder narrative framing, award-winning cinematography, soft bokeh
16.52-22.94 | Scene 5: Golden hour dramatic sunset with volumetric rim light`;

      promptsTextarea.value = sample;
      updatePromptCount();
      showToast('Loaded 5 sample timeline scenes');
    });
  }

  if (autoSyncBtn && promptsTextarea) {
    autoSyncBtn.addEventListener('click', () => {
      const lines = parsePromptLines(promptsTextarea.value);
      if (lines.length === 0) {
        showToast('No prompts to sync');
        return;
      }
      promptsTextarea.value = lines.map(l => `${l.timestamp} | ${l.rawPrompt}`).join('\n');
      updatePromptCount();
      showToast('Timestamps formatted cleanly');
    });
  }

  // ================= 7. Standby Grid & Continuation Arrow =================
  const standbyCardsHTML = `
    <!-- Row 1: Exactly 4 Default Standby Dummy Cards -->
    <div class="image-card dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 00.00 - 04.35</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="card-preview aspect-square">
        <div class="dummy-preview">
          <svg fill="currentColor" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
          <span>Shot #1 Ready</span>
        </div>
      </div>
      <div class="card-meta">
        <div class="card-fn-row"><span class="card-filename">📁 01_00.00-04.35.png</span><span class="card-idx">#01</span></div>
        <p class="card-prompt-text">Scene 1: Medium Action Shot, subject in dynamic motion, 35mm shallow depth of field...</p>
        <div class="card-actions-single-row">
          <button type="button" class="btn-card-action" data-action="edit" data-index="1">✏️ Edit</button>
          <button type="button" class="btn-card-action btn-regen" data-action="retry" data-index="1">🎲 Re-Roll</button>
          <button type="button" class="btn-card-action" data-action="save" data-index="1">💾 Save</button>
        </div>
        <div class="card-check-row">
          <label class="check-label"><input type="checkbox" checked> Final Cut</label>
          <label class="check-label"><input type="checkbox"> Auto Merge</label>
        </div>
      </div>
    </div>

    <div class="image-card dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 04.35 - 07.83</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="card-preview aspect-square">
        <div class="dummy-preview">
          <svg fill="currentColor" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
          <span>Shot #2 Ready</span>
        </div>
      </div>
      <div class="card-meta">
        <div class="card-fn-row"><span class="card-filename">📁 02_04.35-07.83.png</span><span class="card-idx">#02</span></div>
        <p class="card-prompt-text">Scene 2: Cinematic Close-Up detail shot, high emotional tension, soft volumetric lighting...</p>
        <div class="card-actions-single-row">
          <button type="button" class="btn-card-action" data-action="edit" data-index="2">✏️ Edit</button>
          <button type="button" class="btn-card-action btn-regen" data-action="retry" data-index="2">🎲 Re-Roll</button>
          <button type="button" class="btn-card-action" data-action="save" data-index="2">💾 Save</button>
        </div>
        <div class="card-check-row">
          <label class="check-label"><input type="checkbox" checked> Final Cut</label>
          <label class="check-label"><input type="checkbox"> Auto Merge</label>
        </div>
      </div>
    </div>

    <div class="image-card dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 07.83 - 11.74</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="card-preview aspect-square">
        <div class="dummy-preview">
          <svg fill="currentColor" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
          <span>Shot #3 Ready</span>
        </div>
      </div>
      <div class="card-meta">
        <div class="card-fn-row"><span class="card-filename">📁 03_07.83-11.74.png</span><span class="card-idx">#03</span></div>
        <p class="card-prompt-text">Scene 3: Extreme Wide Establishing Angle, sweeping cinematic horizon, atmospheric haze...</p>
        <div class="card-actions-single-row">
          <button type="button" class="btn-card-action" data-action="edit" data-index="3">✏️ Edit</button>
          <button type="button" class="btn-card-action btn-regen" data-action="retry" data-index="3">🎲 Re-Roll</button>
          <button type="button" class="btn-card-action" data-action="save" data-index="3">💾 Save</button>
        </div>
        <div class="card-check-row">
          <label class="check-label"><input type="checkbox" checked> Final Cut</label>
          <label class="check-label"><input type="checkbox"> Auto Merge</label>
        </div>
      </div>
    </div>

    <div class="image-card dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 11.74 - 16.52</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="card-preview aspect-square">
        <div class="dummy-preview">
          <svg fill="currentColor" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
          <span>Shot #4 Ready</span>
        </div>
      </div>
      <div class="card-meta">
        <div class="card-fn-row"><span class="card-filename">📁 04_11.74-16.52.png</span><span class="card-idx">#04</span></div>
        <p class="card-prompt-text">Scene 4: Over-The-Shoulder narrative framing, award-winning cinematography, soft bokeh...</p>
        <div class="card-actions-single-row">
          <button type="button" class="btn-card-action" data-action="edit" data-index="4">✏️ Edit</button>
          <button type="button" class="btn-card-action btn-regen" data-action="retry" data-index="4">🎲 Re-Roll</button>
          <button type="button" class="btn-card-action" data-action="save" data-index="4">💾 Save</button>
        </div>
        <div class="card-check-row">
          <label class="check-label"><input type="checkbox" checked> Final Cut</label>
          <label class="check-label"><input type="checkbox"> Auto Merge</label>
        </div>
      </div>
    </div>

    <!-- Prominent Centered Circular Down Arrow (Row 2 Continuation Indicator) -->
    <div class="dummy-continuation-row" id="dummyContinuationRow">
      <div class="dummy-arrow-circle">↓</div>
      <div class="dummy-continuation-text">Standby: Images will populate dynamically in 4-column rows upon generation</div>
    </div>
  `;

  function resetGalleryToStandby() {
    state.items = [];
    if (thumbnailGrid) thumbnailGrid.innerHTML = standbyCardsHTML;
    if (galleryReadyPill) galleryReadyPill.textContent = '0 READY (STANDBY GRID)';
    if (progressBarWrap) progressBarWrap.style.display = 'none';
    if (progressBarFill) progressBarFill.style.width = '0%';
    if (downloadZipBtn) downloadZipBtn.disabled = true;
    if (downloadZipTopBtn) downloadZipTopBtn.disabled = true;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CLEAR_PERSISTED_QUEUE' });
    }
  }

  if (clearGalleryBtn) {
    clearGalleryBtn.addEventListener('click', () => {
      resetGalleryToStandby();
      showToast('Gallery reset to standby grid');
    });
  }

  if (globalResetBtn) {
    globalResetBtn.addEventListener('click', () => {
      if (confirm('Reset RenderX Studio? This clears all prompts and gallery shots.')) {
        if (promptsTextarea) promptsTextarea.value = '';
        updatePromptCount();
        resetGalleryToStandby();
        showToast('Workspace reset');
      }
    });
  }

  // ================= 8. Live 4-Column Grid Rendering =================
  function renderLiveGrid(items) {
    if (!thumbnailGrid) return;
    thumbnailGrid.innerHTML = '';

    const isVideo = (state.engine === 'google-flow' && state.subMode.includes('video'));
    const ext = isVideo ? 'mp4' : 'png';
    const aspectClass = `aspect-${state.aspectRatio === '1:1' ? 'square' : (state.aspectRatio === '16:9' ? 'landscape' : 'portrait')}`;

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.id = `card-${item.index}`;

      const paddedIdx = String(item.index).padStart(2, '0');
      const filename = `${paddedIdx}_${item.cleanTimestamp}.${ext}`;
      item.filename = filename;

      card.innerHTML = `
        <div class="card-header-bar">
          <span class="timestamp-badge">🛡️ ${item.timestamp}</span>
          <span class="badge-generating" id="badge-${item.index}">Generating...</span>
        </div>
        <div class="card-preview ${aspectClass}" id="previewBox-${item.index}">
          <div class="card-spinner" id="spinner-${item.index}">
            <div class="spin-circle"></div>
            <span style="font-size:8.5px; color:var(--text-dim);" id="spinnerText-${item.index}">Generating...</span>
          </div>
        </div>
        <div class="card-meta">
          <div class="card-fn-row">
            <span class="card-filename">📁 ${filename}</span>
            <span class="card-idx">#${paddedIdx}</span>
          </div>
          <p class="card-prompt-text" title="${item.rawPrompt}">${item.rawPrompt}</p>
          <div class="card-actions-single-row">
            <button type="button" class="btn-card-action" data-action="edit" data-index="${item.index}">✏️ Edit</button>
            <button type="button" class="btn-card-action btn-regen" data-action="retry" data-index="${item.index}">🎲 Re-Roll</button>
            <button type="button" class="btn-card-action" data-action="save" data-index="${item.index}">💾 Save</button>
            ${!isVideo ? `<button type="button" class="btn-card-action btn-flow" data-action="animate" data-index="${item.index}" title="Animate in Flow">🌊 Flow</button>` : ''}
          </div>
          <div class="card-check-row">
            <label class="check-label"><input type="checkbox" checked> Final Cut</label>
            <label class="check-label"><input type="checkbox"> Auto Merge</label>
          </div>
        </div>
      `;

      thumbnailGrid.appendChild(card);
    });
  }

  function updateCardStatus(index, statusText) {
    const textEl = document.getElementById(`spinnerText-${index}`);
    if (textEl) textEl.textContent = statusText;
    const badge = document.getElementById(`badge-${index}`);
    if (badge) {
      badge.className = 'badge-generating';
      badge.textContent = statusText.includes('Attempt') ? statusText : 'Generating...';
    }
  }

  function updateCardCompleted(item) {
    const previewBox = document.getElementById(`previewBox-${item.index}`);
    const badge = document.getElementById(`badge-${item.index}`);
    if (!previewBox) return;

    if (badge) {
      badge.className = 'badge-done';
      badge.textContent = 'Ready';
    }

    previewBox.innerHTML = '';

    if (item.mediaType === 'video') {
      const video = document.createElement('video');
      video.src = item.dataUrl;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.onclick = () => openLightbox(item);
      previewBox.appendChild(video);

      const pill = document.createElement('span');
      pill.className = 'video-label-badge';
      pill.textContent = '🎬 VIDEO';
      previewBox.appendChild(pill);
    } else {
      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.rawPrompt;
      img.onclick = () => openLightbox(item);
      previewBox.appendChild(img);
    }
  }

  function updateCardFailed(index, errorMsg) {
    const previewBox = document.getElementById(`previewBox-${index}`);
    const badge = document.getElementById(`badge-${index}`);
    if (!previewBox) return;

    if (badge) {
      badge.className = 'badge-standby';
      badge.textContent = 'Failed';
      badge.style.color = '#EF4444';
      badge.style.borderColor = '#EF4444';
    }

    previewBox.innerHTML = `
      <div style="padding:10px; text-align:center; display:flex; flex-direction:column; gap:4px;">
        <span style="color:#F87171; font-weight:800; font-size:9.5px;">Shot Failed</span>
        <span style="font-size:8px; color:var(--text-dim); line-height:1.2;">${errorMsg}</span>
      </div>
    `;
  }

  // ================= 9. Batch Queue Execution =================
  window.triggerGenerateBatch = async function () {
    if (!isExtensionContext) {
      showToast('Please open RenderX via the Chrome Extension icon, not localhost.', 4000);
      return;
    }

    if (state.isGenerating) {
      showToast('Generation already in progress');
      return;
    }

    const raw = promptsTextarea ? promptsTextarea.value.trim() : '';
    if (!raw) {
      showToast('Please enter prompts in Box 5');
      if (promptsTextarea) promptsTextarea.focus();
      return;
    }

    const parsed = parsePromptLines(raw);
    if (parsed.length === 0) {
      showToast('No valid prompts detected');
      return;
    }

    const negPrompt = getCombinedNegativePrompt();
    const charPrompt = (charToggle && charToggle.checked && charPromptText) ? charPromptText.value.trim() : '';
    const stylePrompt = (styleToggle && styleToggle.checked && stylePromptText) ? stylePromptText.value.trim() : '';

    state.items = parsed.map(p => {
      let finalPrompt = p.rawPrompt;
      if (charPrompt) finalPrompt = `${charPrompt}, ${finalPrompt}`;
      if (stylePrompt) finalPrompt = `${finalPrompt}, in the style of ${stylePrompt}`;
      if (negPrompt) finalPrompt = `${finalPrompt} --no ${negPrompt}`;

      return {
        ...p,
        fullPrompt: finalPrompt,
        aspectRatio: state.aspectRatio,
        dataUrl: null,
        status: 'generating',
        mediaType: (state.engine === 'google-flow' && state.subMode.includes('video')) ? 'video' : 'image',
        referenceImage: state.flowReferenceImage || state.charImageBase64
      };
    });

    state.isGenerating = true;
    if (generateBatchBtn) generateBatchBtn.disabled = true;
    if (stopBatchBtn) stopBatchBtn.disabled = false;
    if (progressBarWrap) progressBarWrap.style.display = 'block';
    if (progressBarFill) progressBarFill.style.width = '0%';
    if (galleryReadyPill) galleryReadyPill.textContent = `0 / ${state.items.length} READY (GENERATING...)`;

    // Immediately render all N spinning cards simultaneously
    renderLiveGrid(state.items);
    startKeepAlive();
    showToast(`Dispatching ${state.items.length} shots via Zero-Tab Direct ${state.engine === 'google-flow' ? 'Google Flow' : 'Gemini Canvas'} Engine...`, 2800);

    // Send queue to background service worker
    chrome.runtime.sendMessage({
      type: 'START_BATCH_QUEUE',
      items: state.items,
      engine: state.engine,
      subMode: state.subMode
    });
  };

  if (generateBatchBtn) {
    generateBatchBtn.addEventListener('click', window.triggerGenerateBatch);
  }

  if (stopBatchBtn) {
    stopBatchBtn.addEventListener('click', () => {
      if (isExtensionContext && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'STOP_BATCH_QUEUE' });
      }
      state.isGenerating = false;
      if (generateBatchBtn) generateBatchBtn.disabled = false;
      if (stopBatchBtn) stopBatchBtn.disabled = true;
      showToast('Generation halted');
    });
  }

  // Receive Background Messages (via Runtime & Ports)
  function handleIncomingMessage(msg) {
    if (!msg) return;

    if (msg.type === 'ITEM_STATUS_UPDATE' || msg.type === 'ITEM_STATUS') {
      const item = state.items.find(i => i.index === msg.index);
      if (item && item.status !== 'done') {
        updateCardStatus(msg.index, msg.status);
      }
    } else if (msg.type === 'ITEM_STARTED') {
      const item = state.items.find(i => i.index === msg.index);
      if (item && item.status !== 'done') {
        updateCardStatus(msg.index, 'Generating...');
      }
    } else if (msg.type === 'ITEM_COMPLETED') {
      const item = state.items.find(i => i.index === msg.index);
      if (item) {
        if (item.status === 'done' && item.dataUrl) return;
        item.dataUrl = msg.dataUrl;
        item.status = 'done';
        if (msg.mediaType) item.mediaType = msg.mediaType;
        updateCardCompleted(item);
      }
      updateOverallProgress();
    } else if (msg.type === 'ITEM_FAILED') {
      const item = state.items.find(i => i.index === msg.index);
      if (item) {
        if (item.status === 'done') return;
        item.status = 'failed';
      }
      updateCardFailed(msg.index, msg.error || 'Automation timeout');
      updateOverallProgress();
    } else if (msg.type === 'SYNC_STATUS_UPDATED') {
      applySyncStatusUI(msg.geminiSynced, msg.flowSynced);
      showToast('Session RPC protocol synced (Zero-Tab Ready!)');
    } else if (msg.type === 'QUEUE_FINISHED') {
      finishQueue();
    }
  }

  if (isExtensionContext && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      handleIncomingMessage(msg);
    });
  }

  function updateOverallProgress() {
    const total = state.items.length;
    if (total === 0) return;
    const completed = state.items.filter(i => i.status === 'done').length;
    const pct = Math.round((completed / total) * 100);

    if (progressBarFill) progressBarFill.style.width = `${pct}%`;
    if (completed > 0) {
      if (downloadZipBtn) downloadZipBtn.disabled = false;
      if (downloadZipTopBtn) downloadZipTopBtn.disabled = false;
    }
    if (galleryReadyPill) {
      galleryReadyPill.textContent = (state.isGenerating && completed < total)
        ? `${completed} / ${total} READY (GENERATING...)`
        : `${completed} / ${total} READY (LIVE)`;
    }
  }

  function finishQueue() {
    state.isGenerating = false;
    if (generateBatchBtn) generateBatchBtn.disabled = false;
    if (stopBatchBtn) stopBatchBtn.disabled = true;

    const completed = state.items.filter(i => i.status === 'done').length;
    if (completed > 0) {
      if (downloadZipBtn) downloadZipBtn.disabled = false;
      if (downloadZipTopBtn) downloadZipTopBtn.disabled = false;
    }
    updateOverallProgress();
    showToast(`Batch completed: ${completed} shots ready`);
  }

  // ================= 11. Individual Card Tool Actions =================
  if (thumbnailGrid) {
    thumbnailGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-card-action');
      if (!btn) return;

      const action = btn.dataset.action;
      const index = parseInt(btn.dataset.index, 10);
      const item = state.items.find(i => i.index === index);

      if (action === 'save') {
        if (item && item.dataUrl) {
          downloadDataUrl(item.dataUrl, item.filename || `shot_${index}.png`);
        } else {
          showToast(`Shot #${index} not yet ready to save`);
        }
      } else if (action === 'retry') {
        if (!isExtensionContext) {
          showToast('Please open RenderX via the Chrome Extension icon, not localhost.');
          return;
        }
        if (item) {
          showToast(`Re-rolling Shot #${index}...`);
          item.status = 'generating';
          item.dataUrl = null;
          const previewBox = document.getElementById(`previewBox-${index}`);
          if (previewBox) {
            previewBox.innerHTML = `
              <div class="card-spinner" id="spinner-${index}">
                <div class="spin-circle"></div>
                <span style="font-size:8.5px; color:var(--text-dim);" id="spinnerText-${index}">Retrying...</span>
              </div>
            `;
          }
          updateCardStatus(index, 'Retrying...');
          startKeepAlive();
          chrome.runtime.sendMessage({
            type: 'START_BATCH_QUEUE',
            items: [item],
            engine: state.engine,
            subMode: state.subMode
          });
        }
      } else if (action === 'animate') {
        if (item && item.dataUrl) {
          setEngine('google-flow');
          state.subMode = 'image-to-video';
          state.flowReferenceImage = item.dataUrl;

          if (flowSubmodeBtnRow) {
            flowSubmodeBtnRow.querySelectorAll('.btn-submode-opt').forEach(b => {
              b.classList.toggle('active', b.dataset.submode === 'image-to-video');
            });
          }
          if (flowInitFrameSlot) flowInitFrameSlot.style.display = 'flex';
          if (flowInitFrameImg) flowInitFrameImg.src = item.dataUrl;
          if (flowInitFramePreview) flowInitFramePreview.style.display = 'flex';

          window.scrollTo({ top: 0, behavior: 'smooth' });
          showToast(`Shot #${index} transferred to Google Flow Image-to-Video!`, 3500);
        } else {
          showToast('Image must finish generating before animating');
        }
      } else if (action === 'edit') {
        if (item) {
          const newPrompt = prompt(`Edit prompt for Shot #${index}:`, item.rawPrompt);
          if (newPrompt && newPrompt !== item.rawPrompt) {
            item.rawPrompt = newPrompt;
            const snip = document.querySelector(`#card-${index} .card-prompt-text`);
            if (snip) snip.textContent = newPrompt;
            showToast(`Shot #${index} prompt updated`);
          }
        }
      }
    });
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ================= 12. Multi-Format Sequential ZIP Exporter =================
  async function downloadBatchZip() {
    const readyItems = state.items.filter(i => i.status === 'done' && i.dataUrl);
    if (readyItems.length === 0) {
      showToast('No rendered media ready to download');
      return;
    }

    if (typeof JSZip === 'undefined') {
      showToast('Loading ZIP engine...');
      return;
    }

    showToast(`Bundling ${readyItems.length} files into ZIP archive...`);
    const zip = new JSZip();

    // Add Timeline Metadata CSV
    let csvContent = 'Index,Timestamp,Filename,MediaType,Prompt\n';

    readyItems.forEach(item => {
      const ext = item.mediaType === 'video' ? 'mp4' : 'png';
      const cleanFn = item.filename || `shot_${item.index}.${ext}`;
      const safePrompt = `"${item.rawPrompt.replace(/"/g, '""')}"`;
      csvContent += `${item.index},${item.timestamp},${cleanFn},${item.mediaType},${safePrompt}\n`;

      if (item.dataUrl.startsWith('data:')) {
        const b64Data = item.dataUrl.split(',')[1];
        zip.file(cleanFn, b64Data, { base64: true });
      } else {
        zip.file(cleanFn, item.dataUrl);
      }
    });

    zip.file('timeline_metadata.csv', csvContent);

    const blob = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const zipName = `RenderX_Studio_Shots_${dateStr}.zip`;

    downloadDataUrl(blobUrl, zipName);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    showToast(`Downloaded ${zipName}`);
  }

  if (downloadZipBtn) downloadZipBtn.addEventListener('click', downloadBatchZip);
  if (downloadZipTopBtn) downloadZipTopBtn.addEventListener('click', downloadBatchZip);

  if (pushTimelineBtn) {
    pushTimelineBtn.addEventListener('click', () => {
      showToast('Exporting shots to Video Production Timeline...');
      downloadBatchZip();
    });
  }

  // ================= 13. Lightbox Modal =================
  function openLightbox(item) {
    currentLightboxItem = item;
    if (!lightboxModal) return;

    if (lightboxTitle) lightboxTitle.textContent = `${item.filename || 'Shot'} (${item.timestamp})`;
    if (lightboxPromptText) lightboxPromptText.textContent = item.rawPrompt;

    if (item.mediaType === 'video') {
      if (lightboxImg) lightboxImg.style.display = 'none';
      if (lightboxVideo) {
        lightboxVideo.style.display = 'block';
        lightboxVideo.src = item.dataUrl;
      }
      if (lightboxAnimateBtn) lightboxAnimateBtn.style.display = 'none';
    } else {
      if (lightboxVideo) lightboxVideo.style.display = 'none';
      if (lightboxImg) {
        lightboxImg.style.display = 'block';
        lightboxImg.src = item.dataUrl;
      }
      if (lightboxAnimateBtn) lightboxAnimateBtn.style.display = 'inline-block';
    }

    lightboxModal.classList.add('open');
  }

  if (closeLightboxBtn) {
    closeLightboxBtn.addEventListener('click', () => {
      if (lightboxModal) lightboxModal.classList.remove('open');
      if (lightboxVideo) lightboxVideo.pause();
    });
  }

  if (lightboxDownloadBtn) {
    lightboxDownloadBtn.addEventListener('click', () => {
      if (currentLightboxItem && currentLightboxItem.dataUrl) {
        downloadDataUrl(currentLightboxItem.dataUrl, currentLightboxItem.filename || 'renderx_shot.png');
      }
    });
  }

  if (lightboxAnimateBtn) {
    lightboxAnimateBtn.addEventListener('click', () => {
      if (currentLightboxItem && currentLightboxItem.dataUrl) {
        if (lightboxModal) lightboxModal.classList.remove('open');
        setEngine('google-flow');
        state.subMode = 'image-to-video';
        state.flowReferenceImage = currentLightboxItem.dataUrl;
        if (flowInitFrameSlot) flowInitFrameSlot.style.display = 'flex';
        if (flowInitFrameImg) flowInitFrameImg.src = currentLightboxItem.dataUrl;
        if (flowInitFramePreview) flowInitFramePreview.style.display = 'flex';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('Image ready in Google Flow Image-to-Video queue!');
      }
    });
  }

  // Session Info Modal
  if (sessionInfoBtn && sessionInfoModal) {
    sessionInfoBtn.addEventListener('click', () => sessionInfoModal.classList.add('open'));
  }
  if (closeSessionModalBtn && sessionInfoModal) {
    closeSessionModalBtn.addEventListener('click', () => sessionInfoModal.classList.remove('open'));
  }

  // Close modals on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
        if (lightboxVideo) lightboxVideo.pause();
      }
    });
  });

  // Initial call
  updatePromptCount();
  updateNegativeCount();
});
