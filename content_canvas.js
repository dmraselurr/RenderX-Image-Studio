/**
 * RenderX Image Studio - Gemini Canvas Account-Level Content Script
 * Injected into https://gemini.google.com/*
 * Snapshot-Diff DOM Image Capture & Resilient Interaction Engine
 */

(function () {
  // Idempotency guard to prevent double-injection
  window.__renderexLoaded = true;
  console.log('[RenderX Canvas] Content script active on:', window.location.href);

  /**
   * Resilient Input Box Selector
   */
  function findInputBox() {
    const selectors = [
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
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
      'button[aria-label*="Send" i]:not([disabled])',
      'button[aria-label*="Submit" i]:not([disabled])',
      'button.send-button:not([disabled])',
      'button[jsname="send_button"]:not([disabled])',
      'button[data-tooltip*="Send" i]:not([disabled])'
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
        return btn;
      }
    }

    const allButtons = Array.from(document.querySelectorAll('button:not([disabled])'));
    return allButtons.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      return (label.includes('send') || title.includes('send'));
    }) || null;
  }

  /**
   * Check if generation is in progress (Stop response button visible)
   */
  function isGenerating() {
    const stopSelectors = [
      'button[aria-label*="Stop" i]',
      'button.stop-button',
      'button[data-tooltip*="Stop" i]'
    ];
    for (const sel of stopSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) return true;
    }
    return false;
  }

  /**
   * Snapshot all existing images on the page
   */
  function getExistingImageSrcs() {
    const imgs = Array.from(document.querySelectorAll('img'));
    const set = new Set();
    for (const img of imgs) {
      if (img.src) set.add(img.src);
      if (img.currentSrc) set.add(img.currentSrc);
    }
    return set;
  }

  /**
   * Fetch image as Base64 Data URL using active browser session credentials (CORS-free)
   */
  async function fetchImageAsBase64(imgElement) {
    const src = imgElement.src || imgElement.currentSrc;
    if (src && src.startsWith('data:image')) return src;

    // 1. Try canvas drawImage
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgElement.naturalWidth || imgElement.width || 1024;
      canvas.height = imgElement.naturalHeight || imgElement.height || 1024;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgElement, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl && dataUrl.length > 500) return dataUrl;
    } catch (e) {
      console.warn('[RenderX Canvas] Canvas extraction CORS note:', e.message);
    }

    // 2. Fetch via active Google session credentials
    try {
      const response = await fetch(src, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      throw new Error(`Failed to extract image Base64: ${err.message}`);
    }
  }

  /**
   * 5. Snapshot-Diff Image Capture & DOM Automation
   */
  async function executeTurn(sanitizedPrompt, shotIndex = 1, options = {}) {
    console.log(`[RenderX Canvas] Executing Shot #${shotIndex}:`, sanitizedPrompt.slice(0, 60));

    // 1. Record pre-injection Set of all existing images
    const preInjectionSrcSet = getExistingImageSrcs();
    console.log(`[RenderX Canvas] Pre-injection image snapshot recorded: ${preInjectionSrcSet.size} images`);

    // 2. Locate input box with polling
    let inputBox = findInputBox();
    if (!inputBox) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 400));
        inputBox = findInputBox();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Gemini prompt input box not found. Please ensure gemini.google.com is open and active.');
    }

    // 3. Focus and clear
    inputBox.focus();
    await new Promise(r => setTimeout(r, 200));

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (e) {
      inputBox.innerText = '';
    }

    // 4. Prepend "Generate an image: " to ensure Gemini activates Imagen 3
    const fullPromptText = sanitizedPrompt.toLowerCase().startsWith('generate an image')
      ? sanitizedPrompt
      : `Generate an image: ${sanitizedPrompt}`;

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, fullPromptText);
    } catch (e) {}

    if (!inserted || !inputBox.innerText.includes(sanitizedPrompt.slice(0, 20))) {
      inputBox.innerText = fullPromptText;
    }

    // Dispatch input events
    inputBox.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: fullPromptText
    }));
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait 600ms for UI to enable send button
    await new Promise(r => setTimeout(r, 600));

    // 5. Click Send Button AND dispatch fallback Enter KeyboardEvent
    let sendBtn = findSendButton();
    if (!sendBtn) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 250));
        sendBtn = findSendButton();
        if (sendBtn) break;
      }
    }

    if (sendBtn) {
      sendBtn.click();
      console.log('[RenderX Canvas] Clicked Gemini Send button');
    }

    // Always dispatch Enter as fallback / reinforcement
    inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    inputBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

    console.log('[RenderX Canvas] Prompt submitted. Monitoring for new image tile...');

    // 6. Wait via MutationObserver + Polling until a NEW high-res <img> renders
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let observer = null;

      const deadlineTimer = setTimeout(() => {
        cleanup();
        reject(new Error('Gemini generation timed out waiting for image output (35s).'));
      }, 35000);

      function cleanup() {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        clearTimeout(deadlineTimer);
      }

      async function checkForNewImage() {
        if (isResolved) return;

        const currentImgs = Array.from(document.querySelectorAll('img'));
        for (const img of currentImgs) {
          const src = img.src || img.currentSrc;
          if (!src) continue;

          // Must be NEW (not in pre-injection set)
          if (preInjectionSrcSet.has(src)) continue;

          // Filter out avatars, icons, emojis
          const isAvatar = src.includes('profile') || src.includes('avatar') || src.includes('emoji') || src.includes('icon');
          if (isAvatar) continue;

          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;

          // Requirement: naturalWidth > 256 or high-res Google User Content
          if ((w > 256 || h > 256 || src.includes('googleusercontent.com')) && img.complete) {
            isResolved = true;
            cleanup();

            console.log(`[RenderX Canvas] New image captured for Shot #${shotIndex}:`, src.slice(0, 60));
            try {
              const dataUrl = await fetchImageAsBase64(img);
              resolve({
                success: true,
                action: 'SHOT_COMPLETED',
                shotIndex,
                mediaType: 'image',
                dataUrl,
                prompt: sanitizedPrompt
              });
            } catch (err) {
              reject(err);
            }
            return;
          }
        }
      }

      // MutationObserver monitoring container mutations
      observer = new MutationObserver(() => {
        checkForNewImage();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

      // Polling fallback every 800ms
      const pollInterval = setInterval(() => {
        if (isResolved) {
          clearInterval(pollInterval);
        } else {
          checkForNewImage();
        }
      }, 800);
    });
  }

  // Runtime message handler
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
      sendResponse({ status: 'READY', mode: 'gemini-canvas', url: window.location.href });
      return true;
    }

    if (request.type === 'GENERATE_CANVAS_TURN') {
      executeTurn(request.prompt, request.shotIndex || 1, request.options || {})
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

})();
