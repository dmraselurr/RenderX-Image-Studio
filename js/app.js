/**
 * RenderX Image Studio - v1.0.5 PRO Application Controller
 * High-speed Bulk Image Generator with 4-Column Layout, 3-Button Cards & Resilient Canvas Engine
 * Always-Open Spacious Sidebar with Mouse Wheel Smooth Scrolling
 */

document.addEventListener('DOMContentLoaded', async () => {
  const GEMINI_CANVAS_URL = 'https://share.gemini.google/cTnZQ3bpoER7';

  // Application State
  const state = {
    items: [],
    isGenerating: false,
    shouldAbort: false,
    selectedEngine: 'gemini-canvas',
    autoFallback: true,
    aspectRatio: 'landscape',
    concurrency: 3,
    googleApiKey: '',
    charImageBase64: null,
    styleImageBase64: null,
    canvasTabId: null
  };

  // Safe DOM Element Selector
  const $ = (id) => document.getElementById(id);

  // DOM Elements - Navigation & Actions
  const activeEngineLabel = $('activeEngineLabel');
  const openSettingsBtn = $('openSettingsBtn');
  const closeSettingsBtn = $('closeSettingsBtn');
  const settingsModal = $('settingsModal');
  const globalResetBtn = $('globalResetBtn');
  const clearGalleryBtn = $('clearGalleryBtn');

  // DOM Elements - Settings Modal
  const settingGoogleKey = $('settingGoogleKey');
  const settingConcurrency = $('settingConcurrency');
  const saveSettingsBtn = $('saveSettingsBtn');

  // DOM Elements - Left Sidebar Controls
  const engineSelect = $('engineSelect');
  const canvasClusterStatus = $('canvasClusterStatus');
  const openCanvasTabBtn = $('openCanvasTabBtn');
  const refreshCanvasTabBtn = $('refreshCanvasTabBtn');
  const toggleCookieBtn = $('toggleCookieBtn');
  const cookieSubpanel = $('cookieSubpanel');
  const cookieFileInput = $('cookieFileInput');
  const cookieTextInput = $('cookieTextInput');
  const saveCookieBtn = $('saveCookieBtn');
  const clearCookieBtn = $('clearCookieBtn');
  const cookieStatusText = $('cookieStatusText');
  const autoFallbackToggle = $('autoFallbackToggle');
  const aspectBtnGroup = $('aspectBtnGroup');
  const charLockToggle = $('charLockToggle');
  const charFileInput = $('charFileInput');
  const charThumb = $('charThumb');
  const charThumbImg = $('charThumbImg');
  const charRemoveBtn = $('charRemoveBtn');
  const charDesc = $('charDesc');
  const styleLockToggle = $('styleLockToggle');
  const styleFileInput = $('styleFileInput');
  const styleThumb = $('styleThumb');
  const styleThumbImg = $('styleThumbImg');
  const styleRemoveBtn = $('styleRemoveBtn');
  const styleDesc = $('styleDesc');
  const negativeChips = $('negativeChips');
  const customNegative = $('customNegative');
  const bulkPrompts = $('bulkPrompts');
  const promptCount = $('promptCount');
  const autoFormatBtn = $('autoFormatBtn');
  const loadSamplePromptsBtn = $('loadSamplePromptsBtn');
  const generateAllBtn = $('generateAllBtn');
  const generateBtnText = $('generateBtnText');
  const downloadZipBtn = $('downloadZipBtn');

  // DOM Elements - Gallery & Canvas
  const galleryGrid = $('galleryGrid');
  const statTotal = $('statTotal');
  const statGenerated = $('statGenerated');
  const statRemaining = $('statRemaining');
  const progressBar = $('progressBar');
  const progressFill = $('progressFill');
  const galleryReadyPill = $('galleryReadyPill');
  const resetShootGalleryBtn = $('resetShootGalleryBtn');
  const downloadAllZipTopBtn = $('downloadAllZipTopBtn');
  const pushTimelineBtn = $('pushTimelineBtn');

  // DOM Elements - Lightbox Modal
  const lightboxModal = $('lightboxModal');
  const closeLightboxBtn = $('closeLightboxBtn');
  const lightboxImg = $('lightboxImg');
  const lightboxTitle = $('lightboxTitle');
  const lightboxPrompt = $('lightboxPrompt');
  const lightboxDownloadBtn = $('lightboxDownloadBtn');
  let currentLightboxItem = null;

  // DOM Elements - Edit Prompt Modal
  const editPromptModal = $('editPromptModal');
  const closeEditPromptBtn = $('closeEditPromptBtn');
  const editTimestampInput = $('editTimestampInput');
  const editPromptInput = $('editPromptInput');
  const saveAndRegenBtn = $('saveAndRegenBtn');
  let currentEditItem = null;

  // Toast Notification
  const toast = $('toast');
  const toastMsg = $('toastMsg');

  function showToast(message, type = 'info') {
    if (!toast || !toastMsg) return;
    toastMsg.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
      toast.className = 'toast';
    }, 3200);
  }

  // ================= 1. Load Settings from Storage =================
  async function loadSettings() {
    try {
      const saved = await window.StorageManager.get();
      if (saved.googleApiKey && settingGoogleKey) {
        state.googleApiKey = saved.googleApiKey;
        settingGoogleKey.value = saved.googleApiKey;
      }
      if (saved.engine && engineSelect) {
        state.selectedEngine = saved.engine;
        engineSelect.value = saved.engine;
        updateActiveEngineLabel();
      }
      if (saved.autoFallback !== undefined && autoFallbackToggle) {
        state.autoFallback = saved.autoFallback;
        autoFallbackToggle.checked = saved.autoFallback;
      }
      if (saved.concurrency && settingConcurrency) {
        state.concurrency = parseInt(saved.concurrency, 10);
        settingConcurrency.value = saved.concurrency;
      }
      if (saved.canvasCookies && cookieTextInput) {
        cookieTextInput.value = saved.canvasCookies;
        if (cookieStatusText) {
          cookieStatusText.textContent = '✓ Custom Google cookies active';
          cookieStatusText.style.color = '#10B981';
        }
      }
    } catch (e) {
      console.warn('Load settings error:', e);
    }
  }

  function updateActiveEngineLabel(override = null) {
    if (!activeEngineLabel) return;
    if (override) {
      activeEngineLabel.textContent = override;
      return;
    }
    switch (state.selectedEngine) {
      case 'google-aistudio':
        activeEngineLabel.textContent = 'Google AI Studio (Imagen 3 API)';
        break;
      case 'pollinations-flux':
        activeEngineLabel.textContent = 'Free Serverless (Pollinations Turbo)';
        break;
      case 'gemini-canvas':
      default:
        activeEngineLabel.textContent = 'Google Gemini Canvas (Live Session)';
        break;
    }
  }

  await loadSettings();

  // ================= 2. Gemini Canvas Cluster Detection & Connect =================
  async function checkCanvasConnection() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const tabs = await chrome.tabs.query({ url: ["*://gemini.google.com/*", "*://share.gemini.google/*"] });
        if (tabs && tabs.length > 0) {
          state.canvasTabId = tabs[0].id;
          if (canvasClusterStatus) {
            canvasClusterStatus.textContent = '🟢 Connected';
            canvasClusterStatus.style.color = '#10B981';
          }
          return true;
        }
      } catch (e) {
        console.warn('Canvas check error:', e);
      }
    }
    if (canvasClusterStatus) {
      canvasClusterStatus.textContent = '🟡 Standby';
      canvasClusterStatus.style.color = '#F59E0B';
    }
    return false;
  }

  await checkCanvasConnection();

  if (openCanvasTabBtn) {
    openCanvasTabBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: GEMINI_CANVAS_URL }, (tab) => {
          state.canvasTabId = tab.id;
          if (canvasClusterStatus) {
            canvasClusterStatus.textContent = '🟢 Connected';
            canvasClusterStatus.style.color = '#10B981';
          }
          showToast('Opened Gemini Canvas session. Ready to generate!', 'success');
        });
      } else {
        window.open(GEMINI_CANVAS_URL, '_blank');
      }
    });
  }

  if (refreshCanvasTabBtn) {
    refreshCanvasTabBtn.addEventListener('click', async () => {
      const isConn = await checkCanvasConnection();
      showToast(isConn ? 'Gemini Canvas tab detected and connected!' : 'No Canvas tab detected. Click "Open Canvas" to launch one.', isConn ? 'success' : 'info');
    });
  }

  // Listen for live Canvas ready signals from content script
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'RENDERX_CANVAS_READY') {
        if (canvasClusterStatus) {
          canvasClusterStatus.textContent = '🟢 Connected (acc1 / Live Canvas)';
          canvasClusterStatus.style.color = '#10B981';
        }
      }
    });
  }

  // ================= Cookie Management =================
  if (toggleCookieBtn && cookieSubpanel) {
    toggleCookieBtn.addEventListener('click', () => {
      const isHidden = cookieSubpanel.style.display === 'none';
      cookieSubpanel.style.display = isHidden ? 'block' : 'none';
    });
  }

  if (saveCookieBtn && cookieTextInput) {
    saveCookieBtn.addEventListener('click', async () => {
      const val = cookieTextInput.value.trim();
      if (!val) {
        showToast('Please paste cookies or upload a .json file', 'info');
        return;
      }
      await window.StorageManager.save({ canvasCookies: val });
      if (cookieStatusText) {
        cookieStatusText.textContent = '✓ Custom Google cookies saved';
        cookieStatusText.style.color = '#10B981';
      }
      showToast('Cookies saved for Google Canvas automation', 'success');
    });
  }

  if (clearCookieBtn && cookieTextInput) {
    clearCookieBtn.addEventListener('click', async () => {
      cookieTextInput.value = '';
      await window.StorageManager.save({ canvasCookies: '' });
      if (cookieStatusText) {
        cookieStatusText.textContent = 'Default: Using active Chrome Google tab';
        cookieStatusText.style.color = '#64748B';
      }
      showToast('Custom cookies cleared', 'info');
    });
  }

  if (cookieFileInput && cookieTextInput) {
    cookieFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const content = evt.target.result;
          cookieTextInput.value = content;
          await window.StorageManager.save({ canvasCookies: content });
          if (cookieStatusText) {
            cookieStatusText.textContent = `✓ Loaded ${file.name} successfully`;
            cookieStatusText.style.color = '#10B981';
          }
          showToast(`Imported cookies from ${file.name}`, 'success');
        } catch (err) {
          showToast('Failed to parse cookies file', 'error');
        }
      };
      reader.readAsText(file);
    });
  }

  // Settings Modal Events
  if (openSettingsBtn && settingsModal) {
    openSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'flex'; });
  }
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'none'; });
  }

  if (saveSettingsBtn && settingsModal) {
    saveSettingsBtn.addEventListener('click', async () => {
      if (settingGoogleKey) state.googleApiKey = settingGoogleKey.value.trim();
      if (settingConcurrency) state.concurrency = parseInt(settingConcurrency.value, 10);

      await window.StorageManager.save({
        googleApiKey: state.googleApiKey,
        concurrency: state.concurrency
      });

      settingsModal.style.display = 'none';
      showToast('Settings saved successfully', 'success');
    });
  }

  if (engineSelect) {
    engineSelect.addEventListener('change', async () => {
      state.selectedEngine = engineSelect.value;
      updateActiveEngineLabel();
      await window.StorageManager.save({ engine: state.selectedEngine });
    });
  }

  if (autoFallbackToggle) {
    autoFallbackToggle.addEventListener('change', async () => {
      state.autoFallback = autoFallbackToggle.checked;
      await window.StorageManager.save({ autoFallback: state.autoFallback });
    });
  }

  // Aspect Ratio Button Selector
  if (aspectBtnGroup) {
    aspectBtnGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-aspect');
      if (!btn) return;

      aspectBtnGroup.querySelectorAll('.btn-aspect').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.aspectRatio = btn.dataset.aspect;
      document.querySelectorAll('.card-preview').forEach(el => {
        el.className = `card-preview aspect-${state.aspectRatio}`;
      });
      showToast(`Aspect ratio set to ${btn.textContent.trim()}`);
    });
  }

  // ================= 3. Character & Style Reference Uploads =================
  function setupImageUpload(fileInput, thumbImg, thumbPlaceholder, removeBtn, stateKey) {
    if (!fileInput || !thumbImg) return;

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        state[stateKey] = event.target.result;
        thumbImg.src = event.target.result;
        thumbImg.style.display = 'block';
        if (thumbPlaceholder) thumbPlaceholder.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'inline-block';
        showToast('Reference image attached');
      };
      reader.readAsDataURL(file);
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        state[stateKey] = null;
        fileInput.value = '';
        thumbImg.src = '';
        thumbImg.style.display = 'none';
        if (thumbPlaceholder) thumbPlaceholder.style.display = 'block';
        removeBtn.style.display = 'none';
      });
    }
  }

  setupImageUpload(charFileInput, charThumbImg, charThumb ? charThumb.querySelector('.placeholder-icon') : null, charRemoveBtn, 'charImageBase64');
  setupImageUpload(styleFileInput, styleThumbImg, styleThumb ? styleThumb.querySelector('.placeholder-icon') : null, styleRemoveBtn, 'styleImageBase64');

  // Negative Prompt Chips
  if (negativeChips) {
    negativeChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-tag');
      if (!chip) return;
      chip.classList.toggle('active');
    });
  }

  function getCombinedNegativePrompt() {
    const activeChips = Array.from(document.querySelectorAll('.chip-tag.active')).map(c => c.dataset.val);
    if (customNegative) {
      const custom = customNegative.value.trim();
      if (custom) activeChips.push(custom);
    }
    return activeChips.join(', ');
  }

  // ================= 4. Timeline Prompt Parsing =================
  function updatePromptCount() {
    if (!bulkPrompts) return;
    const parsed = window.TimelineParser.parse(bulkPrompts.value);
    if (promptCount) promptCount.textContent = `${parsed.length}`;
    if (generateBtnText) {
      if (parsed.length > 0) {
        generateBtnText.textContent = `Generate ${parsed.length} Images`;
      } else {
        generateBtnText.textContent = 'Generate Images';
      }
    }
  }

  if (bulkPrompts) {
    bulkPrompts.addEventListener('input', updatePromptCount);
  }

  if (autoFormatBtn && bulkPrompts) {
    autoFormatBtn.addEventListener('click', () => {
      const text = bulkPrompts.value;
      if (!text.trim()) {
        showToast('Paste prompts first to auto-format', 'info');
        return;
      }
      const formatted = window.TimelineParser.autoFormat(text);
      bulkPrompts.value = formatted;
      updatePromptCount();
      showToast('Timeline prompts formatted', 'success');
    });
  }

  if (loadSamplePromptsBtn && bulkPrompts) {
    loadSamplePromptsBtn.addEventListener('click', () => {
      const sample = `00.00-02.50 | Scene 1: Medium Action Shot, subject in dynamic motion, 35mm shallow depth of field
02.50-08.59 | Scene 2: Cinematic Close-Up detail shot, high emotional tension, soft volumetric lighting
08.59-16.42 | Scene 3: Extreme Wide Establishing Angle, sweeping cinematic horizon, atmospheric rim lighting
16.42-22.94 | Scene 4: Over-The-Shoulder narrative framing, award-winning cinematography, soft bokeh`;

      bulkPrompts.value = sample;
      updatePromptCount();
      showToast('Loaded 4 sample scenes', 'success');
    });
  }

  // ================= 5. Standby 4-Dummy State + 3-Button Card Layout =================
  const dummyGridHTML = `
    <div class="dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 00.00 - 04.35</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="dummy-preview">
        <div style="font-size: 22px; color: #38BDF8;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #1 Ready</span>
      </div>
      <div class="card-meta">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="card-filename">📁 01_00.00-04.35.png</span>
          <span class="card-index">#01</span>
        </div>
        <div class="card-prompt-text">Scene 1: Medium Action Shot, subject in dynamic motion, 35mm shallow depth of field...</div>
        <div class="card-actions-single-row">
          <button class="btn-card-action" data-action="edit" data-index="1">✏️ Edit</button>
          <button class="btn-card-action btn-regen" data-action="regen" data-index="1">🎲 Re-Roll</button>
          <button class="btn-card-action" data-action="save" data-index="1">💾 Save</button>
        </div>
      </div>
    </div>

    <div class="dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 04.35 - 07.83</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="dummy-preview">
        <div style="font-size: 22px; color: #38BDF8;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #2 Ready</span>
      </div>
      <div class="card-meta">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="card-filename">📁 02_04.35-07.83.png</span>
          <span class="card-index">#02</span>
        </div>
        <div class="card-prompt-text">Scene 2: Cinematic Close-Up detail shot, high emotional tension, soft volumetric lighting...</div>
        <div class="card-actions-single-row">
          <button class="btn-card-action" data-action="edit" data-index="2">✏️ Edit</button>
          <button class="btn-card-action btn-regen" data-action="regen" data-index="2">🎲 Re-Roll</button>
          <button class="btn-card-action" data-action="save" data-index="2">💾 Save</button>
        </div>
      </div>
    </div>

    <div class="dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 07.83 - 11.74</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="dummy-preview">
        <div style="font-size: 22px; color: #38BDF8;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #3 Ready</span>
      </div>
      <div class="card-meta">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="card-filename">📁 03_07.83-11.74.png</span>
          <span class="card-index">#03</span>
        </div>
        <div class="card-prompt-text">Scene 3: Extreme Wide Establishing Angle, sweeping cinematic horizon, atmospheric rim...</div>
        <div class="card-actions-single-row">
          <button class="btn-card-action" data-action="edit" data-index="3">✏️ Edit</button>
          <button class="btn-card-action btn-regen" data-action="regen" data-index="3">🎲 Re-Roll</button>
          <button class="btn-card-action" data-action="save" data-index="3">💾 Save</button>
        </div>
      </div>
    </div>

    <div class="dummy-card">
      <div class="card-header-bar">
        <span class="timestamp-badge">🛡️ 11.74 - 16.52</span>
        <span class="badge-standby">Standby</span>
      </div>
      <div class="dummy-preview">
        <div style="font-size: 22px; color: #38BDF8;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #4 Ready</span>
      </div>
      <div class="card-meta">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="card-filename">📁 04_11.74-16.52.png</span>
          <span class="card-index">#04</span>
        </div>
        <div class="card-prompt-text">Scene 4: Over-The-Shoulder narrative framing, award-winning cinematography, soft bokeh...</div>
        <div class="card-actions-single-row">
          <button class="btn-card-action" data-action="edit" data-index="4">✏️ Edit</button>
          <button class="btn-card-action btn-regen" data-action="regen" data-index="4">🎲 Re-Roll</button>
          <button class="btn-card-action" data-action="save" data-index="4">💾 Save</button>
        </div>
      </div>
    </div>

    <div class="dummy-continuation-row">
      <div class="dummy-arrow-circle">↓</div>
      <span class="dummy-continuation-text">Standby: Images will populate dynamically in 4-column rows upon generation</span>
    </div>
  `;

  function resetGalleryToDummy() {
    state.items.forEach(it => {
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
    });
    state.items = [];
    if (galleryGrid) galleryGrid.innerHTML = dummyGridHTML;
    if (statTotal) statTotal.textContent = '0';
    if (statGenerated) statGenerated.textContent = '0';
    if (statRemaining) statRemaining.textContent = '0';
    if (galleryReadyPill) galleryReadyPill.textContent = '0 READY (STANDBY GRID)';
    if (progressBar) progressBar.style.display = 'none';
    if (progressFill) progressFill.style.width = '0%';
    if (downloadZipBtn) downloadZipBtn.disabled = true;
  }

  if (clearGalleryBtn) {
    clearGalleryBtn.addEventListener('click', () => {
      resetGalleryToDummy();
      showToast('Gallery cleared', 'info');
    });
  }

  if (resetShootGalleryBtn) {
    resetShootGalleryBtn.addEventListener('click', () => {
      resetGalleryToDummy();
      showToast('Shoot gallery reset', 'info');
    });
  }

  if (downloadAllZipTopBtn && downloadZipBtn) {
    downloadAllZipTopBtn.addEventListener('click', () => {
      downloadZipBtn.click();
    });
  }

  if (pushTimelineBtn && downloadZipBtn) {
    pushTimelineBtn.addEventListener('click', () => {
      downloadZipBtn.click();
      showToast('Exporting timeline package for video editors...', 'success');
    });
  }

  if (globalResetBtn) {
    globalResetBtn.addEventListener('click', () => {
      if (confirm('Reset RenderX Studio? This will clear all prompts and generated gallery.')) {
        if (bulkPrompts) bulkPrompts.value = '';
        updatePromptCount();
        resetGalleryToDummy();
        showToast('Workspace reset to clean state', 'success');
      }
    });
  }

  // ================= 6. Card Rendering (4-Column Layout, 3-Buttons) =================
  function renderPlaceholderCards(items) {
    if (!galleryGrid) return;
    galleryGrid.innerHTML = '';
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.id = `card-${item.index}`;

      const fn = item.filename || `0${item.index}_${item.cleanTimestamp}.png`;

      card.innerHTML = `
        <div class="card-header-bar">
          <span class="timestamp-badge">🛡️ ${item.timestamp}</span>
          <span class="badge-standby" id="badge-${item.index}">Standby</span>
        </div>
        <div class="card-preview aspect-${state.aspectRatio}" id="preview-${item.index}">
          <div class="card-loading" id="loading-${item.index}">
            <div class="spinner"></div>
            <span>Waiting in queue...</span>
          </div>
        </div>
        <div class="card-meta">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="card-filename">📁 ${fn}</span>
            <span class="card-index">#${String(item.index).padStart(2, '0')}</span>
          </div>
          <div class="card-prompt-text" title="${item.prompt}">${item.prompt}</div>
          <div class="card-actions-single-row">
            <button class="btn-card-action" data-action="edit" data-index="${item.index}">✏️ Edit</button>
            <button class="btn-card-action btn-regen" data-action="regen" data-index="${item.index}">🎲 Re-Roll</button>
            <button class="btn-card-action" data-action="save" data-index="${item.index}">💾 Save</button>
          </div>
        </div>
      `;

      galleryGrid.appendChild(card);
    });
  }

  function updateCardLoading(index, statusText = 'Generating scene...') {
    const loadingEl = document.getElementById(`loading-${index}`);
    if (loadingEl) {
      const span = loadingEl.querySelector('span');
      if (span) span.textContent = statusText;
    }
  }

  function updateCardSuccess(item) {
    const previewEl = document.getElementById(`preview-${item.index}`);
    const cardEl = document.getElementById(`card-${item.index}`);
    if (!previewEl || !cardEl) return;

    const badgeEl = document.getElementById(`badge-${item.index}`);
    if (badgeEl) {
      badgeEl.className = 'badge-acc';
      badgeEl.textContent = 'acc1';
    }

    const loadingEl = document.getElementById(`loading-${item.index}`);
    if (loadingEl) loadingEl.remove();

    const img = document.createElement('img');
    img.src = item.objectUrl;
    img.alt = item.prompt;
    img.onclick = () => openLightbox(item);
    previewEl.appendChild(img);

    const zoomBtn = document.createElement('div');
    zoomBtn.className = 'zoom-overlay-btn';
    zoomBtn.innerHTML = '🔍 Zoom';
    zoomBtn.onclick = () => openLightbox(item);
    previewEl.appendChild(zoomBtn);
  }

  function updateCardError(index, errorMsg) {
    const loadingEl = document.getElementById(`loading-${index}`);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <span style="color: #F87171; font-weight: 700;">Failed</span>
        <span style="font-size: 8.5px; color: var(--text-dim); text-align: center; padding: 0 4px; line-height: 1.2;">${errorMsg}</span>
      `;
    }
  }

  // ================= 7. Concurrency Queue & Batch Execution =================
  async function generateSingleItem(item) {
    updateCardLoading(item.index, 'Connecting to Canvas...');

    try {
      const options = {
        engine: state.selectedEngine,
        autoFallback: state.autoFallback,
        aspectRatio: state.aspectRatio,
        negativePrompt: getCombinedNegativePrompt(),
        charLock: charLockToggle ? charLockToggle.checked : false,
        charDesc: charDesc ? charDesc.value : '',
        charImage: state.charImageBase64,
        styleLock: styleLockToggle ? styleLockToggle.checked : false,
        styleDesc: styleDesc ? styleDesc.value : '',
        styleImage: state.styleImageBase64,
        apiKey: state.googleApiKey,
        onStatusUpdate: (statusText) => {
          updateCardLoading(item.index, statusText);
        },
        onEngineFallback: (newEngine, reason) => {
          updateActiveEngineLabel(`Active: ${newEngine}`);
          showToast(`Fallback to ${newEngine}: ${reason}`, 'info');
        }
      };

      const { blob, engineUsed } = await window.EngineManager.execute(item.prompt, options);

      item.blob = blob;
      item.objectUrl = URL.createObjectURL(blob);
      item.filename = window.TimelineParser.generateFilename(item.index, item.cleanTimestamp, item.prompt);
      item.status = 'done';
      item.engineUsed = engineUsed;

      updateCardSuccess(item);
      return true;
    } catch (err) {
      console.error(`Item ${item.index} generation error:`, err);
      item.status = 'error';
      updateCardError(item.index, err.message);
      return false;
    }
  }

  async function runBatchQueue(itemsToRun) {
    state.isGenerating = true;
    state.shouldAbort = false;
    if (generateAllBtn) generateAllBtn.disabled = true;
    if (generateBtnText) generateBtnText.textContent = 'Generating...';
    if (progressBar) progressBar.style.display = 'block';

    const total = itemsToRun.length;
    let completedCount = 0;

    if (statTotal) statTotal.textContent = state.items.length;
    if (statRemaining) statRemaining.textContent = total;

    let currentIndex = 0;

    async function worker() {
      while (currentIndex < itemsToRun.length && !state.shouldAbort) {
        const item = itemsToRun[currentIndex++];
        await generateSingleItem(item);
        completedCount++;

        const doneCount = state.items.filter(it => it.status === 'done').length;
        if (statGenerated) statGenerated.textContent = doneCount;
        if (statRemaining) statRemaining.textContent = Math.max(0, total - completedCount);
        if (galleryReadyPill) galleryReadyPill.textContent = `${doneCount} / ${total} READY`;
        const percent = Math.round((completedCount / total) * 100);
        if (progressFill) progressFill.style.width = `${percent}%`;
      }
    }

    const workerCount = Math.max(1, Math.min(state.concurrency || 3, itemsToRun.length));
    const workers = Array.from({ length: workerCount }, () => worker());

    await Promise.all(workers);

    state.isGenerating = false;
    if (generateAllBtn) generateAllBtn.disabled = false;
    updatePromptCount();

    const successCount = state.items.filter(it => it.status === 'done').length;
    if (successCount > 0) {
      if (downloadZipBtn) downloadZipBtn.disabled = false;
      showToast(`Batch completed: ${successCount} scenes ready!`, 'success');
    } else {
      showToast('Batch encountered issues. Check errors or Canvas session.', 'error');
    }
  }

  // Master Global Handler for Generate Images Click
  window.triggerGenerateBatch = async function () {
    if (state.isGenerating) {
      showToast('Generation already in progress...', 'info');
      return;
    }

    const rawText = bulkPrompts ? bulkPrompts.value.trim() : '';
    if (!rawText) {
      showToast('Please enter timeline prompts in the input box', 'error');
      if (bulkPrompts) bulkPrompts.focus();
      return;
    }

    const parsed = window.TimelineParser.parse(rawText);
    if (parsed.length === 0) {
      showToast('No valid prompts detected. Use format: 00.00-02.50 | Prompt', 'error');
      return;
    }

    showToast(`Starting generation of ${parsed.length} scenes...`, 'info');

    state.items = parsed.map(p => ({
      ...p,
      blob: null,
      objectUrl: null,
      filename: null,
      status: 'pending'
    }));

    renderPlaceholderCards(state.items);
    await runBatchQueue(state.items);
  };

  if (generateAllBtn) {
    generateAllBtn.addEventListener('click', window.triggerGenerateBatch);
  }

  // Card Action Handlers (Edit, Re-Roll, Save)
  if (galleryGrid) {
    galleryGrid.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const index = parseInt(btn.dataset.index, 10);
      const item = state.items.find(it => it.index === index);
      if (!item) return;

      if (action === 'edit') {
        openEditModal(item);
      } else if (action === 'regen') {
        if (state.isGenerating) {
          showToast('Batch currently generating...', 'info');
          return;
        }
        showToast(`Regenerating Scene #${item.index}...`);
        await generateSingleItem(item);
        if (statGenerated) statGenerated.textContent = state.items.filter(it => it.status === 'done').length;
        if (galleryReadyPill) galleryReadyPill.textContent = `${statGenerated.textContent} / ${state.items.length} READY`;
      } else if (action === 'save') {
        if (!item.blob) {
          showToast('Image not generated yet', 'info');
          return;
        }
        const a = document.createElement('a');
        a.href = item.objectUrl;
        a.download = item.filename || `Scene_${item.index}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`Saved ${item.filename}`, 'success');
      }
    });
  }

  // Lightbox Modal
  function openLightbox(item) {
    if (!lightboxModal) return;
    currentLightboxItem = item;
    if (lightboxImg) lightboxImg.src = item.objectUrl;
    if (lightboxTitle) lightboxTitle.textContent = `Scene #${item.index} (${item.timestamp})`;
    if (lightboxPrompt) lightboxPrompt.textContent = item.prompt;
    lightboxModal.style.display = 'flex';
  }

  if (closeLightboxBtn && lightboxModal) {
    closeLightboxBtn.addEventListener('click', () => { lightboxModal.style.display = 'none'; });
  }

  if (lightboxDownloadBtn) {
    lightboxDownloadBtn.addEventListener('click', () => {
      if (!currentLightboxItem || !currentLightboxItem.blob) return;
      const a = document.createElement('a');
      a.href = currentLightboxItem.objectUrl;
      a.download = currentLightboxItem.filename || `Scene_${currentLightboxItem.index}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  // Edit Modal
  function openEditModal(item) {
    if (!editPromptModal) return;
    currentEditItem = item;
    if (editTimestampInput) editTimestampInput.value = item.timestamp;
    if (editPromptInput) editPromptInput.value = item.prompt;
    editPromptModal.style.display = 'flex';
  }

  if (closeEditPromptBtn && editPromptModal) {
    closeEditPromptBtn.addEventListener('click', () => { editPromptModal.style.display = 'none'; });
  }

  if (saveAndRegenBtn) {
    saveAndRegenBtn.addEventListener('click', async () => {
      if (!currentEditItem) return;

      if (editTimestampInput) {
        currentEditItem.timestamp = editTimestampInput.value.trim() || currentEditItem.timestamp;
        currentEditItem.cleanTimestamp = currentEditItem.timestamp.replace(/\s+/g, '').replace(/s$/i, '');
      }
      if (editPromptInput) {
        currentEditItem.prompt = editPromptInput.value.trim() || currentEditItem.prompt;
      }

      const cardEl = document.getElementById(`card-${currentEditItem.index}`);
      if (cardEl) {
        const badge = cardEl.querySelector('.timestamp-badge');
        if (badge) badge.textContent = `🛡️ ${currentEditItem.timestamp}`;
        const promptEl = cardEl.querySelector('.card-prompt-text');
        if (promptEl) {
          promptEl.textContent = currentEditItem.prompt;
          promptEl.title = currentEditItem.prompt;
        }
      }

      if (editPromptModal) editPromptModal.style.display = 'none';
      showToast(`Regenerating Scene #${currentEditItem.index}...`);
      await generateSingleItem(currentEditItem);
    });
  }

  // Download All ZIP
  if (downloadZipBtn) {
    downloadZipBtn.addEventListener('click', async () => {
      const completedItems = state.items.filter(it => it.status === 'done' && it.blob);
      if (completedItems.length === 0) {
        showToast('No generated images ready to download', 'error');
        return;
      }

      downloadZipBtn.disabled = true;
      showToast(`Bundling ${completedItems.length} scenes into ZIP...`, 'info');

      try {
        await window.ZipExporter.export(completedItems, 'RenderX_Timeline_Images.zip');
        showToast('Download started! Timeline sync CSV included.', 'success');
      } catch (err) {
        console.error('ZIP export error:', err);
        showToast(`ZIP Export failed: ${err.message}`, 'error');
      } finally {
        downloadZipBtn.disabled = false;
      }
    });
  }

  // Initial prompt count
  updatePromptCount();
});
