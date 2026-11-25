/**
 * RenderX Image Studio - Desktop Production Studio Controller (v2.0)
 * Multi-Profile Chrome Cluster (8 Accounts) + Gemini Canvas & Google Flow
 * Connects to FastAPI/Playwright Backend via REST & WebSocket (Zero Extension Code)
 */

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    engine: 'gemini-canvas',       // 'gemini-canvas' | 'google-flow'
    subMode: 'image',              // 'image' | 'text-to-video' | 'image-to-video'
    aspectRatio: '1:1',            // '1:1' | '16:9' | '9:16'
    isGenerating: false,
    items: [],
    profiles: [],
    flowReferenceImage: null,
    charImageBase64: null,
    styleImageBase64: null
  };

  const $ = (id) => document.getElementById(id);

  // Topbar Elements
  const sessionDot = $('sessionDot');
  const sessionStatusText = $('sessionStatusText');
  const btnOpenOutputs = $('btnSidePanelInfo');
  const sessionInfoBtn = $('sessionInfoBtn');
  const globalResetBtn = $('globalResetBtn');

  // Box 1: Engine, Cluster & Aspect Elements
  const btnEngineCanvas = $('btnEngineCanvas');
  const btnEngineFlow = $('btnEngineFlow');
  const btnEngineVerifyOk = $('btnEngineVerifyOk');
  const engineOkLabel = $('engineOkLabel');
  const engineActiveBadge = $('engineActiveBadge');
  const projectNameInput = $('projectNameInput');
  const createProjectToggle = $('createProjectToggle');
  const flowAgentToggle = $('flowAgentToggle');
  const clusterStateText = $('clusterStateText');
  const clusterProfileName = $('clusterProfileName');
  const btnManageProfiles = $('btnManageProfiles');
  const clusterProfilesStrip = $('clusterProfilesStrip');
  const flowSubmodesWrap = $('flowSubmodesWrap');
  const flowSubmodeBtnRow = $('flowSubmodeBtnRow');
  const flowInitFrameSlot = $('flowInitFrameSlot');
  const flowInitFrameInput = $('flowInitFrameInput');
  const flowInitFramePreview = $('flowInitFramePreview');
  const flowInitFrameImg = $('flowInitFrameImg');
  const flowInitFrameRemoveBtn = $('flowInitFrameRemoveBtn');
  const aspectBtnGroup = $('aspectBtnGroup');

  // Box 2 & 3: Character & Style Consistency
  const charToggle = $('charToggle');
  const charPromptText = $('charPromptText');
  const charInputFile = $('charInputFile');
  const charPreviewBox = $('charPreviewBox');
  const charPreviewImg = $('charPreviewImg');
  const charRemoveBtn = $('charRemoveBtn');

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
  const btnRetryFailedBatch = $('btnRetryFailedBatch');
  const btnRefreshWorkflow = $('btnRefreshWorkflow');
  const clearGalleryBtn = $('clearGalleryBtn');
  const downloadZipTopBtn = $('downloadZipTopBtn');
  const pushTimelineBtn = $('pushTimelineBtn');
  const thumbnailGrid = $('thumbnailGrid');

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

  // Multi-Profile Modal
  const sessionInfoModal = $('sessionInfoModal');
  const closeSessionModalBtn = $('closeSessionModalBtn');
  const btnAddProfileSlot = $('btnAddProfileSlot');
  const btnImportProProfiles = $('btnImportProProfiles');
  const btnOpenAllUnlogged = $('btnOpenAllUnlogged');
  const btnRefreshProfiles = $('btnRefreshProfiles');
  const profilesListContainer = $('profilesListContainer');

  // Toast
  const toastCapsule = $('toastCapsule');
  const toastText = $('toastText');

  function showToast(msg, duration = 3000) {
    if (!toastCapsule || !toastText) return;
    toastText.textContent = msg;
    toastCapsule.classList.add('show');
    setTimeout(() => toastCapsule.classList.remove('show'), duration);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function updateDiagnosticLine(text, isError = false) {
    if (!galleryTimelineHint) return;
    galleryTimelineHint.textContent = text;
    galleryTimelineHint.style.color = isError ? '#F87171' : '#38BDF8';
  }

  // Smooth wheel passthrough across panels
  document.addEventListener('wheel', (e) => {
    const sidebarScroll = $('sidebarScroll');
    const galleryContainer = $('galleryContainer');
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.closest('#sidebarScroll') || e.target.closest('#galleryContainer'))) {
      return;
    }
    const target = (e.clientX < 365) ? sidebarScroll : galleryContainer;
    if (target) target.scrollBy({ top: e.deltaY, behavior: 'smooth' });
  }, { passive: true });

  // ================= 1. Desktop WebSocket & REST Bridge =================
  let ws = null;

  async function verifyPrimaryEngine(showNotice = false) {
    if (btnEngineVerifyOk) {
      btnEngineVerifyOk.classList.remove('signal-green', 'signal-red');
    }
    if (clusterStateText) {
      clusterStateText.className = 'cluster-status-val reconnecting';
      clusterStateText.textContent = '🟡 Reconnecting...';
    }
    try {
      const res = await apiJson('/api/engine/check', 'POST', { engine: state.engine });
      if (res && res.connected) {
        if (btnEngineVerifyOk) btnEngineVerifyOk.classList.add('signal-green');
        if (engineOkLabel) engineOkLabel.textContent = 'OK';
        if (sessionDot) sessionDot.className = 'dot';
        if (clusterStateText) {
          clusterStateText.className = 'cluster-status-val connected';
          clusterStateText.textContent = `🟢 Connected (${res.enabledLoggedCount || res.loggedInCount || 1} Profile Ready)`;
        }
        if (showNotice) showToast(`🟢 ${res.message || 'Connected & Ready!'}`);
      } else {
        if (btnEngineVerifyOk) btnEngineVerifyOk.classList.add('signal-red');
        if (engineOkLabel) engineOkLabel.textContent = 'OK';
        if (sessionDot) sessionDot.className = 'dot red';
        if (clusterStateText) {
          clusterStateText.className = 'cluster-status-val disconnected';
          clusterStateText.textContent = (res && res.networkOk === false)
            ? '🔴 Disconnected (No Network)'
            : '🔴 Not Connected (Login Required)';
        }
        if (showNotice) showToast(`🔴 ${res?.message || 'Not connected — Login a Chrome profile first'}`);
      }
      return res;
    } catch (err) {
      if (btnEngineVerifyOk) btnEngineVerifyOk.classList.add('signal-red');
      if (sessionDot) sessionDot.className = 'dot amber';
      if (clusterStateText) {
        clusterStateText.className = 'cluster-status-val reconnecting';
        clusterStateText.textContent = '🟡 Reconnecting...';
      }
      if (showNotice) showToast('🔴 Backend unreachable — reconnecting...');
      return null;
    }
  }

  function connectWebSocket() {
    const proto = (window.location.protocol === 'https:') ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (clusterStateText) {
        clusterStateText.className = 'cluster-status-val reconnecting';
        clusterStateText.textContent = '🟡 Reconnecting...';
      }
      refreshProfiles().then(() => verifyPrimaryEngine(false));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleServerEvent(msg);
      } catch (e) {}
    };

    ws.onclose = () => {
      if (sessionDot) sessionDot.className = 'dot amber';
      if (btnEngineVerifyOk) btnEngineVerifyOk.classList.remove('signal-green', 'signal-red');
      if (clusterStateText) {
        clusterStateText.className = 'cluster-status-val reconnecting';
        clusterStateText.textContent = '🟡 Reconnecting...';
      }
      setTimeout(connectWebSocket, 1500);
    };
  }

  async function apiJson(path, method = 'GET', body = null) {
    const opts = { method, headers: {} };
    if (body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(path, opts);
    return await resp.json();
  }

  // ================= 2. 8-Profile Chrome Cluster Manager =================
  async function refreshProfiles() {
    try {
      const data = await apiJson('/api/profiles');
      if (data && data.success) {
        state.profiles = data.profiles || [];
        if (btnImportProProfiles) {
          const proCnt = Number(data.proImportCount || 0);
          btnImportProProfiles.style.display = proCnt > 0 ? 'inline-flex' : 'none';
          if (proCnt > 0) btnImportProProfiles.textContent = `📥 Import Pro (${proCnt})`;
        }
        renderClusterStrip();
        renderProfilesModalList();
      }
    } catch (e) {}
  }

  function renderClusterStrip() {
    const enabledCount = state.profiles.filter(p => p.enabled).length;
    const loggedCount = state.profiles.filter(p => p.logged_in).length;

    if (clusterProfileName) {
      clusterProfileName.textContent = `${enabledCount} / ${state.profiles.length} Active (${loggedCount} Logged In)`;
    }

    if (!clusterProfilesStrip) return;
    clusterProfilesStrip.innerHTML = '';

    state.profiles.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `profile-slot-pill${p.enabled ? ' enabled' : ''}${p.logged_in ? ' logged-in' : ''}`;
      btn.title = `${p.name}${p.email ? ' - ' + p.email : ''} (${p.logged_in ? 'Signed In' : 'Needs Login'}) - Click to toggle`;
      btn.innerHTML = `<span class="profile-slot-dot"></span><span>P${i + 1}</span>`;
      btn.onclick = async () => {
        await apiJson(`/api/profiles/${p.id}/toggle`, 'POST', { enabled: !p.enabled });
        refreshProfiles();
      };
      clusterProfilesStrip.appendChild(btn);
    });
  }

  function renderProfilesModalList() {
    if (!profilesListContainer) return;
    profilesListContainer.innerHTML = '';

    state.profiles.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'profile-row-card';
      const emailLabel = p.email ? escapeHtml(p.email) : (p.logged_in ? 'Google Cookies Verified' : 'Not Signed In');
      row.innerHTML = `
        <div class="profile-row-left">
          <input type="checkbox" class="prof-enable-cb" data-id="${p.id}" ${p.enabled ? 'checked' : ''} title="Use in parallel cluster">
          <div class="profile-row-meta">
            <div class="profile-row-title">
              <span>${escapeHtml(p.name)}</span>
              <span style="font-size:9px; color:#64748B;">#${idx + 1}</span>
            </div>
            <div class="profile-row-badges">
              <span class="p-badge ${p.logged_in ? 'ok' : ''}">${p.logged_in ? '✓ ' + emailLabel : 'Needs Google Login'}</span>
              <span class="p-badge ${p.is_worker_active ? 'sync' : ''}">${p.is_worker_active ? '⚡ Active Worker' : (p.logged_in ? 'Ready (Canvas & Flow)' : 'Offline')}</span>
            </div>
          </div>
        </div>
        <div class="profile-row-actions">
          ${p.is_login_open
            ? `<button type="button" class="btn-prof-action success" data-prof-action="save-close" data-id="${p.id}">✅ Done / Refresh</button>`
            : `<button type="button" class="btn-prof-action primary" data-prof-action="login" data-id="${p.id}">🔑 Login (${state.engine === 'google-flow' ? 'Flow' : 'Gemini'})</button>`
          }
          ${p.is_worker_active ? `<button type="button" class="btn-prof-action" data-prof-action="focus" data-id="${p.id}" title="Bring background Chrome to front">👁️</button>` : ''}
          <button type="button" class="btn-prof-action" data-prof-action="folder" data-id="${p.id}" title="Open Chrome profile folder">📁</button>
          <button type="button" class="btn-prof-action danger" data-prof-action="reset" data-id="${p.id}" title="Clear session cookies">🗑️</button>
        </div>
      `;
      profilesListContainer.appendChild(row);
    });
  }

  if (profilesListContainer) {
    profilesListContainer.addEventListener('change', async (e) => {
      const cb = e.target.closest('.prof-enable-cb');
      if (!cb) return;
      await apiJson(`/api/profiles/${cb.dataset.id}/toggle`, 'POST', { enabled: cb.checked });
      refreshProfiles();
    });

    profilesListContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-prof-action]');
      if (!btn) return;
      const pid = btn.dataset.id;
      const action = btn.dataset.profAction;

      if (action === 'login') {
        showToast(`Opening real Chrome for ${pid} (${state.engine === 'google-flow' ? 'Google Flow' : 'Gemini Canvas'})...`);
        await apiJson(`/api/profiles/${pid}/login`, 'POST', { engine: state.engine });
        refreshProfiles();
      } else if (action === 'save-close') {
        await apiJson(`/api/profiles/${pid}/close-login`, 'POST');
        showToast(`Saved & verified session for ${pid}`);
        refreshProfiles();
      } else if (action === 'focus') {
        await apiJson(`/api/profiles/${pid}/focus`, 'POST');
      } else if (action === 'folder') {
        await apiJson(`/api/profiles/${pid}/open-folder`, 'POST');
      } else if (action === 'reset') {
        if (confirm(`Reset saved cookies & session for ${pid}?`)) {
          await apiJson(`/api/profiles/${pid}`, 'DELETE');
          showToast(`Reset ${pid}`);
          refreshProfiles();
        }
      }
    });
  }

  if (btnManageProfiles && sessionInfoModal) {
    btnManageProfiles.addEventListener('click', () => {
      refreshProfiles();
      sessionInfoModal.classList.add('open');
    });
  }

  if (btnAddProfileSlot) {
    btnAddProfileSlot.addEventListener('click', async () => {
      await apiJson('/api/profiles', 'POST');
      showToast('Added new Chrome profile slot');
      refreshProfiles();
    });
  }

  if (btnOpenAllUnlogged) {
    btnOpenAllUnlogged.addEventListener('click', async () => {
      showToast('Opening Chrome login windows for all unlogged accounts...');
      const res = await apiJson('/api/profiles/open-all', 'POST', { engine: state.engine });
      showToast(res?.message || 'Opened unlogged profiles');
      refreshProfiles();
    });
  }

  if (btnImportProProfiles) {
    btnImportProProfiles.addEventListener('click', async () => {
      showToast('Importing signed-in profiles from RenderX Studio Pro...');
      const res = await apiJson('/api/profiles/import-pro', 'POST');
      showToast(res?.message || 'Import complete');
      refreshProfiles();
    });
  }

  if (btnRefreshProfiles) {
    btnRefreshProfiles.addEventListener('click', async () => {
      await refreshProfiles();
      showToast('Profiles & Google login cookies refreshed');
    });
  }

  if (btnOpenOutputs) {
    btnOpenOutputs.addEventListener('click', async () => {
      await apiJson('/api/open-output-folder', 'POST');
      showToast('Opened Outputs folder');
    });
  }

  // ================= 3. Dual Engine Switching =================
  function setEngine(engine) {
    state.engine = engine;
    if (engine === 'google-flow') {
      if (btnEngineCanvas) btnEngineCanvas.classList.remove('active');
      if (btnEngineFlow) btnEngineFlow.classList.add('active');
      if (engineActiveBadge) engineActiveBadge.textContent = 'FLOW';
      if (flowSubmodesWrap) flowSubmodesWrap.style.display = 'flex';
      if (sessionStatusText) sessionStatusText.textContent = 'Google Flow (Desktop Cluster)';
      updateGenerateButtonText();
      verifyPrimaryEngine(false);
      showToast('Switched to Google Flow Cluster Pipeline');
    } else {
      if (btnEngineFlow) btnEngineFlow.classList.remove('active');
      if (btnEngineCanvas) btnEngineCanvas.classList.add('active');
      if (engineActiveBadge) engineActiveBadge.textContent = 'CANVAS';
      if (flowSubmodesWrap) flowSubmodesWrap.style.display = 'none';
      if (sessionStatusText) sessionStatusText.textContent = 'Gemini Canvas (Desktop Cluster)';
      updateGenerateButtonText();
      verifyPrimaryEngine(false);
      showToast('Switched to Gemini Canvas Cluster Pipeline');
    }
  }

  if (btnEngineCanvas) btnEngineCanvas.addEventListener('click', () => setEngine('gemini-canvas'));
  if (btnEngineFlow) btnEngineFlow.addEventListener('click', () => setEngine('google-flow'));
  if (btnEngineVerifyOk) btnEngineVerifyOk.addEventListener('click', () => verifyPrimaryEngine(true));

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

  // ================= 4. Aspect Ratio & Consistency Controls =================
  if (aspectBtnGroup) {
    aspectBtnGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-aspect');
      if (!btn) return;
      aspectBtnGroup.querySelectorAll('.btn-aspect').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.aspectRatio = btn.dataset.aspect;
      const aspectClass = `aspect-${state.aspectRatio === '1:1' ? 'square' : (state.aspectRatio === '16:9' ? 'landscape' : 'portrait')}`;
      document.querySelectorAll('.card-preview').forEach(box => {
        box.className = `card-preview ${aspectClass}`;
      });
      showToast(`Aspect set to ${btn.dataset.label}`);
    });
  }

  function setupUploadHandler(fileInput, thumbBox, imgEl, removeBtn, stateKey, toastLabel, toggleEl) {
    if (!fileInput || !imgEl) return;
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state[stateKey] = ev.target.result;
        imgEl.src = ev.target.result;
        if (thumbBox) thumbBox.style.display = 'flex';
        if (toggleEl && !toggleEl.checked) toggleEl.checked = true;
        showToast(`${toastLabel} image attached & auto-locked`);
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

  setupUploadHandler(charInputFile, charPreviewBox, charPreviewImg, charRemoveBtn, 'charImageBase64', 'Character', charToggle);
  setupUploadHandler(styleInputFile, stylePreviewBox, stylePreviewImg, styleRemoveBtn, 'styleImageBase64', 'Style', styleToggle);

  // ================= 5. Negative Prompts =================
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
          timestamp,
          cleanTimestamp: compactTs.replace(/[^a-zA-Z0-9.-]/g, '_'),
          rawPrompt: cleanPrompt
        };
      });
  }

  function updatePromptCount() {
    const raw = promptsTextarea ? promptsTextarea.value : '';
    const count = parsePromptLines(raw).length;
    if (promptCountBadge) promptCountBadge.textContent = count;
    updateGenerateButtonText(count);
  }

  function updateGenerateButtonText(countOverride) {
    if (!generateBtnText) return;
    const count = (typeof countOverride === 'number') ? countOverride : parsePromptLines(promptsTextarea ? promptsTextarea.value : '').length;
    const isVideo = (state.engine === 'google-flow' && state.subMode.includes('video'));
    const typeLabel = isVideo ? 'Videos' : 'Images';
    generateBtnText.textContent = count > 0 ? `⚡ Generate ${count} ${typeLabel}` : `⚡ Generate ${typeLabel}`;
  }

  if (promptsTextarea) promptsTextarea.addEventListener('input', updatePromptCount);

  if (loadSampleScriptBtn && promptsTextarea) {
    loadSampleScriptBtn.addEventListener('click', () => {
      promptsTextarea.value = `00.00-04.35 | Scene 1: Medium Action Shot, subject in dynamic motion, 35mm shallow depth of field
04.35-07.83 | Scene 2: Cinematic Close-Up detail shot, high emotional tension, soft volumetric lighting
07.83-11.74 | Scene 3: Extreme Wide Establishing Angle, sweeping cinematic horizon, atmospheric haze
11.74-16.52 | Scene 4: Over-The-Shoulder narrative framing, award-winning cinematography, soft bokeh
16.52-22.94 | Scene 5: Golden hour dramatic sunset with volumetric rim light`;
      updatePromptCount();
      showToast('Loaded 5 sample timeline scenes');
    });
  }

  if (autoSyncBtn && promptsTextarea) {
    autoSyncBtn.addEventListener('click', () => {
      const lines = parsePromptLines(promptsTextarea.value);
      if (lines.length === 0) return showToast('No prompts to sync');
      promptsTextarea.value = lines.map(l => `${l.timestamp} | ${l.rawPrompt}`).join('\n');
      updatePromptCount();
      showToast('Timestamps formatted cleanly');
    });
  }

  // ================= 7. Standby Grid =================
  const standbyCardsHTML = thumbnailGrid ? thumbnailGrid.innerHTML : '';

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
      showToast('Gallery reset to standby grid (prompts kept intact)');
    });
  }

  if (btnRefreshWorkflow) {
    btnRefreshWorkflow.addEventListener('click', async () => {
      try { await apiJson('/api/batch/stop', 'POST'); } catch (e) {}
      state.isGenerating = false;
      if (generateBatchBtn) generateBatchBtn.disabled = false;
      if (stopBatchBtn) stopBatchBtn.disabled = true;
      if (btnRetryFailedBatch) btnRetryFailedBatch.disabled = true;

      // Reset gallery to standby without touching promptsTextarea!
      resetGalleryToStandby();
      updateDiagnosticLine('Timeline Ordered: Standby Ready', false);

      // Reset engine & workflow options to Default Mode
      state.subMode = 'image';
      if (flowSubmodeBtnRow) {
        flowSubmodeBtnRow.querySelectorAll('.btn-submode-opt').forEach(b => b.classList.toggle('active', b.dataset.submode === 'image'));
      }
      if (flowInitFrameSlot) flowInitFrameSlot.style.display = 'none';
      state.flowReferenceImage = null;
      if (flowInitFrameInput) flowInitFrameInput.value = '';
      if (flowInitFramePreview) flowInitFramePreview.style.display = 'none';

      // Default aspect ratio 1:1 Square
      state.aspectRatio = '1:1';
      if (aspectBtnGroup) {
        aspectBtnGroup.querySelectorAll('.btn-aspect').forEach(b => b.classList.toggle('active', b.dataset.aspect === '1:1'));
      }
      document.querySelectorAll('.card-preview').forEach(box => {
        box.className = 'card-preview aspect-square';
      });

      // Reset consistency toggles OFF
      if (charToggle) charToggle.checked = false;
      if (styleToggle) styleToggle.checked = false;
      state.charImageBase64 = null;
      state.styleImageBase64 = null;
      if (charPreviewBox) charPreviewBox.style.display = 'none';
      if (stylePreviewBox) stylePreviewBox.style.display = 'none';
      if (customNegativeInput) customNegativeInput.value = '';

      setEngine('gemini-canvas');
      showToast('Workflow refreshed to Default Mode (left prompts preserved)');
    });
  }

  function revokeGalleryBlobUrls() {
    (state.items || []).forEach(it => {
      if (it && typeof it.dataUrl === 'string' && it.dataUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(it.dataUrl); } catch {}
      }
    });
  }

  if (globalResetBtn) {
    globalResetBtn.addEventListener('click', () => {
      if (confirm('Reset RenderX Studio? This clears all prompts and gallery shots.')) {
        revokeGalleryBlobUrls();
        if (promptsTextarea) promptsTextarea.value = '';
        updatePromptCount();
        resetGalleryToStandby();
        showToast('Workspace reset');
      }
    });
  }

  // ================= 8. Live Gallery Cards =================
  function renderLiveGrid(items) {
    if (!thumbnailGrid) return;
    revokeGalleryBlobUrls();
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
          <span class="timestamp-badge">🛡️ ${escapeHtml(item.timestamp)}</span>
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
            <span class="card-filename">📁 ${escapeHtml(filename)}</span>
            <span class="card-idx">#${paddedIdx}</span>
          </div>
          <p class="card-prompt-text" title="${escapeHtml(item.rawPrompt)}">${escapeHtml(item.rawPrompt)}</p>
          <div class="card-actions-single-row">
            <button type="button" class="btn-card-action" data-action="edit" data-index="${item.index}">✏️ Edit</button>
            <button type="button" class="btn-card-action btn-regen" data-action="retry" data-index="${item.index}">🎲 Re-Roll</button>
            <button type="button" class="btn-card-action" data-action="save" data-index="${item.index}">💾 Save</button>
            ${!isVideo ? `<button type="button" class="btn-card-action btn-flow" data-action="animate" data-index="${item.index}" title="Animate in Flow">🌊 Flow</button>` : ''}
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
      badge.textContent = statusText;
    }
  }

  function updateCardCompleted(item) {
    const previewBox = document.getElementById(`previewBox-${item.index}`);
    const badge = document.getElementById(`badge-${item.index}`);
    if (!previewBox) return;
    if (badge) {
      badge.className = 'badge-done';
      badge.textContent = 'Ready';
      badge.style.color = '';
      badge.style.borderColor = '';
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

  function updateCardFailed(index, errorMsg, httpStatus = 0) {
    const previewBox = document.getElementById(`previewBox-${index}`);
    const badge = document.getElementById(`badge-${index}`);
    if (!previewBox) return;
    if (badge) {
      badge.className = 'badge-standby';
      badge.textContent = httpStatus ? `HTTP ${httpStatus}` : 'Failed';
      badge.style.color = '#EF4444';
      badge.style.borderColor = '#EF4444';
    }
    previewBox.innerHTML = `
      <div style="padding:10px; text-align:center; display:flex; flex-direction:column; gap:4px; overflow-y:auto; max-height:100%;">
        <span style="color:#F87171; font-weight:800; font-size:9.5px;">${httpStatus ? `Shot Failed (HTTP ${httpStatus})` : 'Shot Failed'}</span>
        <span style="font-size:8px; color:var(--text-muted); line-height:1.25; word-break:break-word;">${escapeHtml(errorMsg)}</span>
      </div>
    `;
  }

  // ================= 9. Batch Queue Execution =================
  window.triggerGenerateBatch = async function () {
    if (state.isGenerating) return showToast('Generation already in progress');

    const raw = promptsTextarea ? promptsTextarea.value.trim() : '';
    if (!raw) {
      showToast('Please enter prompts in Box 5');
      if (promptsTextarea) promptsTextarea.focus();
      return;
    }

    const parsed = parsePromptLines(raw);
    if (parsed.length === 0) return showToast('No valid prompts detected');

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

    renderLiveGrid(state.items);
    const activeProfiles = state.profiles.filter(p => p.enabled).length || 1;
    showToast(`Launching ${state.items.length} shots across ${activeProfiles} Chrome profile(s)...`);

    const resp = await apiJson('/api/batch/start', 'POST', {
      items: state.items,
      engine: state.engine,
      subMode: state.subMode,
      projectName: (projectNameInput && projectNameInput.value.trim()) ? projectNameInput.value.trim() : 'RenderX_Project_01',
      createNewProject: createProjectToggle ? Boolean(createProjectToggle.checked) : true,
      useFlowAgent: flowAgentToggle ? Boolean(flowAgentToggle.checked) : true,
      negPrompt: negPrompt || null,
      charDesc: charPrompt || null,
      styleDesc: stylePrompt || null,
      charImageBase64: (charToggle && charToggle.checked && state.charImageBase64) ? state.charImageBase64 : null,
      styleImageBase64: (styleToggle && styleToggle.checked && state.styleImageBase64) ? state.styleImageBase64 : null
    });
    if (!resp || !resp.success) {
      showToast(resp?.error || 'Could not start batch');
      finishQueue();
    } else {
      startPollSync();
    }
  };

  if (generateBatchBtn) generateBatchBtn.addEventListener('click', window.triggerGenerateBatch);

  if (stopBatchBtn) {
    stopBatchBtn.addEventListener('click', async () => {
      await apiJson('/api/batch/stop', 'POST');
      state.isGenerating = false;
      if (generateBatchBtn) generateBatchBtn.disabled = false;
      if (stopBatchBtn) stopBatchBtn.disabled = true;
      showToast('Generation halted');
    });
  }

  function handleServerEvent(msg) {
    if (!msg) return;
    if (msg.type === 'PROFILES_UPDATED') {
      refreshProfiles().then(() => verifyPrimaryEngine(false));
    } else if (msg.type === 'ITEM_STARTED') {
      const item = state.items.find(i => i.index === msg.index);
      if (item && item.status !== 'done') updateCardStatus(msg.index, 'Generating...');
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
      if (item && item.status !== 'done') item.status = 'failed';
      updateCardFailed(msg.index, msg.error || 'Failed', msg.httpStatus || 0);
      updateDiagnosticLine(`Shot #${msg.index} Error: ${msg.error}`, true);
      updateOverallProgress();
    } else if (msg.type === 'DIAGNOSTIC_LOG') {
      updateDiagnosticLine(msg.text || '', Boolean(msg.isError));
    } else if (msg.type === 'FAILOVER_SWITCH') {
      showFailoverAlert(msg.message, null);
      updateDiagnosticLine(msg.message || '', false);
      showToast(msg.message);
    } else if (msg.type === 'PROFILE_SETUP_REQUIRED') {
      showFailoverAlert(msg.message, msg.nextProfileId || null);
      updateDiagnosticLine(msg.message || '', true);
      showToast(msg.message, 'error');
    } else if (msg.type === 'BULK_PROJECT_STATUS') {
      updateBulkProjectStatus(msg);
    } else if (msg.type === 'BULK_FINISHED') {
      if (btnStartBulk) { btnStartBulk.disabled = false; btnStartBulk.textContent = '⚡ Start Bulk Projects'; }
      showToast(msg.stopped ? 'Bulk generation stopped' : 'Bulk generation finished & RAM freed!');
    } else if (msg.type === 'QUEUE_FINISHED') {
      syncBatchStateFromServer().finally(() => finishQueue());
    }
  }

  let pollSyncTimer = null;
  function startPollSync() {
    stopPollSync();
    pollSyncTimer = setInterval(syncBatchStateFromServer, 3000);
  }
  function stopPollSync() {
    if (pollSyncTimer) {
      clearInterval(pollSyncTimer);
      pollSyncTimer = null;
    }
  }

  async function syncBatchStateFromServer() {
    try {
      const res = await apiJson('/api/batch/state');
      if (!res || !res.success || !Array.isArray(res.items)) return;
      res.items.forEach(srv => {
        const local = state.items.find(i => i.index === srv.index);
        if (!local) return;
        if (srv.status === 'done' && srv.dataUrl && (local.status !== 'done' || !local.dataUrl)) {
          local.dataUrl = srv.dataUrl;
          local.status = 'done';
          if (srv.mediaType) local.mediaType = srv.mediaType;
          updateCardCompleted(local);
        } else if (srv.status === 'failed' && local.status !== 'failed' && local.status !== 'done') {
          local.status = 'failed';
          updateCardFailed(local.index, srv.error || 'Generation failed', 0);
        }
      });
      updateOverallProgress();
    } catch (e) {}
  }

  function updateOverallProgress() {
    const total = state.items.length;
    if (total === 0) return;
    const completed = state.items.filter(i => i.status === 'done').length;
    const failedCount = state.items.filter(i => i.status === 'failed').length;
    const pct = Math.round((completed / total) * 100);
    if (progressBarFill) progressBarFill.style.width = `${pct}%`;
    if (completed > 0) {
      if (downloadZipBtn) downloadZipBtn.disabled = false;
      if (downloadZipTopBtn) downloadZipTopBtn.disabled = false;
    }
    if (btnRetryFailedBatch) {
      btnRetryFailedBatch.disabled = state.isGenerating || failedCount === 0;
    }
    if (galleryReadyPill) {
      galleryReadyPill.textContent = (state.isGenerating && completed < total)
        ? `${completed} / ${total} READY (GENERATING...)`
        : `${completed} / ${total} READY (LIVE)`;
    }
  }

  function finishQueue() {
    stopPollSync();
    state.isGenerating = false;
    if (generateBatchBtn) generateBatchBtn.disabled = false;
    if (stopBatchBtn) stopBatchBtn.disabled = true;
    updateOverallProgress();
    const completed = state.items.filter(i => i.status === 'done').length;
    showToast(`Batch completed: ${completed} shots saved to outputs/`);
  }

  async function retrySpecificItems(targetItems) {
    if (!targetItems || targetItems.length === 0) return showToast('No failed shots to regenerate');
    if (state.isGenerating) return showToast('Wait for active batch or click Stop first');

    const charPrompt = (charToggle && charToggle.checked && charPromptText) ? charPromptText.value.trim() : '';
    const stylePrompt = (styleToggle && styleToggle.checked && stylePromptText) ? stylePromptText.value.trim() : '';
    const negPrompt = getCombinedNegativePrompt();

    targetItems.forEach(it => {
      it.status = 'generating';
      it.dataUrl = null;
      const previewBox = document.getElementById(`previewBox-${it.index}`);
      if (previewBox) {
        previewBox.innerHTML = `<div class="card-spinner" id="spinner-${it.index}"><div class="spin-circle"></div><span style="font-size:8.5px; color:var(--text-dim);" id="spinnerText-${it.index}">Regenerating...</span></div>`;
      }
      const badge = document.getElementById(`badge-${it.index}`);
      if (badge) {
        badge.style.color = '';
        badge.style.borderColor = '';
      }
      updateCardStatus(it.index, 'Retrying...');
    });

    state.isGenerating = true;
    if (generateBatchBtn) generateBatchBtn.disabled = true;
    if (stopBatchBtn) stopBatchBtn.disabled = false;
    if (btnRetryFailedBatch) btnRetryFailedBatch.disabled = true;
    startPollSync();

    const resp = await apiJson('/api/batch/start', 'POST', {
      items: targetItems,
      engine: state.engine,
      subMode: state.subMode,
      isRetry: true,
      negPrompt: negPrompt || null,
      charDesc: charPrompt || null,
      styleDesc: stylePrompt || null,
      charImageBase64: (charToggle && charToggle.checked && state.charImageBase64) ? state.charImageBase64 : null,
      styleImageBase64: (styleToggle && styleToggle.checked && state.styleImageBase64) ? state.styleImageBase64 : null
    });
    if (!resp || !resp.success) {
      showToast(resp?.error || 'Could not start regeneration');
      finishQueue();
    }
  }

  if (btnRetryFailedBatch) {
    btnRetryFailedBatch.addEventListener('click', () => {
      const failedItems = state.items.filter(i => i.status === 'failed');
      retrySpecificItems(failedItems);
    });
  }

  // ================= 10. Individual Card Actions =================
  if (thumbnailGrid) {
    thumbnailGrid.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-card-action');
      if (!btn) return;
      const action = btn.dataset.action;
      const index = parseInt(btn.dataset.index, 10);
      const item = state.items.find(i => i.index === index);

      if (action === 'save') {
        if (item && item.dataUrl) downloadDataUrl(item.dataUrl, item.filename || `shot_${index}.png`);
        else showToast(`Shot #${index} not yet ready`);
      } else if (action === 'retry' && item) {
        retrySpecificItems([item]);
      } else if (action === 'animate' && item && item.dataUrl) {
        setEngine('google-flow');
        state.subMode = 'image-to-video';
        state.flowReferenceImage = item.dataUrl;
        if (flowSubmodeBtnRow) {
          flowSubmodeBtnRow.querySelectorAll('.btn-submode-opt').forEach(b => b.classList.toggle('active', b.dataset.submode === 'image-to-video'));
        }
        if (flowInitFrameSlot) flowInitFrameSlot.style.display = 'flex';
        if (flowInitFrameImg) flowInitFrameImg.src = item.dataUrl;
        if (flowInitFramePreview) flowInitFramePreview.style.display = 'flex';
        showToast(`Shot #${index} loaded into Google Flow Image-to-Video`);
      } else if (action === 'edit' && item) {
        const newPrompt = prompt(`Edit prompt for Shot #${index}:`, item.rawPrompt);
        if (newPrompt && newPrompt !== item.rawPrompt) {
          item.rawPrompt = newPrompt;
          item.fullPrompt = newPrompt;
          const snip = document.querySelector(`#card-${index} .card-prompt-text`);
          if (snip) snip.textContent = newPrompt;
          showToast(`Shot #${index} prompt updated`);
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

  async function downloadBatchZip() {
    const readyItems = state.items.filter(i => i.status === 'done' && i.dataUrl);
    if (readyItems.length === 0) return showToast('No rendered media ready to download');
    if (typeof JSZip === 'undefined') return showToast('ZIP engine missing');

    const zip = new JSZip();
    let csv = 'Index,Timestamp,Filename,MediaType,Prompt\n';
    readyItems.forEach(item => {
      const ext = item.mediaType === 'video' ? 'mp4' : 'png';
      const fn = item.filename || `shot_${item.index}.${ext}`;
      csv += `${item.index},${item.timestamp},${fn},${item.mediaType},"${item.rawPrompt.replace(/"/g, '""')}"\n`;
      if (item.dataUrl.startsWith('data:')) zip.file(fn, item.dataUrl.split(',')[1], { base64: true });
      else zip.file(fn, item.dataUrl);
    });
    zip.file('timeline_metadata.csv', csv);

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, `RenderX_Studio_Shots_${new Date().toISOString().slice(0, 10)}.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  if (downloadZipBtn) downloadZipBtn.addEventListener('click', downloadBatchZip);
  if (downloadZipTopBtn) downloadZipTopBtn.addEventListener('click', downloadBatchZip);
  if (pushTimelineBtn) {
    pushTimelineBtn.addEventListener('click', async () => {
      await apiJson('/api/open-output-folder', 'POST');
      downloadBatchZip();
    });
  }

  // ================= 11. Lightbox & Profile Modals =================
  function openLightbox(item) {
    currentLightboxItem = item;
    if (!lightboxModal) return;
    if (lightboxTitle) lightboxTitle.textContent = `${item.filename || 'Shot'} (${item.timestamp})`;
    if (lightboxPromptText) lightboxPromptText.textContent = item.rawPrompt;
    if (item.mediaType === 'video') {
      if (lightboxImg) lightboxImg.style.display = 'none';
      if (lightboxVideo) { lightboxVideo.style.display = 'block'; lightboxVideo.src = item.dataUrl; }
      if (lightboxAnimateBtn) lightboxAnimateBtn.style.display = 'none';
    } else {
      if (lightboxVideo) lightboxVideo.style.display = 'none';
      if (lightboxImg) { lightboxImg.style.display = 'block'; lightboxImg.src = item.dataUrl; }
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
        showToast('Image ready in Google Flow Image-to-Video queue');
      }
    });
  }

  if (sessionInfoBtn && sessionInfoModal) {
    sessionInfoBtn.addEventListener('click', () => {
      refreshProfiles();
      sessionInfoModal.classList.add('open');
    });
  }
  if (closeSessionModalBtn && sessionInfoModal) {
    closeSessionModalBtn.addEventListener('click', () => sessionInfoModal.classList.remove('open'));
  }

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
        if (lightboxVideo) lightboxVideo.pause();
      }
    });
  });

  // ================= 12. Failover Notification & 4-Project Bulk Generation =================
  const failoverAlertBanner = document.getElementById('failoverAlertBanner');
  const failoverAlertText = document.getElementById('failoverAlertText');
  const btnFailoverLogin = document.getElementById('btnFailoverLogin');
  const btnDismissFailover = document.getElementById('btnDismissFailover');
  const btnBulkMode = document.getElementById('btnBulkMode');
  const btnBackSingle = document.getElementById('btnBackSingle');
  const bulkWorkspace = document.getElementById('bulkWorkspace');
  const sidebarContainer = document.getElementById('sidebarContainer');
  const singleGalleryArea = document.querySelector('.gallery-area');
  const bulkProjectsGrid = document.getElementById('bulkProjectsGrid');
  const bulkUnlockedBadge = document.getElementById('bulkUnlockedBadge');
  const btnStartBulk = document.getElementById('btnStartBulk');
  const btnStopBulk = document.getElementById('btnStopBulk');

  let pendingFailoverLoginPid = null;
  let bulkPairsCache = [];

  function showFailoverAlert(msg, loginPid) {
    if (!failoverAlertBanner || !failoverAlertText) return;
    failoverAlertText.textContent = msg || 'Profile failover alert';
    pendingFailoverLoginPid = loginPid || null;
    if (btnFailoverLogin) {
      btnFailoverLogin.style.display = loginPid ? 'inline-block' : 'none';
      if (loginPid) btnFailoverLogin.textContent = `🔑 Login P${loginPid.replace('acc', '')}`;
    }
    failoverAlertBanner.style.display = 'flex';
  }
  if (btnDismissFailover && failoverAlertBanner) {
    btnDismissFailover.addEventListener('click', () => { failoverAlertBanner.style.display = 'none'; });
  }
  if (btnFailoverLogin) {
    btnFailoverLogin.addEventListener('click', async () => {
      if (!pendingFailoverLoginPid) return;
      try {
        await fetch(`/api/profiles/${pendingFailoverLoginPid}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: state.engine || 'gemini-canvas' }),
        });
        showToast(`Opening Chrome login for P${pendingFailoverLoginPid.replace('acc', '')}...`);
      } catch {}
    });
  }

  function setBulkView(open) {
    if (!bulkWorkspace || !sidebarContainer || !singleGalleryArea) return;
    bulkWorkspace.style.display = open ? 'flex' : 'none';
    sidebarContainer.style.display = open ? 'none' : '';
    singleGalleryArea.style.display = open ? 'none' : '';
    if (btnBulkMode) btnBulkMode.classList.toggle('active', open);
  }

  async function loadAndRenderBulkPairs() {
    const res = await fetch('/api/bulk/pairs');
    const data = await res.json();
    bulkPairsCache = data.pairs || [];
    if (bulkUnlockedBadge) {
      bulkUnlockedBadge.textContent = `${data.unlockedProjects || 0} / 4 Projects Unlocked`;
    }
    if (!data.canEnableBulk) {
      showToast('Bulk Mode requires at least 2 logged-in profiles (e.g. P1 + P2) with a backup!', 'error');
      showFailoverAlert('⚠️ Bulk Mode locked: Login at least one full pair (P1 + P2) so every project has a backup profile.', 'acc2');
      if (sessionInfoModal) {
        refreshProfiles();
        sessionInfoModal.classList.add('open');
      }
      return false;
    }
    if (bulkProjectsGrid) {
      bulkProjectsGrid.innerHTML = '';
      bulkPairsCache.forEach(pair => {
        const i = pair.projectIndex;
        const card = document.createElement('div');
        card.id = `bulk-proj-${i}`;
        card.style.cssText = `background:#0A0F1D; border:1px solid ${pair.unlocked ? '#1E293B' : '#334155'}; border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px; opacity:${pair.unlocked ? '1' : '0.55'};`;
        const statusHtml = pair.unlocked
          ? `<span id="bulk-status-${i}" style="padding:2px 7px; border-radius:4px; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); color:#6EE7B7; font-size:9.5px; font-weight:800;">🔓 Ready (${pair.primaryLabel} → ${pair.backupLabel})</span>`
          : `<span id="bulk-status-${i}" style="padding:2px 7px; border-radius:4px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.4); color:#FCA5A5; font-size:9.5px; font-weight:800;">🔒 Locked: Login ${pair.primaryLabel} + ${pair.backupLabel}</span>`;
        card.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
            <strong style="font-size:12px; color:#F8FAFC;">Project ${i + 1} (${pair.primaryLabel} / ${pair.backupLabel})</strong>
            ${statusHtml}
          </div>
          <div style="display:grid; grid-template-columns:1.2fr 1fr 0.8fr; gap:6px;">
            <input type="text" id="bulk-name-${i}" value="Bulk_Project_0${i + 1}" placeholder="Project Name" ${pair.unlocked ? '' : 'disabled'} style="padding:5px 8px; font-size:10px; background:#050811; border:1px solid #1E293B; border-radius:6px; color:#E2E8F0;">
            <select id="bulk-engine-${i}" ${pair.unlocked ? '' : 'disabled'} style="padding:5px 6px; font-size:10px; background:#050811; border:1px solid #1E293B; border-radius:6px; color:#E2E8F0;">
              <option value="gemini-canvas">💎 Gemini Canvas</option>
              <option value="google-flow">🌊 Google Flow</option>
            </select>
            <select id="bulk-aspect-${i}" ${pair.unlocked ? '' : 'disabled'} style="padding:5px 6px; font-size:10px; background:#050811; border:1px solid #1E293B; border-radius:6px; color:#E2E8F0;">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <input type="text" id="bulk-char-${i}" placeholder="Character consistency..." ${pair.unlocked ? '' : 'disabled'} style="padding:5px 8px; font-size:10px; background:#050811; border:1px solid #1E293B; border-radius:6px; color:#E2E8F0;">
            <input type="text" id="bulk-style-${i}" placeholder="Style consistency..." ${pair.unlocked ? '' : 'disabled'} style="padding:5px 8px; font-size:10px; background:#050811; border:1px solid #1E293B; border-radius:6px; color:#E2E8F0;">
          </div>
          <textarea id="bulk-prompts-${i}" rows="4" placeholder="Enter prompts (one per line, optional 00.00-04.00 | prompt)..." ${pair.unlocked ? '' : 'disabled'} style="padding:6px 8px; font-size:10.5px; background:#050811; border:1px solid #1E293B; border-radius:6px; color:#F8FAFC; resize:vertical;"></textarea>
        `;
        bulkProjectsGrid.appendChild(card);
      });
    }
    return true;
  }

  function updateBulkProjectStatus(data) {
    const badge = document.getElementById(`bulk-status-${data.projectIndex}`);
    if (!badge) return;
    if (data.status === 'running') {
      badge.textContent = `⏳ Running on ${data.activeProfile}`;
      badge.style.color = '#7DD3FC';
    } else if (data.status === 'failover') {
      badge.textContent = `🔄 Switching to backup ${data.activeProfile}...`;
      badge.style.color = '#FCD34D';
    } else if (data.status === 'done' || data.status === 'partial') {
      badge.textContent = `✅ Done (${data.completedCount}/${data.total})`;
      badge.style.color = '#6EE7B7';
    }
  }

  if (btnBulkMode) {
    btnBulkMode.addEventListener('click', async () => {
      const ok = await loadAndRenderBulkPairs();
      if (ok) setBulkView(true);
    });
  }
  if (btnBackSingle) {
    btnBackSingle.addEventListener('click', () => setBulkView(false));
  }
  if (btnStartBulk) {
    btnStartBulk.addEventListener('click', async () => {
      const projects = [];
      let baseIdx = 1;
      bulkPairsCache.forEach(pair => {
        if (!pair.unlocked) return;
        const i = pair.projectIndex;
        const raw = (document.getElementById(`bulk-prompts-${i}`)?.value || '').trim();
        if (!raw) return;
        const aspect = document.getElementById(`bulk-aspect-${i}`)?.value || '16:9';
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const items = lines.map((line, k) => {
          const parsed = window.RenderXParser ? window.RenderXParser.parseLine(line, k + 1) : null;
          return {
            index: baseIdx++,
            rawPrompt: parsed ? parsed.prompt : line,
            prompt: parsed ? parsed.prompt : line,
            timestamp: parsed ? parsed.timestamp : `00.00-04.00`,
            cleanTimestamp: parsed ? parsed.cleanTimestamp : `shot_${k + 1}`,
            aspectRatio: aspect,
            status: 'pending',
          };
        });
        projects.push({
          projectIndex: i,
          projectName: document.getElementById(`bulk-name-${i}`)?.value || `Bulk_Project_0${i + 1}`,
          engine: document.getElementById(`bulk-engine-${i}`)?.value || 'gemini-canvas',
          subMode: 'image',
          useFlowAgent: true,
          charDesc: document.getElementById(`bulk-char-${i}`)?.value || '',
          styleDesc: document.getElementById(`bulk-style-${i}`)?.value || '',
          items,
        });
      });
      if (!projects.length) {
        showToast('Enter prompts in at least 1 unlocked Bulk Project!', 'error');
        return;
      }
      btnStartBulk.disabled = true;
      btnStartBulk.textContent = '⏳ Running Bulk...';
      try {
        const res = await fetch('/api/bulk/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projects }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || 'Failed to start bulk');
        showToast(`Started ${data.projectsStarted} Bulk project(s) with paired backup!`);
      } catch (err) {
        btnStartBulk.disabled = false;
        btnStartBulk.textContent = '⚡ Start Bulk Projects';
        showToast(err.message, 'error');
      }
    });
  }
  if (btnStopBulk) {
    btnStopBulk.addEventListener('click', async () => {
      await fetch('/api/batch/stop', { method: 'POST' });
      showToast('Stopping Bulk projects...');
    });
  }

  // Custom Canvas URL persistence
  const customCanvasUrlInput = document.getElementById('customCanvasUrlInput');
  const btnSaveCanvasUrl = document.getElementById('btnSaveCanvasUrl');
  async function loadCustomCanvasUrl() {
    if (!customCanvasUrlInput) return;
    try {
      const res = await fetch('/api/canvas-url');
      if (res.ok) {
        const data = await res.json();
        customCanvasUrlInput.value = data.canvas_url || '';
      }
    } catch {}
  }
  if (btnSaveCanvasUrl && customCanvasUrlInput) {
    btnSaveCanvasUrl.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/canvas-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvas_url: customCanvasUrlInput.value.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to save URL');
        customCanvasUrlInput.value = data.canvas_url;
        showToast(data.is_custom ? 'Custom Canvas URL saved!' : 'Reset to default Canvas URL');
      } catch (err) {
        showToast(err.message || 'Invalid Canvas URL', 'error');
      }
    });
  }

  // Init
  updatePromptCount();
  updateNegativeCount();
  loadCustomCanvasUrl();
  connectWebSocket();
});
