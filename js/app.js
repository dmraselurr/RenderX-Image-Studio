/**
 * RenderX Image Studio - v1.0.2 Application Controller
 * Matches RenderX Pro 4-Column Layout, Highlighted Boxes & Canvas Connection Bridge
 */

document.addEventListener('DOMContentLoaded', async () => {
  const GEMINI_CANVAS_URL = 'https://gemini.google.com/share/f8350ff50be0';

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

  // DOM Elements - Navigation & Actions
  const activeEngineLabel = document.getElementById('activeEngineLabel');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const globalResetBtn = document.getElementById('globalResetBtn');
  const clearGalleryBtn = document.getElementById('clearGalleryBtn');

  // DOM Elements - Settings Modal
  const settingGoogleKey = document.getElementById('settingGoogleKey');
  const settingConcurrency = document.getElementById('settingConcurrency');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  // DOM Elements - Left Sidebar Controls
  const engineSelect = document.getElementById('engineSelect');
  const canvasClusterStatus = document.getElementById('canvasClusterStatus');
  const openCanvasTabBtn = document.getElementById('openCanvasTabBtn');
  const refreshCanvasTabBtn = document.getElementById('refreshCanvasTabBtn');
  const autoFallbackToggle = document.getElementById('autoFallbackToggle');
  const aspectBtnGroup = document.getElementById('aspectBtnGroup');
  const charLockToggle = document.getElementById('charLockToggle');
  const charFileInput = document.getElementById('charFileInput');
  const charThumb = document.getElementById('charThumb');
  const charThumbImg = document.getElementById('charThumbImg');
  const charRemoveBtn = document.getElementById('charRemoveBtn');
  const charDesc = document.getElementById('charDesc');
  const styleLockToggle = document.getElementById('styleLockToggle');
  const styleFileInput = document.getElementById('styleFileInput');
  const styleThumb = document.getElementById('styleThumb');
  const styleThumbImg = document.getElementById('styleThumbImg');
  const styleRemoveBtn = document.getElementById('styleRemoveBtn');
  const styleDesc = document.getElementById('styleDesc');
  const negativeChips = document.getElementById('negativeChips');
  const customNegative = document.getElementById('customNegative');
  const bulkPrompts = document.getElementById('bulkPrompts');
  const promptCount = document.getElementById('promptCount');
  const autoFormatBtn = document.getElementById('autoFormatBtn');
  const loadSamplePromptsBtn = document.getElementById('loadSamplePromptsBtn');
  const generateAllBtn = document.getElementById('generateAllBtn');
  const generateBtnText = document.getElementById('generateBtnText');
  const downloadZipBtn = document.getElementById('downloadZipBtn');

  // DOM Elements - Gallery & Canvas
  const galleryGrid = document.getElementById('galleryGrid');
  const statTotal = document.getElementById('statTotal');
  const statGenerated = document.getElementById('statGenerated');
  const statRemaining = document.getElementById('statRemaining');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');

  // DOM Elements - Lightbox Modal
  const lightboxModal = document.getElementById('lightboxModal');
  const closeLightboxBtn = document.getElementById('closeLightboxBtn');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxPrompt = document.getElementById('lightboxPrompt');
  const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');
  let currentLightboxItem = null;

  // DOM Elements - Edit Prompt Modal
  const editPromptModal = document.getElementById('editPromptModal');
  const closeEditPromptBtn = document.getElementById('closeEditPromptBtn');
  const editTimestampInput = document.getElementById('editTimestampInput');
  const editPromptInput = document.getElementById('editPromptInput');
  const saveAndRegenBtn = document.getElementById('saveAndRegenBtn');
  let currentEditItem = null;

  // Toast Notification
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  function showToast(message, type = 'info') {
    toastMsg.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
      toast.className = 'toast';
    }, 3200);
  }

  // ================= 1. Load Settings from Storage =================
  async function loadSettings() {
    const saved = await window.StorageManager.get();
    if (saved.googleApiKey) {
      state.googleApiKey = saved.googleApiKey;
      settingGoogleKey.value = saved.googleApiKey;
    }
    if (saved.engine) {
      state.selectedEngine = saved.engine;
      engineSelect.value = saved.engine;
      updateActiveEngineLabel();
    }
    if (saved.autoFallback !== undefined) {
      state.autoFallback = saved.autoFallback;
      autoFallbackToggle.checked = saved.autoFallback;
    }
    if (saved.concurrency) {
      state.concurrency = parseInt(saved.concurrency, 10);
      settingConcurrency.value = saved.concurrency;
    }
  }

  function updateActiveEngineLabel(override = null) {
    if (override) {
      activeEngineLabel.textContent = override;
      return;
    }
    switch (state.selectedEngine) {
      case 'google-aistudio':
        activeEngineLabel.textContent = 'Direct API (Google AI Studio)';
        break;
      case 'pollinations-flux':
        activeEngineLabel.textContent = 'Free Serverless (FLUX.1)';
        break;
      case 'gemini-canvas':
      default:
        activeEngineLabel.textContent = 'Free Canvas (acc1-7 Cluster)';
        break;
    }
  }

  await loadSettings();

  // ================= 2. Gemini Canvas Cluster Detection & Connect =================
  async function checkCanvasConnection() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const tabs = await chrome.tabs.query({ url: ["*://gemini.google.com/share/*", "*://share.gemini.google/*"] });
        if (tabs && tabs.length > 0) {
          state.canvasTabId = tabs[0].id;
          canvasClusterStatus.textContent = '🟢 Connected';
          canvasClusterStatus.style.color = '#10B981';
          return true;
        }
      } catch (e) {
        console.warn('Canvas check error:', e);
      }
    }
    canvasClusterStatus.textContent = '🟡 Standby';
    canvasClusterStatus.style.color = '#F59E0B';
    return false;
  }

  await checkCanvasConnection();

  openCanvasTabBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: GEMINI_CANVAS_URL }, (tab) => {
        state.canvasTabId = tab.id;
        canvasClusterStatus.textContent = '🟢 Connected';
        canvasClusterStatus.style.color = '#10B981';
        showToast('Opened Gemini Canvas session. Ready to generate!', 'success');
      });
    } else {
      window.open(GEMINI_CANVAS_URL, '_blank');
    }
  });

  refreshCanvasTabBtn.addEventListener('click', async () => {
    const isConn = await checkCanvasConnection();
    showToast(isConn ? 'Gemini Canvas tab detected and connected!' : 'No Canvas tab detected. Click "Open Canvas" to launch one.', isConn ? 'success' : 'info');
  });

  // Settings Modal Events
  openSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'flex'; });
  closeSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'none'; });

  saveSettingsBtn.addEventListener('click', async () => {
    state.googleApiKey = settingGoogleKey.value.trim();
    state.concurrency = parseInt(settingConcurrency.value, 10);

    await window.StorageManager.save({
      googleApiKey: state.googleApiKey,
      concurrency: state.concurrency
    });

    settingsModal.style.display = 'none';
    showToast('Settings saved successfully', 'success');
  });

  engineSelect.addEventListener('change', async () => {
    state.selectedEngine = engineSelect.value;
    updateActiveEngineLabel();
    await window.StorageManager.save({ engine: state.selectedEngine });
  });

  autoFallbackToggle.addEventListener('change', async () => {
    state.autoFallback = autoFallbackToggle.checked;
    await window.StorageManager.save({ autoFallback: state.autoFallback });
  });

  // Aspect Ratio Button Selector (16:9, 9:16, 1:1)
  aspectBtnGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-aspect');
    if (!btn) return;

    aspectBtnGroup.querySelectorAll('.btn-aspect').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    state.aspectRatio = btn.dataset.aspect;
    document.querySelectorAll('.card-preview').forEach(el => {
      el.className = `card-preview aspect-${state.aspectRatio}`;
    });
    showToast(`Aspect ratio set to ${btn.textContent}`);
  });

  // ================= 3. Character & Style Reference Uploads =================
  function setupImageUpload(fileInput, thumbImg, thumbPlaceholder, removeBtn, stateKey) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        state[stateKey] = event.target.result;
        thumbImg.src = event.target.result;
        thumbImg.style.display = 'block';
        thumbPlaceholder.style.display = 'none';
        removeBtn.style.display = 'inline-block';
        showToast('Reference image attached');
      };
      reader.readAsDataURL(file);
    });

    removeBtn.addEventListener('click', () => {
      state[stateKey] = null;
      fileInput.value = '';
      thumbImg.src = '';
      thumbImg.style.display = 'none';
      thumbPlaceholder.style.display = 'block';
      removeBtn.style.display = 'none';
    });
  }

  setupImageUpload(charFileInput, charThumbImg, charThumb.querySelector('.placeholder-icon'), charRemoveBtn, 'charImageBase64');
  setupImageUpload(styleFileInput, styleThumbImg, styleThumb.querySelector('.placeholder-icon'), styleRemoveBtn, 'styleImageBase64');

  // Negative Prompt Chips
  negativeChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-tag');
    if (!chip) return;
    chip.classList.toggle('active');
  });

  function getCombinedNegativePrompt() {
    const activeChips = Array.from(document.querySelectorAll('.chip-tag.active')).map(c => c.dataset.val);
    const custom = customNegative.value.trim();
    if (custom) activeChips.push(custom);
    return activeChips.join(', ');
  }

  // ================= 4. Timeline Prompt Parsing =================
  function updatePromptCount() {
    const parsed = window.TimelineParser.parse(bulkPrompts.value);
    promptCount.textContent = `${parsed.length}`;
    if (parsed.length > 0) {
      generateBtnText.textContent = `Generate ${parsed.length} Images`;
    } else {
      generateBtnText.textContent = 'Generate Images';
    }
  }

  bulkPrompts.addEventListener('input', updatePromptCount);

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

  loadSamplePromptsBtn.addEventListener('click', () => {
    const sample = `00.00-02.50 | Scene 1: Medium Action Shot, subject in dynamic motion, 35mm shallow depth of field
02.50-08.59 | Scene 2: Cinematic Close-Up detail shot, high emotional tension, soft volumetric lighting
08.59-16.42 | Scene 3: Extreme Wide Establishing Angle, sweeping cinematic horizon, atmospheric rim lighting
16.42-22.94 | Scene 4: Over-The-Shoulder narrative framing, award-winning cinematography, soft bokeh`;

    bulkPrompts.value = sample;
    updatePromptCount();
    showToast('Loaded 4 sample scenes', 'success');
  });

  // ================= 5. Default 4-Dummy State (Single Row) + Centered Down Arrow =================
  const dummyGridHTML = `
    <div class="dummy-card">
      <div class="dummy-preview">
        <span class="timestamp-badge">00.00 - 04.35</span>
        <span class="card-index">#01</span>
        <div style="font-size: 20px; color: #38BDF8; margin-top: 10px;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #1 Ready</span>
      </div>
      <div class="dummy-meta">
        <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
          <span style="font-size:8.5px; color:#10B981; font-family:var(--font-mono); font-weight:700;">📁 01_00.00-04.35.png</span>
        </div>
        <div class="dummy-line" style="width: 80%;"></div>
        <div class="dummy-line" style="width: 50%;"></div>
      </div>
    </div>
    <div class="dummy-card">
      <div class="dummy-preview">
        <span class="timestamp-badge">04.35 - 07.83</span>
        <span class="card-index">#02</span>
        <div style="font-size: 20px; color: #38BDF8; margin-top: 10px;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #2 Ready</span>
      </div>
      <div class="dummy-meta">
        <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
          <span style="font-size:8.5px; color:#10B981; font-family:var(--font-mono); font-weight:700;">📁 02_04.35-07.83.png</span>
        </div>
        <div class="dummy-line" style="width: 70%;"></div>
        <div class="dummy-line" style="width: 40%;"></div>
      </div>
    </div>
    <div class="dummy-card">
      <div class="dummy-preview">
        <span class="timestamp-badge">07.83 - 11.74</span>
        <span class="card-index">#03</span>
        <div style="font-size: 20px; color: #38BDF8; margin-top: 10px;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #3 Ready</span>
      </div>
      <div class="dummy-meta">
        <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
          <span style="font-size:8.5px; color:#10B981; font-family:var(--font-mono); font-weight:700;">📁 03_07.83-11.74.png</span>
        </div>
        <div class="dummy-line" style="width: 85%;"></div>
        <div class="dummy-line" style="width: 55%;"></div>
      </div>
    </div>
    <div class="dummy-card">
      <div class="dummy-preview">
        <span class="timestamp-badge">11.74 - 16.52</span>
        <span class="card-index">#04</span>
        <div style="font-size: 20px; color: #38BDF8; margin-top: 10px;">🖼️</div>
        <span style="font-size: 9.5px; color: #64748B; font-weight: 700;">Shot #4 Ready</span>
      </div>
      <div class="dummy-meta">
        <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
          <span style="font-size:8.5px; color:#10B981; font-family:var(--font-mono); font-weight:700;">📁 04_11.74-16.52.png</span>
        </div>
        <div class="dummy-line" style="width: 75%;"></div>
        <div class="dummy-line" style="width: 45%;"></div>
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
    galleryGrid.innerHTML = dummyGridHTML;
    statTotal.textContent = '0';
    statGenerated.textContent = '0';
    statRemaining.textContent = '0';
    progressBar.style.display = 'none';
    progressFill.style.width = '0%';
    downloadZipBtn.disabled = true;
  }

  clearGalleryBtn.addEventListener('click', () => {
    resetGalleryToDummy();
    showToast('Gallery cleared', 'info');
  });

  globalResetBtn.addEventListener('click', () => {
    if (confirm('Reset RenderX Studio? This will clear all prompts and generated gallery.')) {
      bulkPrompts.value = '';
      updatePromptCount();
      resetGalleryToDummy();
      showToast('Workspace reset to clean state', 'success');
    }
  });

  // ================= 6. Card Rendering (4-Column Layout) =================
  function renderPlaceholderCards(items) {
    galleryGrid.innerHTML = '';
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.id = `card-${item.index}`;

      const fn = item.filename || `0${item.index}_${item.cleanTimestamp}.png`;

      card.innerHTML = `
        <div class="card-preview aspect-${state.aspectRatio}" id="preview-${item.index}">
          <span class="timestamp-badge">${item.timestamp}</span>
          <span class="card-index">#${String(item.index).padStart(2, '0')}</span>
          <div class="card-loading" id="loading-${item.index}">
            <div class="spinner"></div>
            <span>Waiting in queue...</span>
          </div>
        </div>
        <div class="card-meta">
          <span class="card-filename">📁 ${fn}</span>
          <div class="card-prompt-text" title="${item.prompt}">${item.prompt}</div>
          <div class="card-actions">
            <button class="btn-card-action" data-action="edit" data-index="${item.index}">Edit</button>
            <button class="btn-card-action btn-regen" data-action="regen" data-index="${item.index}">Regen</button>
          </div>
        </div>
      `;

      galleryGrid.appendChild(card);
    });
  }

  function updateCardLoading(index, statusText = 'Generating scene...') {
    const loadingEl = document.getElementById(`loading-${index}`);
    if (loadingEl) {
      loadingEl.querySelector('span').textContent = statusText;
    }
  }

  function updateCardSuccess(item) {
    const previewEl = document.getElementById(`preview-${item.index}`);
    const cardEl = document.getElementById(`card-${item.index}`);
    if (!previewEl || !cardEl) return;

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
        charLock: charLockToggle.checked,
        charDesc: charDesc.value,
        charImage: state.charImageBase64,
        styleLock: styleLockToggle.checked,
        styleDesc: styleDesc.value,
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
    generateAllBtn.disabled = true;
    generateBtnText.textContent = 'Generating...';
    progressBar.style.display = 'block';

    const total = itemsToRun.length;
    let completedCount = 0;

    statTotal.textContent = state.items.length;
    statRemaining.textContent = total;

    let currentIndex = 0;

    async function worker() {
      while (currentIndex < itemsToRun.length && !state.shouldAbort) {
        const item = itemsToRun[currentIndex++];
        await generateSingleItem(item);
        completedCount++;

        statGenerated.textContent = state.items.filter(it => it.status === 'done').length;
        statRemaining.textContent = Math.max(0, total - completedCount);
        const percent = Math.round((completedCount / total) * 100);
        progressFill.style.width = `${percent}%`;
      }
    }

    const workerCount = Math.min(state.concurrency, itemsToRun.length);
    const workers = Array.from({ length: workerCount }, () => worker());

    await Promise.all(workers);

    state.isGenerating = false;
    generateAllBtn.disabled = false;
    updatePromptCount();

    const successCount = state.items.filter(it => it.status === 'done').length;
    if (successCount > 0) {
      downloadZipBtn.disabled = false;
      showToast(`Batch completed: ${successCount} scenes ready!`, 'success');
    } else {
      showToast('Batch encountered issues. Check errors or Canvas session.', 'error');
    }
  }

  // Generate All Handler
  generateAllBtn.addEventListener('click', async () => {
    if (state.isGenerating) return;

    const rawText = bulkPrompts.value.trim();
    if (!rawText) {
      showToast('Please enter timeline prompts in the input box', 'error');
      return;
    }

    const parsed = window.TimelineParser.parse(rawText);
    if (parsed.length === 0) {
      showToast('No valid prompts detected. Use format: 00.00-02.50 | Prompt', 'error');
      return;
    }

    state.items = parsed.map(p => ({
      ...p,
      blob: null,
      objectUrl: null,
      filename: null,
      status: 'pending'
    }));

    renderPlaceholderCards(state.items);
    await runBatchQueue(state.items);
  });

  // Card Action Handlers
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
      statGenerated.textContent = state.items.filter(it => it.status === 'done').length;
    }
  });

  // Lightbox Modal
  function openLightbox(item) {
    currentLightboxItem = item;
    lightboxImg.src = item.objectUrl;
    lightboxTitle.textContent = `Scene #${item.index} (${item.timestamp})`;
    lightboxPrompt.textContent = item.prompt;
    lightboxModal.style.display = 'flex';
  }

  closeLightboxBtn.addEventListener('click', () => { lightboxModal.style.display = 'none'; });

  lightboxDownloadBtn.addEventListener('click', () => {
    if (!currentLightboxItem || !currentLightboxItem.blob) return;
    const a = document.createElement('a');
    a.href = currentLightboxItem.objectUrl;
    a.download = currentLightboxItem.filename || `Scene_${currentLightboxItem.index}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // Edit Modal
  function openEditModal(item) {
    currentEditItem = item;
    editTimestampInput.value = item.timestamp;
    editPromptInput.value = item.prompt;
    editPromptModal.style.display = 'flex';
  }

  closeEditPromptBtn.addEventListener('click', () => { editPromptModal.style.display = 'none'; });

  saveAndRegenBtn.addEventListener('click', async () => {
    if (!currentEditItem) return;

    currentEditItem.timestamp = editTimestampInput.value.trim() || currentEditItem.timestamp;
    currentEditItem.cleanTimestamp = currentEditItem.timestamp.replace(/\s+/g, '').replace(/s$/i, '');
    currentEditItem.prompt = editPromptInput.value.trim() || currentEditItem.prompt;

    const cardEl = document.getElementById(`card-${currentEditItem.index}`);
    if (cardEl) {
      cardEl.querySelector('.timestamp-badge').textContent = currentEditItem.timestamp;
      cardEl.querySelector('.card-prompt-text').textContent = currentEditItem.prompt;
      cardEl.querySelector('.card-prompt-text').title = currentEditItem.prompt;
    }

    editPromptModal.style.display = 'none';
    showToast(`Regenerating Scene #${currentEditItem.index}...`);
    await generateSingleItem(currentEditItem);
  });

  // Download All ZIP
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

});
