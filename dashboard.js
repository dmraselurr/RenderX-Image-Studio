/**
 * RenderX Image Studio - Studio Dashboard Controller (v1.0.8 PRO)
 * Dual-Mode Account Studio (Gemini Canvas & Google Flow)
 * 4-Column Responsive Grid, 5-Box Left Sidebar & Multi-Format ZIP Packaging
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
  const btnArrangeSplit = $('btnArrangeSplit');
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

  // ================= 1. Dual Engine Switching =================
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

  // ================= 2. Split Screen Docking =================
  if (btnArrangeSplit) {
    btnArrangeSplit.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'ARRANGE_SPLIT_SCREEN' }, () => {
          showToast('Workspace arranged: Left 28% Google | Right 72% Studio', 3500);
        });
      } else {
        showToast('Running in standalone browser tab mode');
      }
    });
  }

  // Session & Status Check
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (res) => {
      if (res && res.success) {
        if (sessionDot) {
          sessionDot.className = (res.geminiConnected || res.flowConnected) ? 'dot' : 'dot amber';
        }
        if (clusterStateText) {
          clusterStateText.textContent = (res.geminiConnected || res.flowConnected) ? '🟢 Connected' : '🟡 Standby';
        }
        if (infoGeminiState) infoGeminiState.textContent = res.geminiConnected ? 'Connected (Active Tab)' : 'Ready (Auto-Launch)';
        if (infoFlowState) infoFlowState.textContent = res.flowConnected ? 'Connected (Active Tab)' : 'Ready (Auto-Launch)';
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
        let timestamp = `00.${String(idx * 4).padStart(2, '0')} - 00.${String((idx + 1) * 4).padStart(2, '0')}`;
        let cleanPrompt = line;

        // Extract explicit timestamp if present
        const match = line.match(/^([0-9.:\-\s]+)\s*\|\s*(.+)$/);
        if (match) {
          timestamp = match[1].trim();
          cleanPrompt = match[2].trim();
        }

        return {
          index: idx + 1,
          timestamp: timestamp,
          cleanTimestamp: timestamp.replace(/[^a-zA-Z0-9.-]/g, '_'),
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

      const filename = `0${item.index}_${item.cleanTimestamp}.${ext}`;
      item.filename = filename;

      card.innerHTML = `
        <div class="card-header-bar">
          <span class="timestamp-badge">🛡️ ${item.timestamp}</span>
          <span class="badge-standby" id="badge-${item.index}">Queued</span>
        </div>
        <div class="card-preview ${aspectClass}" id="previewBox-${item.index}">
          <div class="card-spinner" id="spinner-${item.index}">
            <div class="spin-circle"></div>
            <span style="font-size:8.5px; color:var(--text-dim);" id="spinnerText-${item.index}">Waiting in queue...</span>
          </div>
        </div>
        <div class="card-meta">
          <div class="card-fn-row">
            <span class="card-filename">📁 ${filename}</span>
            <span class="card-idx">#0${item.index}</span>
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
      badge.textContent = 'Generating...';
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
        dataUrl: null,
        status: 'pending',
        mediaType: (state.engine === 'google-flow' && state.subMode.includes('video')) ? 'video' : 'image',
        referenceImage: state.flowReferenceImage || state.charImageBase64
      };
    });

    state.isGenerating = true;
    if (generateBatchBtn) generateBatchBtn.disabled = true;
    if (stopBatchBtn) stopBatchBtn.disabled = false;
    if (progressBarWrap) progressBarWrap.style.display = 'block';
    if (progressBarFill) progressBarFill.style.width = '0%';

    renderLiveGrid(state.items);
    showToast(`Starting ${state.items.length} shots via ${state.engine === 'google-flow' ? 'Google Flow' : 'Gemini Canvas'}...`, 2500);

    // Send queue to background service worker
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'START_BATCH_QUEUE',
        items: state.items,
        engine: state.engine,
        subMode: state.subMode
      });
    } else {
      // Local fallback simulation when previewing standalone without Chrome extension context
      runLocalSimulation();
    }
  };

  if (generateBatchBtn) {
    generateBatchBtn.addEventListener('click', window.triggerGenerateBatch);
  }

  if (stopBatchBtn) {
    stopBatchBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'STOP_BATCH_QUEUE' });
      }
      state.isGenerating = false;
      if (generateBatchBtn) generateBatchBtn.disabled = false;
      if (stopBatchBtn) stopBatchBtn.disabled = true;
      showToast('Generation halted');
    });
  }

  // Receive Background Messages
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'ITEM_STATUS') {
        updateCardStatus(msg.index, msg.status);
      } else if (msg.type === 'ITEM_COMPLETED') {
        const item = state.items.find(i => i.index === msg.index);
        if (item) {
          item.dataUrl = msg.dataUrl;
          item.status = 'done';
          updateCardCompleted(item);
        }
        updateOverallProgress();
      } else if (msg.type === 'ITEM_FAILED') {
        updateCardFailed(msg.index, msg.error || 'Automation timeout');
        updateOverallProgress();
      } else if (msg.type === 'QUEUE_FINISHED') {
        finishQueue();
      }
    });
  }

  function updateOverallProgress() {
    const total = state.items.length;
    if (total === 0) return;
    const completed = state.items.filter(i => i.status === 'done').length;
    const pct = Math.round((completed / total) * 100);

    if (progressBarFill) progressBarFill.style.width = `${pct}%`;
    if (galleryReadyPill) galleryReadyPill.textContent = `${completed}/${total} READY (LIVE)`;
  }

  function finishQueue() {
    state.isGenerating = false;
    if (generateBatchBtn) generateBatchBtn.disabled = false;
    if (stopBatchBtn) stopBatchBtn.disabled = true;
    if (downloadZipBtn) downloadZipBtn.disabled = false;
    if (downloadZipTopBtn) downloadZipTopBtn.disabled = false;

    const completed = state.items.filter(i => i.status === 'done').length;
    showToast(`Batch completed: ${completed} shots ready`);
  }

  // ================= 10. Local Simulation (when tested standalone on localhost) =================
  function runLocalSimulation() {
    let currentIdx = 0;

    function processNext() {
      if (!state.isGenerating || currentIdx >= state.items.length) {
        finishQueue();
        return;
      }

      const item = state.items[currentIdx];
      updateCardStatus(item.index, 'Rendering canvas...');

      setTimeout(() => {
        // Generate SVG canvas test visual
        const canvas = document.createElement('canvas');
        canvas.width = (state.aspectRatio === '16:9') ? 854 : ((state.aspectRatio === '9:16') ? 480 : 640);
        canvas.height = (state.aspectRatio === '16:9') ? 480 : ((state.aspectRatio === '9:16') ? 854 : 640);
        const ctx = canvas.getContext('2d');

        // Draw gradient background
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, '#0F172A');
        grad.addColorStop(0.5, '#1E1B4B');
        grad.addColorStop(1, '#064E3B');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw title & metadata
        ctx.fillStyle = '#38BDF8';
        ctx.font = 'bold 24px Inter, sans-serif';
        ctx.fillText(`Shot #0${item.index}: ${item.timestamp}`, 30, 60);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '16px Inter, sans-serif';
        ctx.fillText(item.rawPrompt.substring(0, 50) + '...', 30, 100);

        ctx.fillStyle = '#10B981';
        ctx.font = '14px JetBrains Mono, monospace';
        ctx.fillText(`Engine: ${state.engine.toUpperCase()}`, 30, canvas.height - 40);

        item.dataUrl = canvas.toDataURL('image/png');
        item.status = 'done';
        updateCardCompleted(item);
        updateOverallProgress();

        currentIdx++;
        processNext();
      }, 1500);
    }

    processNext();
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
        showToast(`Re-rolling Shot #${index}...`);
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && item) {
          updateCardStatus(index, 'Retrying...');
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

          // Select submode pill
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
