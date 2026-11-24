/**
 * RenderX Image Studio - Google Flow Account-Level Content Script
 * Injected into https://flow.google.com/* and https://labs.google/*
 * Direct DOM Automation for Bulk Image, Text-to-Video & Image-to-Video
 */

(function () {
  // Idempotency guard
  window.__renderexLoaded = true;
  console.log('[RenderX Flow] Content script active on:', window.location.href);

  /**
   * Helper: Convert DataURL to File object for init frame upload
   */
  function dataUrlToFile(dataUrl, filename = 'init_frame.png') {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }

  /**
   * Helper: Check if on project dashboard and auto-click "New project" / "Create"
   */
  async function handleProjectDashboardIfNeeded() {
    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const newProjectBtn = allButtons.find(b => {
      const text = (b.innerText || b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return (text.includes('new project') || text === 'create project' || aria.includes('new project')) &&
             (b.offsetParent !== null || b.getClientRects().length > 0);
    });

    if (newProjectBtn) {
      console.log('[RenderX Flow] Auto-clicking "New project" on dashboard...');
      newProjectBtn.click();
      await new Promise(r => setTimeout(r, 3500));
    }
  }

  /**
   * Helper: Switch workspace mode to "Create Image" or Video
   */
  async function switchWorkspaceMode(subMode) {
    const allTabs = Array.from(document.querySelectorAll('button, [role="tab"], div[role="button"], label'));
    let matched = null;

    if (subMode === 'image') {
      matched = allTabs.find(el => {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        return (text.includes('create image') || text === 'image' || text === 'images') && !text.includes('video');
      });
    } else if (subMode === 'text-to-video') {
      matched = allTabs.find(el => {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        return (text.includes('text to video') || text === 'text-to-video' || text === 'video') && !text.includes('frames');
      });
    } else if (subMode === 'image-to-video') {
      matched = allTabs.find(el => {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        return text.includes('frames to video') || text.includes('image to video') || text.includes('frames');
      });
    }

    if (matched) {
      try {
        matched.click();
        console.log(`[RenderX Flow] Switched mode to ${subMode}`);
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {}
    }
  }

  /**
   * Helper: Find the prompt textarea / input
   */
  function findFlowPromptInput() {
    const selectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[aria-label*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div.ql-editor',
      'input[type="text"][placeholder*="describe" i]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
        return el;
      }
    }
    return null;
  }

  /**
   * Helper: Set React controlled textarea value safely
   */
  function setReactTextareaValue(textareaEl, value) {
    textareaEl.focus();
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(textareaEl, value);
    } catch (e) {
      textareaEl.value = value;
    }

    textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
    textareaEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Helper: Find the enabled Generate / Create button
   */
  function findFlowGenerateButton() {
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    return buttons.find(b => {
      const text = (b.innerText || b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const isGenerate = text === 'generate' || text === 'create' || text.includes('generate') || aria.includes('generate') || aria.includes('create');
      const isDisabled = b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true';
      return isGenerate && !isDisabled && (b.offsetParent !== null || b.getClientRects().length > 0);
    });
  }

  /**
   * Helper: Attach reference frame for Image-to-Video
   */
  async function attachReferenceFrame(dataUrl) {
    if (!dataUrl) return;
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      const file = dataUrlToFile(dataUrl, 'flow_frame.png');
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
    }
  }

  /**
   * Snapshot all existing image and video URLs
   */
  function getExistingMediaSrcs() {
    const set = new Set();
    document.querySelectorAll('img').forEach(img => {
      if (img.src) set.add(img.src);
      if (img.currentSrc) set.add(img.currentSrc);
    });
    document.querySelectorAll('video').forEach(vid => {
      if (vid.src) set.add(vid.src);
      if (vid.currentSrc) set.add(vid.currentSrc);
      const srcEl = vid.querySelector('source');
      if (srcEl && srcEl.src) set.add(srcEl.src);
    });
    return set;
  }

  /**
   * Extract rendered media as Base64 Data URL (CORS-free)
   */
  async function extractMediaBlob(mediaEl) {
    const src = mediaEl.currentSrc || mediaEl.src || (mediaEl.querySelector('source') ? mediaEl.querySelector('source').src : '');
    if (!src) throw new Error('Rendered media element has no src');
    if (src.startsWith('data:')) return src;

    try {
      const resp = await fetch(src, { method: 'GET', credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('[RenderX Flow] Fetch note, returning direct src:', err.message);
      return src;
    }
  }

  /**
   * 5. Execute Flow Turn
   */
  async function executeFlowTurn(sanitizedPrompt, shotIndex = 1, subMode = 'image', referenceImage = null) {
    console.log(`[RenderX Flow] Executing Shot #${shotIndex}: subMode=${subMode}, prompt="${sanitizedPrompt.slice(0, 50)}..."`);

    // 1. Auto-click "New project" if on dashboard
    await handleProjectDashboardIfNeeded();

    // 2. Switch workspace mode to "Create Image" or Video
    await switchWorkspaceMode(subMode);

    // 3. Attach reference image if Image-to-Video
    if (subMode === 'image-to-video' && referenceImage) {
      await attachReferenceFrame(referenceImage);
    }

    // 4. Record pre-injection media snapshot
    const preInjectionSrcSet = getExistingMediaSrcs();
    console.log(`[RenderX Flow] Pre-injection media snapshot recorded: ${preInjectionSrcSet.size} items`);

    // 5. Locate prompt input
    let inputBox = findFlowPromptInput();
    if (!inputBox) {
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 400));
        inputBox = findFlowPromptInput();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Google Flow prompt input not found. Please ensure Flow workspace is open.');
    }

    // 6. Set prompt using React native setter
    if (inputBox.tagName === 'TEXTAREA') {
      setReactTextareaValue(inputBox, sanitizedPrompt);
    } else {
      inputBox.focus();
      inputBox.innerText = sanitizedPrompt;
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await new Promise(r => setTimeout(r, 600));

    // 7. Click Generate Button
    let genBtn = findFlowGenerateButton();
    if (!genBtn) {
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 300));
        genBtn = findFlowGenerateButton();
        if (genBtn) break;
      }
    }

    if (genBtn) {
      genBtn.click();
      console.log('[RenderX Flow] Clicked Flow Generate button');
    } else {
      inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    // 8. Observe output via MutationObserver
    const isVideoMode = (subMode === 'text-to-video' || subMode === 'image-to-video');
    const timeoutMs = isVideoMode ? 120000 : 30000;

    return new Promise((resolve, reject) => {
      let isResolved = false;
      let observer = null;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Google Flow timed out waiting for output (${timeoutMs / 1000}s)`));
      }, timeoutMs);

      function cleanup() {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        clearTimeout(timer);
      }

      async function checkForNewMedia() {
        if (isResolved) return;

        if (isVideoMode) {
          const videos = Array.from(document.querySelectorAll('video'));
          for (const vid of videos) {
            const src = vid.currentSrc || vid.src || (vid.querySelector('source') ? vid.querySelector('source').src : '');
            if (src && !preInjectionSrcSet.has(src) && (vid.duration > 0 || vid.readyState >= 2 || vid.videoWidth > 100)) {
              isResolved = true;
              cleanup();
              const dataUrl = await extractMediaBlob(vid);
              resolve({
                success: true,
                action: 'SHOT_COMPLETED',
                shotIndex,
                mediaType: 'video',
                dataUrl,
                duration: vid.duration || 4.0,
                prompt: sanitizedPrompt
              });
              return;
            }
          }
        } else {
          const imgs = Array.from(document.querySelectorAll('img'));
          for (const img of imgs) {
            const src = img.src || img.currentSrc;
            if (!src) continue;
            if (preInjectionSrcSet.has(src)) continue;
            if (src.includes('avatar') || src.includes('profile')) continue;

            const w = img.naturalWidth || img.width || 0;
            if ((w > 256 || src.includes('googleusercontent.com')) && img.complete) {
              isResolved = true;
              cleanup();
              const dataUrl = await extractMediaBlob(img);
              resolve({
                success: true,
                action: 'SHOT_COMPLETED',
                shotIndex,
                mediaType: 'image',
                dataUrl,
                prompt: sanitizedPrompt
              });
              return;
            }
          }
        }
      }

      observer = new MutationObserver(() => checkForNewMedia());
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      const pollInterval = setInterval(() => {
        if (isResolved) {
          clearInterval(pollInterval);
        } else {
          checkForNewMedia();
        }
      }, 1000);
    });
  }

  // Runtime message handler
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
      sendResponse({ status: 'READY', mode: 'google-flow', url: window.location.href });
      return true;
    }

    if (request.type === 'GENERATE_FLOW_TURN') {
      executeFlowTurn(request.prompt, request.shotIndex || 1, request.subMode || 'image', request.referenceImage || null)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

})();
