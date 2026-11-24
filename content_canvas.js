/**
 * RenderX Image Studio - Gemini Canvas Account-Level Content Script
 * Injected into https://gemini.google.com/*
 * Drives Gemini web chat session to generate bulk images with 100% Google session auth.
 */

(function () {
  console.log('[RenderX Canvas] Content script active on:', window.location.href);

  // Announce presence
  try {
    chrome.runtime.sendMessage({ type: 'RENDERX_CANVAS_READY', url: window.location.href });
  } catch (e) {}

  /**
   * Resilient Input Box Selector
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
   * Resilient Send Button Selector
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

    const allButtons = Array.from(document.querySelectorAll('button'));
    return allButtons.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      return (label.includes('send') || title.includes('send')) && !b.disabled;
    }) || null;
  }

  /**
   * Check if generation is in progress (Stop button visible)
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
   * Collect high-res candidate images in conversation
   */
  function getRenderedImages() {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.filter(img => {
      if (!img.src) return false;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const isAvatar = img.src.includes('profile') || img.src.includes('avatar') || img.src.includes('emoji');
      return (w > 256 || h > 256 || img.src.includes('googleusercontent.com')) && !isAvatar;
    });
  }

  /**
   * Fetch image as Base64 Data URL using browser session credentials
   */
  async function fetchImageAsBase64(imgElement) {
    const src = imgElement.src;
    if (src.startsWith('data:image')) return src;

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

    // 2. Fetch using session credentials
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
      throw new Error(`Failed to extract image: ${err.message}`);
    }
  }

  /**
   * Execute single turn
   */
  async function executeTurn(promptText, options = {}) {
    console.log('[RenderX Canvas] Executing turn for prompt:', promptText.slice(0, 60));

    // 1. Find input box
    let inputBox = findInputBox();
    if (!inputBox) {
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 500));
        inputBox = findInputBox();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Gemini input box not found. Ensure gemini.google.com is open and signed in.');
    }

    // Initial images set
    const initialImages = getRenderedImages();
    const initialSrcs = new Set(initialImages.map(img => img.src));

    // 2. Focus and clear
    inputBox.focus();
    await new Promise(r => setTimeout(r, 200));

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (e) {
      inputBox.innerText = '';
    }

    // 3. Insert prompt
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, promptText);
    } catch (e) {}

    if (!inserted || inputBox.innerText.trim() !== promptText.trim()) {
      inputBox.innerText = promptText;
    }

    // 4. Dispatch bubbling events
    inputBox.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: promptText
    }));
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 400));

    // 5. Click Send Button
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
      console.log('[RenderX Canvas] Send button not found, dispatching Enter key...');
      inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      inputBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    console.log('[RenderX Canvas] Prompt submitted. Waiting for generated image...');

    // 6. Polling & MutationObserver for completion
    const deadline = Date.now() + 60000;
    let foundImage = null;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1200));

      const currentImages = getRenderedImages();
      const newImgs = currentImages.filter(img => !initialSrcs.has(img.src) && (img.naturalWidth > 200 || img.width > 200));

      if (newImgs.length > 0) {
        const targetImg = newImgs[newImgs.length - 1];
        if (targetImg.complete && (targetImg.naturalWidth > 100 || targetImg.width > 100)) {
          foundImage = targetImg;
          break;
        }
      }

      if (!isGenerating()) {
        const anyNew = currentImages.filter(img => !initialSrcs.has(img.src));
        if (anyNew.length > 0) {
          foundImage = anyNew[anyNew.length - 1];
          break;
        }
      }
    }

    if (!foundImage) {
      throw new Error('Gemini turn timed out without producing an image tile.');
    }

    const dataUrl = await fetchImageAsBase64(foundImage);
    return {
      success: true,
      mediaType: 'image',
      dataUrl,
      prompt: promptText
    };
  }

  // Runtime message handler
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
      sendResponse({ status: 'READY', mode: 'gemini-canvas', url: window.location.href });
      return true;
    }

    if (request.type === 'GENERATE_CANVAS_TURN') {
      executeTurn(request.prompt, request.options || {})
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

})();
