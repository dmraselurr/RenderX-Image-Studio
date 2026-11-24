/**
 * RenderX Image Studio - Account-Level Gemini Automation Content Script
 * Injected into https://gemini.google.com/*
 * Directly drives the Google Gemini Web Session without any API keys.
 */

(function () {
  console.log('[RenderX] Gemini Account Automation content script active on:', window.location.href);

  // Announce presence
  try {
    chrome.runtime.sendMessage({ type: 'RENDERX_GEMINI_TAB_READY', url: window.location.href });
  } catch (e) {}

  /**
   * Helper: Find the chat prompt input box using resilient selectors
   */
  function findInputBox() {
    const selectors = [
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
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
   * Helper: Find the Send button
   */
  function findSendButton() {
    const selectors = [
      'button[aria-label*="Send" i]',
      'button[aria-label*="Submit" i]',
      'button.send-button',
      'button[jsname="send_button"]',
      'button[data-tooltip*="Send" i]'
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
        return btn;
      }
    }

    // Secondary search by inner SVG or aria label
    const allButtons = Array.from(document.querySelectorAll('button'));
    const sendBtn = allButtons.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      const text = (b.innerText || '').toLowerCase();
      return (label.includes('send') || title.includes('send') || text.includes('send')) && !b.disabled;
    });

    return sendBtn || null;
  }

  /**
   * Helper: Check if generation is in progress (Stop button is visible)
   */
  function isGenerating() {
    const stopSelectors = [
      'button[aria-label*="Stop" i]',
      'button.stop-button',
      'button[data-tooltip*="Stop" i]'
    ];
    for (const sel of stopSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        return true;
      }
    }
    return false;
  }

  /**
   * Helper: Find all candidate images rendered in the chat
   */
  function getRenderedImages() {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.filter(img => {
      if (!img.src) return false;
      // Filter out avatars, icons, emojis
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const isAvatar = img.src.includes('profile') || img.src.includes('avatar') || img.src.includes('emoji');
      return (w > 256 || h > 256 || img.src.includes('googleusercontent.com')) && !isAvatar;
    });
  }

  /**
   * Helper: Convert Image URL to Base64 Data URL using active browser session
   */
  async function fetchImageAsBase64(imgElement) {
    const src = imgElement.src;

    // If it's already a Data URL
    if (src.startsWith('data:image')) {
      return src;
    }

    // 1. Try Canvas drawImage extraction first (instant, bypasses fetch CORS)
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgElement.naturalWidth || imgElement.width || 1024;
      canvas.height = imgElement.naturalHeight || imgElement.height || 1024;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgElement, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl && dataUrl.length > 500) {
        return dataUrl;
      }
    } catch (corsErr) {
      console.warn('[RenderX] Canvas toDataURL tainted, trying session fetch:', corsErr.message);
    }

    // 2. Fetch with browser session credentials
    try {
      const response = await fetch(src, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed to read image blob'));
        reader.readAsDataURL(blob);
      });
    } catch (fetchErr) {
      throw new Error(`Failed to extract image: ${fetchErr.message}`);
    }
  }

  /**
   * Main turn execution: inject prompt, click send, observe response, extract image
   */
  async function executeTurn(promptText, options = {}) {
    console.log('[RenderX] Executing Gemini turn for prompt:', promptText.slice(0, 60));

    // 1. Locate the input box
    let inputBox = findInputBox();
    if (!inputBox) {
      // Retry for up to 6 seconds
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 500));
        inputBox = findInputBox();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Could not find Gemini prompt input box. Please ensure gemini.google.com is open and ready.');
    }

    // Capture initial set of images before sending
    const initialImages = getRenderedImages();
    const initialSrcs = new Set(initialImages.map(img => img.src));

    // 2. Focus and Clear input box
    inputBox.focus();
    await new Promise(r => setTimeout(r, 200));

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (e) {
      inputBox.innerText = '';
    }

    // 3. Insert Prompt text via document.execCommand
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, promptText);
    } catch (e) {
      console.warn('[RenderX] insertText failed, falling back to innerText assignment');
    }

    if (!inserted || inputBox.innerText.trim() !== promptText.trim()) {
      inputBox.innerText = promptText;
    }

    // 4. Dispatch bubbling InputEvent & Event so Angular/React state updates
    inputBox.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: promptText
    }));
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 400));

    // 5. Locate and click the Send button
    let sendBtn = findSendButton();
    if (!sendBtn) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 300));
        sendBtn = findSendButton();
        if (sendBtn) break;
      }
    }

    if (sendBtn) {
      sendBtn.click();
    } else {
      // Fallback: Dispatch Enter key
      console.log('[RenderX] Send button not found, dispatching Enter key event...');
      const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      inputBox.dispatchEvent(enterDown);
      inputBox.dispatchEvent(enterUp);
    }

    console.log('[RenderX] Prompt sent. Waiting for generation to complete...');

    // 6. Wait for turn to start (Stop button appears) or output image
    await new Promise(r => setTimeout(r, 1500));

    // 7. Observe DOM until Stop button disappears and image appears (timeout 60s)
    const deadline = Date.now() + 60000;
    let foundImage = null;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1200));

      const currentImages = getRenderedImages();
      // Look for new image that wasn't in initial set
      const newImgs = currentImages.filter(img => !initialSrcs.has(img.src) && (img.naturalWidth > 200 || img.width > 200));

      if (newImgs.length > 0) {
        // Pick the latest new image that is complete
        const targetImg = newImgs[newImgs.length - 1];
        if (targetImg.complete && (targetImg.naturalWidth > 100 || targetImg.width > 100)) {
          foundImage = targetImg;
          break;
        }
      }

      // If generator is no longer running (Stop button gone) and we have an image
      if (!isGenerating()) {
        const anyNew = currentImages.filter(img => !initialSrcs.has(img.src));
        if (anyNew.length > 0) {
          foundImage = anyNew[anyNew.length - 1];
          break;
        }
      }
    }

    if (!foundImage) {
      throw new Error('Gemini turn completed without generating a new image tile (Timeout or text-only response).');
    }

    // 8. Convert image to base64 dataUrl
    const dataUrl = await fetchImageAsBase64(foundImage);
    return {
      success: true,
      dataUrl,
      prompt: promptText
    };
  }

  // -----------------------------------------------------------------
  // Message Listener from Background Worker / Dashboard
  // -----------------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
      sendResponse({ status: 'READY', url: window.location.href });
      return true;
    }

    if (request.type === 'GENERATE_TURN') {
      executeTurn(request.prompt, request.options || {})
        .then(result => sendResponse(result))
        .catch(err => {
          console.error('[RenderX] Turn error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep message channel open for async response
    }
  });

})();
