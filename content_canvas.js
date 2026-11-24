/**
 * RenderX Image Studio - Gemini Canvas Automation Content Script
 * Injected strictly into isolated Gemini Canvas worker tabs (https://gemini.google.com/*)
 * forceRealClick + Snapshot-Diff + Persistent MutationObserver + SW Base64 Collector
 */

(function () {
  if (window.__renderexCanvasLoaded) return;
  window.__renderexCanvasLoaded = true;
  console.log('[RenderX Canvas] Automation script initialized on:', window.location.href);

  // Persistent tab-level image tracking & observer
  const tabCapturedSrcs = new Set();
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

  /**
   * Resilient Input Box Selector for Gemini Quill / ContentEditable
   */
  function findInputBox() {
    const selectors = [
      'div.ql-editor[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[aria-label*="prompt" i]',
      'textarea'
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
   * Resilient Send Button Selector
   */
  function findSendButton() {
    const selectors = [
      'button[aria-label*="Send" i]',
      'button.send-button',
      'div[class*="send-button-container"] button',
      'button[jsname="send_button"]',
      'button[data-tooltip*="Send" i]',
      'rich-textarea ~ button',
      'div.input-area button[aria-label*="Send" i]'
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
        return btn;
      }
    }

    const allButtons = Array.from(document.querySelectorAll('button'));
    return allButtons.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      const text = (b.innerText || b.textContent || '').toLowerCase();
      return (label.includes('send') || title.includes('send') || text.includes('send')) &&
        (b.offsetParent !== null || b.getClientRects().length > 0);
    }) || null;
  }

  /**
   * Snapshot all existing images on the page
   */
  function snapshotExistingImageSrcs() {
    const set = new Set();
    document.querySelectorAll('img').forEach(img => {
      if (img.src) set.add(img.src);
      if (img.currentSrc) set.add(img.currentSrc);
    });
    return set;
  }

  async function blobUrlToDataUrl(blobUrl) {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader blob conversion failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function fallbackCanvasBase64(imgElement) {
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width || 1024;
    canvas.height = imgElement.naturalHeight || imgElement.height || 1024;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /**
   * Send image URL to background.js SW for CORS-free Base64 conversion & batch deduplication
   */
  async function requestBase64FromSW(shotIndex, imgElement, rawSrc) {
    let imageUrl = rawSrc;
    if (rawSrc.startsWith('blob:')) {
      try {
        imageUrl = await blobUrlToDataUrl(rawSrc);
      } catch (e) {
        imageUrl = await fallbackCanvasBase64(imgElement);
      }
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
          // Fallback canvas extraction if SW fetch blocked
          try {
            const fallbackUrl = await fallbackCanvasBase64(imgElement);
            resolve(fallbackUrl);
          } catch (fbErr) {
            reject(new Error(res?.error || fbErr.message));
          }
        }
      );
    });
  }

  /**
   * Execute single Gemini Canvas image generation turn
   */
  async function executeTurn(sanitizedPrompt, shotIndex = 1) {
    ensurePersistentObserver();
    console.log(`[RenderX Canvas] Starting Shot #${shotIndex}:`, sanitizedPrompt.slice(0, 60));

    // 1. Snapshot existing img.src URLs
    const preInjectionSrcs = snapshotExistingImageSrcs();

    // 2. Focus div.ql-editor[contenteditable="true"] or div[role="textbox"][contenteditable="true"]
    let inputBox = findInputBox();
    if (!inputBox) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 350));
        inputBox = findInputBox();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Gemini input box not found on worker tab.');
    }

    // 3. Insert "Generate an image: " + sanitizedPrompt
    const lower = sanitizedPrompt.toLowerCase();
    const fullPromptText = (lower.startsWith('generate an image') || lower.startsWith('create an image'))
      ? sanitizedPrompt
      : `Generate an image: ${sanitizedPrompt}`;

    inputBox.focus();
    await new Promise(r => setTimeout(r, 80));

    try {
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(inputBox);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } catch (e) {
      inputBox.innerText = '';
    }

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, fullPromptText);
    } catch (e) {}

    if (!inserted || !inputBox.textContent.includes(sanitizedPrompt.slice(0, 12))) {
      let p = inputBox.querySelector('p');
      if (!p) {
        p = document.createElement('p');
        inputBox.appendChild(p);
      }
      p.textContent = fullPromptText;
    }

    inputBox.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: fullPromptText
    }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));

    // 4. Wait 150ms and trigger forceRealClick on enabled Send button + Enter
    await new Promise(r => setTimeout(r, 150));

    let sendBtn = findSendButton();
    if (!sendBtn) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 150));
        sendBtn = findSendButton();
        if (sendBtn) break;
      }
    }

    if (sendBtn) {
      if (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
        sendBtn.removeAttribute('disabled');
        sendBtn.setAttribute('aria-disabled', 'false');
        sendBtn.classList.remove('disabled');
      }
      forceRealClick(sendBtn);
    }

    inputBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));

    // 5. Monitor via Persistent MutationObserver + Polling for newly rendered img (naturalWidth > 256)
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let isChecking = false;

      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error('Gemini generation timed out waiting for image (naturalWidth > 256).'));
      }, 42000);

      async function scanImages() {
        if (isResolved || isChecking) return;
        isChecking = true;

        try {
          const imgs = Array.from(document.querySelectorAll('img'));
          for (const img of imgs) {
            const src = img.currentSrc || img.src;
            if (!src) continue;
            if (preInjectionSrcs.has(src) || tabCapturedSrcs.has(src)) continue;

            const lowerSrc = src.toLowerCase();
            if (lowerSrc.includes('profile') || lowerSrc.includes('avatar') ||
                lowerSrc.includes('emoji') || lowerSrc.includes('icon') ||
                lowerSrc.includes('logo') || lowerSrc.includes('favicon')) {
              continue;
            }

            if (img.complete && img.naturalWidth > 256) {
              tabCapturedSrcs.add(src);
              try {
                const dataUrl = await requestBase64FromSW(shotIndex, img, src);
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
                  // Already captured by another retry/worker; keep watching for next new image
                  continue;
                }
                tabCapturedSrcs.delete(src);
                isResolved = true;
                cleanup();
                reject(err);
                return;
              }
            }
          }
        } finally {
          isChecking = false;
        }
      }

      const pollTimer = setInterval(scanImages, 600);
      streamCallbacks.add(scanImages);

      function cleanup() {
        streamCallbacks.delete(scanImages);
        clearInterval(pollTimer);
        clearTimeout(deadline);
      }
    });
  }

  ensurePersistentObserver();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
      sendResponse({ status: 'READY', mode: 'gemini-canvas', url: window.location.href });
      return true;
    }

    if (request.type === 'GENERATE_CANVAS_TURN') {
      executeTurn(request.prompt, request.shotIndex || 1)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });
})();
