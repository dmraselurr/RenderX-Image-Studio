/**
 * RenderX Image Studio - Google Flow Automation Content Script
 * Injected strictly into isolated Google Flow worker tabs (https://flow.google.com/*)
 * forceRealClick + Toolbar Pill Mode Switcher + Circular Arrow Submit (→) + Persistent Observer
 */

(function () {
  if (window.__renderexFlowLoaded) return;
  window.__renderexFlowLoaded = true;
  console.log('[RenderX Flow] Automation script initialized on:', window.location.href);

  const tabCapturedMedia = new Set();
  const streamCallbacks = new Set();
  let persistentObserver = null;

  /**
   * Real Pointer Click with Bounding-Box Coordinates
   * Dispatches pointerdown -> mousedown -> pointerup -> mouseup -> click
   */
  function forceRealClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch (e) {}

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + (rect.width / 2);
    const clientY = rect.top + (rect.height / 2);

    const pointerOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1
    };
    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 1
    };

    el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
    el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...pointerOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...mouseOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...mouseOpts, buttons: 0 }));
    return true;
  }

  function ensurePersistentObserver() {
    if (persistentObserver) return;
    const notifyStream = () => {
      streamCallbacks.forEach(cb => {
        try { cb(); } catch (e) {}
      });
    };
    persistentObserver = new MutationObserver(notifyStream);
    if (document.body) {
      persistentObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
      });
    }
  }

  function isVisible(el) {
    return el && (el.offsetParent !== null || el.getClientRects().length > 0);
  }

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
   * If on project landing, forceRealClick "New project"
   */
  async function handleProjectDashboardIfNeeded() {
    const clickables = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const entryBtn = clickables.find(b => {
      if (!isVisible(b)) return false;
      const text = (b.innerText || b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return text === 'new project' ||
        text.includes('new project') ||
        text === 'create project' ||
        text.includes('start creating') ||
        aria.includes('new project');
    });

    if (entryBtn) {
      console.log('[RenderX Flow] Entering workspace via New project button');
      forceRealClick(entryBtn);
      await new Promise(r => setTimeout(r, 2500));
    }
  }

  /**
   * Check bottom toolbar pill: if showing "Video" (when Image requested), forceRealClick and switch to "Image" / "Create Image"
   */
  async function switchWorkspaceMode(subMode = 'image') {
    const clickables = Array.from(document.querySelectorAll('button, [role="tab"], [role="button"], [role="combobox"], [role="menuitem"]'));

    if (subMode === 'image') {
      // Check if direct Image tab/button exists
      const directImageBtn = clickables.find(el => {
        if (!isVisible(el)) return false;
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        return text === 'create image' || text === 'image' || text === 'images';
      });

      // Check bottom toolbar pill showing "Video" (or "Text to Video" / "Frames to Video")
      const videoPill = clickables.find(el => {
        if (!isVisible(el)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.4) return false; // Bottom composer toolbar region
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        return (text === 'video' || text.includes('text to video') || text.includes('frames to video')) && !text.includes('image');
      });

      if (videoPill) {
        console.log('[RenderX Flow] Toolbar pill shows Video -> switching to Image');
        forceRealClick(videoPill);
        await new Promise(r => setTimeout(r, 350));

        const menuOptions = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, div[role="button"]'));
        const imageChoice = menuOptions.find(el => {
          if (!isVisible(el)) return false;
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          return (text === 'image' || text === 'create image' || text === 'images' || text === 'text to image') && !text.includes('video');
        });
        if (imageChoice) {
          forceRealClick(imageChoice);
          await new Promise(r => setTimeout(r, 400));
        }
      } else if (directImageBtn && directImageBtn.getAttribute('aria-selected') !== 'true') {
        forceRealClick(directImageBtn);
        await new Promise(r => setTimeout(r, 400));
      }
    } else if (subMode === 'text-to-video' || subMode === 'image-to-video') {
      const targetMatch = (subMode === 'image-to-video')
        ? (t) => t.includes('frames to video') || t.includes('image to video')
        : (t) => t === 'text to video' || t === 'video' || t.includes('text to video');

      const pill = clickables.find(el => {
        if (!isVisible(el)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.4) return false;
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        return text === 'image' || text === 'create image' || text === 'video' || text.includes('to video');
      });

      if (pill) {
        const pillText = (pill.innerText || pill.textContent || '').trim().toLowerCase();
        if (!targetMatch(pillText)) {
          forceRealClick(pill);
          await new Promise(r => setTimeout(r, 350));
          const menuOptions = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, div[role="button"]'));
          const choice = menuOptions.find(el => isVisible(el) && targetMatch((el.innerText || el.textContent || '').trim().toLowerCase()));
          if (choice) {
            forceRealClick(choice);
            await new Promise(r => setTimeout(r, 400));
          }
        }
      }
    }
  }

  function findFlowPromptInput() {
    const selectors = [
      'textarea[placeholder*="describe" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[aria-label*="prompt" i]',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div.ql-editor'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (isVisible(el)) return el;
    }
    return null;
  }

  /**
   * Set prompt using React native HTMLTextAreaElement.prototype.value setter + input/change events
   */
  function setReactInputValue(inputEl, value) {
    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA') {
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(inputEl, value);
      } catch (e) {
        inputEl.value = value;
      }
    } else if (inputEl.tagName === 'INPUT') {
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(inputEl, value);
      } catch (e) {
        inputEl.value = value;
      }
    } else {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
      } catch (e) {
        inputEl.innerText = value;
      }
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Locate the circular white arrow submit button (→) at the bottom-right of the composer
   */
  function findFlowSubmitArrowButton(inputBox) {
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(isVisible);

    // 1. Explicit aria-label / icon text match
    const labeledBtn = candidates.find(b => {
      const text = (b.innerText || b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      return text === '→' ||
        text === 'arrow_forward' ||
        text === 'arrow_upward' ||
        text === 'east' ||
        text === 'send' ||
        text === 'generate' ||
        text === 'create' ||
        aria.includes('generate') ||
        aria.includes('submit') ||
        aria.includes('send') ||
        aria.includes('create') ||
        title.includes('generate');
    });
    if (labeledBtn) return labeledBtn;

    // 2. Spatial heuristic near bottom-right of composer textarea (circular icon button with SVG)
    if (inputBox) {
      const inputRect = inputBox.getBoundingClientRect();
      const composerButtons = candidates.filter(b => {
        if (!b.querySelector('svg')) return false;
        const r = b.getBoundingClientRect();
        // Located near or to the right/bottom of the textarea
        const nearVertical = r.top >= inputRect.top - 20 && r.bottom <= inputRect.bottom + 80;
        const nearRight = r.left >= inputRect.left && r.right <= inputRect.right + 120;
        return nearVertical && nearRight && r.width >= 24 && r.width <= 64;
      });
      if (composerButtons.length > 0) {
        // Pick the bottom-right-most button
        composerButtons.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (rb.right + rb.bottom) - (ra.right + ra.bottom);
        });
        return composerButtons[0];
      }
    }

    return null;
  }

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

  function snapshotExistingMedia() {
    const set = new Set();
    document.querySelectorAll('img').forEach(img => {
      if (img.src) set.add(img.src);
      if (img.currentSrc) set.add(img.currentSrc);
    });
    document.querySelectorAll('video').forEach(vid => {
      if (vid.src) set.add(vid.src);
      if (vid.currentSrc) set.add(vid.currentSrc);
      const s = vid.querySelector('source');
      if (s && s.src) set.add(s.src);
    });
    return set;
  }

  async function blobUrlToDataUrl(blobUrl) {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function requestImageBase64FromSW(shotIndex, imgElement, rawSrc) {
    let imageUrl = rawSrc;
    if (rawSrc.startsWith('blob:')) {
      imageUrl = await blobUrlToDataUrl(rawSrc);
    }

    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'FETCH_IMAGE_BASE64', shotIndex, imageUrl },
        async (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (res && res.success && res.dataUrl) {
            resolve(res.dataUrl);
            return;
          }
          if (res && (res.duplicate || res.alreadyDone)) {
            reject(Object.assign(new Error(res.error || 'Duplicate'), { isDuplicate: true }));
            return;
          }
          try {
            const resp = await fetch(rawSrc, { credentials: 'include' });
            const blob = await resp.blob();
            const dataUrl = await new Promise((res2, rej2) => {
              const reader = new FileReader();
              reader.onloadend = () => res2(reader.result);
              reader.onerror = () => rej2(new Error('FileReader failed'));
              reader.readAsDataURL(blob);
            });
            resolve(dataUrl);
          } catch (fbErr) {
            reject(new Error(res?.error || fbErr.message));
          }
        }
      );
    });
  }

  async function extractVideoBlob(vidElement) {
    const src = vidElement.currentSrc || vidElement.src || (vidElement.querySelector('source') ? vidElement.querySelector('source').src : '');
    if (!src) throw new Error('Video element has no src');
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
    } catch (e) {
      return src;
    }
  }

  /**
   * Execute Google Flow turn
   */
  async function executeFlowTurn(sanitizedPrompt, shotIndex = 1, subMode = 'image', referenceImage = null) {
    ensurePersistentObserver();
    console.log(`[RenderX Flow] Starting Shot #${shotIndex}: subMode=${subMode}`);

    // 1. Handle landing screen ("New project")
    await handleProjectDashboardIfNeeded();

    // 2. Check bottom toolbar pill & switch to requested mode ("Image" / Video)
    await switchWorkspaceMode(subMode);

    // 3. Attach reference image if Image-to-Video
    if (subMode === 'image-to-video' && referenceImage) {
      await attachReferenceFrame(referenceImage);
    }

    // 4. Snapshot existing media
    const preExistingMedia = snapshotExistingMedia();

    // 5. Locate prompt textarea
    let inputBox = findFlowPromptInput();
    if (!inputBox) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 350));
        inputBox = findFlowPromptInput();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Google Flow prompt textarea not found on worker tab.');
    }

    // 6. Set prompt via React native setter + input/change events
    setReactInputValue(inputBox, sanitizedPrompt);

    // 7. Wait 150ms & forceRealClick circular white arrow submit button (→) + Enter
    await new Promise(r => setTimeout(r, 150));

    let submitBtn = findFlowSubmitArrowButton(inputBox);
    if (!submitBtn) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 150));
        submitBtn = findFlowSubmitArrowButton(inputBox);
        if (submitBtn) break;
      }
    }

    if (submitBtn) {
      if (submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true') {
        submitBtn.removeAttribute('disabled');
        submitBtn.setAttribute('aria-disabled', 'false');
      }
      forceRealClick(submitBtn);
      console.log('[RenderX Flow] Triggered forceRealClick on circular arrow submit button');
    }

    inputBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));

    // 8. Monitor via Persistent MutationObserver + Polling
    const isVideoMode = (subMode === 'text-to-video' || subMode === 'image-to-video');
    const timeoutMs = isVideoMode ? 120000 : 42000;

    return new Promise((resolve, reject) => {
      let isResolved = false;
      let isChecking = false;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Google Flow timed out waiting for output (${timeoutMs / 1000}s)`));
      }, timeoutMs);

      async function scanMedia() {
        if (isResolved || isChecking) return;
        isChecking = true;

        try {
          if (isVideoMode) {
            const videos = Array.from(document.querySelectorAll('video'));
            for (const vid of videos) {
              const src = vid.currentSrc || vid.src || (vid.querySelector('source') ? vid.querySelector('source').src : '');
              if (src && !preExistingMedia.has(src) && !tabCapturedMedia.has(src) && (vid.duration > 0 || vid.readyState >= 2 || vid.videoWidth > 100)) {
                tabCapturedMedia.add(src);
                isResolved = true;
                cleanup();
                const dataUrl = await extractVideoBlob(vid);
                resolve({
                  success: true,
                  action: 'SHOT_COMPLETED',
                  shotIndex,
                  mediaType: 'video',
                  dataUrl,
                  duration: vid.duration || 4.0
                });
                return;
              }
            }
          } else {
            const imgs = Array.from(document.querySelectorAll('img'));
            for (const img of imgs) {
              const src = img.currentSrc || img.src;
              if (!src) continue;
              if (preExistingMedia.has(src) || tabCapturedMedia.has(src)) continue;

              const lowerSrc = src.toLowerCase();
              if (lowerSrc.includes('avatar') || lowerSrc.includes('profile') ||
                  lowerSrc.includes('icon') || lowerSrc.includes('logo') || lowerSrc.includes('favicon')) {
                continue;
              }

              if (img.complete && img.naturalWidth > 256) {
                tabCapturedMedia.add(src);
                try {
                  const dataUrl = await requestImageBase64FromSW(shotIndex, img, src);
                  isResolved = true;
                  cleanup();
                  resolve({
                    success: true,
                    action: 'SHOT_COMPLETED',
                    shotIndex,
                    mediaType: 'image',
                    dataUrl,
                    imageUrl: src
                  });
                  return;
                } catch (err) {
                  if (err.isDuplicate) {
                    continue;
                  }
                  tabCapturedMedia.delete(src);
                  isResolved = true;
                  cleanup();
                  reject(err);
                  return;
                }
              }
            }
          }
        } finally {
          isChecking = false;
        }
      }

      const pollTimer = setInterval(scanMedia, 600);
      streamCallbacks.add(scanMedia);

      function cleanup() {
        streamCallbacks.delete(scanMedia);
        clearInterval(pollTimer);
        clearTimeout(timer);
      }
    });
  }

  ensurePersistentObserver();

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
