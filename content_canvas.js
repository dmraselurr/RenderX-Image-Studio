/**
 * RenderX Image Studio - Resilient Gemini Canvas Automation Content Script
 * Injected into https://gemini.google.com/*
 * Snapshot-Diff DOM Image Capture & Angular/Quill Interaction Engine
 */

(function () {
  window.__renderexLoaded = true;
  console.log('[RenderX Canvas] Automation script initialized on:', window.location.href);

  /**
   * Resilient Input Box Selector for Gemini Quill / TipTap rich-textarea
   */
  function findInputBox() {
    const selectors = [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea p',
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
      return (label.includes('send') || title.includes('send') || text.includes('send'));
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

  /**
   * Fetch image as Base64 Data URL (CORS-free within Gemini's host origin)
   */
  async function fetchImageAsBase64(imgElement) {
    const src = imgElement.src || imgElement.currentSrc;
    if (src && src.startsWith('data:image')) return src;

    // Method 1: Offscreen Canvas drawImage
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

    // Method 2: Fetch using active browser session credentials
    try {
      const resp = await fetch(src, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      throw new Error(`Failed to capture image Base64: ${err.message}`);
    }
  }

  /**
   * Inject prompt and trigger generation
   */
  async function executeTurn(sanitizedPrompt, shotIndex = 1, options = {}) {
    console.log(`[RenderX Canvas] Starting Shot #${shotIndex}:`, sanitizedPrompt.slice(0, 60));

    // 1. Take snapshot of existing images
    const preInjectionSrcs = snapshotExistingImageSrcs();
    console.log(`[RenderX Canvas] Pre-injection snapshot: ${preInjectionSrcs.size} images`);

    // 2. Locate input box (with up to 15 retries for SPA render)
    let inputBox = findInputBox();
    if (!inputBox) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 400));
        inputBox = findInputBox();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Gemini input box not found. Ensure gemini.google.com/app is open and active.');
    }

    // 3. Format full prompt text with explicit instruction for Imagen 3
    const fullPromptText = sanitizedPrompt.toLowerCase().startsWith('generate an image') ||
                           sanitizedPrompt.toLowerCase().startsWith('create an image')
      ? sanitizedPrompt
      : `Generate an image: ${sanitizedPrompt}`;

    // 4. Focus and cleanly inject text into Quill/Angular editor
    inputBox.focus();
    await new Promise(r => setTimeout(r, 150));

    // Clear existing text safely
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

    // Insert text via execCommand (Quill natively detects this!)
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, fullPromptText);
    } catch (e) {}

    // Fallback if execCommand was not accepted by browser
    if (!inserted || !inputBox.textContent.includes(sanitizedPrompt.slice(0, 15))) {
      let p = inputBox.querySelector('p');
      if (!p) {
        p = document.createElement('p');
        inputBox.appendChild(p);
      }
      p.textContent = fullPromptText;
    }

    // Dispatch comprehensive input events to trigger Angular validation
    inputBox.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: fullPromptText }));
    inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: fullPromptText }));
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait 500ms for Angular / Lit to re-render button states
    await new Promise(r => setTimeout(r, 500));

    // 5. Locate and click Send button
    let sendBtn = findSendButton();
    if (!sendBtn) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 250));
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
      sendBtn.click();
      console.log('[RenderX Canvas] Clicked Gemini Send button');
    }

    // Fallback Enter key dispatch
    inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    inputBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));

    console.log('[RenderX Canvas] Prompt submitted. Monitoring for rendered image tile...');

    // 6. Monitor for new rendered image via MutationObserver + Polling (35s timeout)
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let observer = null;

      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error('Gemini generation timed out waiting for image tile (35s).'));
      }, 35000);

      function cleanup() {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        clearTimeout(deadline);
      }

      async function checkForNewImage() {
        if (isResolved) return;

        const imgs = Array.from(document.querySelectorAll('img'));
        for (const img of imgs) {
          const src = img.src || img.currentSrc;
          if (!src) continue;

          // Must be NEW (not in pre-existing set)
          if (preInjectionSrcs.has(src)) continue;

          // Filter out user avatars, icons, emojis
          const isAvatar = src.includes('profile') || src.includes('avatar') || src.includes('emoji') || src.includes('icon') || src.includes('logo');
          if (isAvatar) continue;

          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;

          // Check if image is rendered and loaded
          if ((w > 200 || h > 200 || src.includes('googleusercontent.com')) && img.complete) {
            isResolved = true;
            cleanup();

            console.log(`[RenderX Canvas] Shot #${shotIndex} image captured successfully!`);
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

      observer = new MutationObserver(() => checkForNewImage());
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

      const pollTimer = setInterval(() => {
        if (isResolved) clearInterval(pollTimer);
        else checkForNewImage();
      }, 800);
    });
  }

  // Runtime Message Listener
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
