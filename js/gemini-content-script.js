/**
 * RenderX Image Studio - Gemini Canvas Direct Automation Content Script
 * Runs inside all frames on gemini.google.com
 * Directly automates the shared Canvas app, injects prompts, clicks Generate, and extracts images.
 */

(function () {
  console.log('[RenderX] Gemini Canvas Content Script loaded in frame:', window.location.href);

  function isCanvasFrame() {
    return !!(document.querySelector('#prompts') || document.querySelector('#generate-btn'));
  }

  function getCanvasDoc() {
    if (isCanvasFrame()) {
      return document;
    }
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (doc && (doc.querySelector('#prompts') || doc.querySelector('#generate-btn'))) {
          return doc;
        }
      } catch (e) {
        // Cross-origin iframe
      }
    }
    return null;
  }

  // Auto-dismiss shared app gate ("Continue" or "Got it") and Google sign-in banners
  function dismissGates() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (txt === 'continue' || txt === 'got it') {
        try {
          btn.click();
          console.log('[RenderX] Dismissed gate:', txt);
        } catch (e) {}
      }
    }
    const closeButtons = document.querySelectorAll('button[aria-label="Close"], button[aria-label="close"]');
    for (const btn of closeButtons) {
      try { btn.click(); } catch (e) {}
    }
  }

  dismissGates();
  setInterval(dismissGates, 3000);

  // Helper to extract image as Base64 DataURL
  function imageToDataUrl(img) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 1792;
      canvas.height = img.naturalHeight || img.height || 1024;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return img.src;
    }
  }

  // Listen for messages from RenderX Image Studio
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'RENDERX_CANVAS_PING') {
      const doc = getCanvasDoc();
      sendResponse({
        success: true,
        hasCanvas: !!doc,
        isCanvasFrame: isCanvasFrame(),
        url: window.location.href
      });
      return true;
    }

    if (request.type === 'RENDERX_GENERATE_IMAGE') {
      executeSingleGeneration(request.prompt, request.aspectRatio || 'landscape', request.options || {})
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response
    }

    if (request.type === 'RENDERX_START_CANVAS_GEN') {
      executeBatchGeneration(request.payload || {})
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

  /**
   * Execute single scene generation inside the Canvas app
   */
  async function executeSingleGeneration(promptText, aspectRatio = 'landscape', options = {}) {
    dismissGates();

    // 1. Locate Canvas document
    let doc = getCanvasDoc();
    if (!doc) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        doc = getCanvasDoc();
        if (doc) break;
      }
    }

    if (!doc) {
      throw new Error('Canvas frame not found. Please ensure the Canvas tab is open and loaded.');
    }

    // 2. Switch to Image Tab if needed
    const imageTab = doc.querySelector("button[data-tab='image']");
    if (imageTab && !imageTab.classList.contains('active')) {
      imageTab.click();
      await new Promise(r => setTimeout(r, 300));
    }

    // 3. Set Aspect Ratio
    const aspectSelect = doc.querySelector('#aspectRatio');
    if (aspectSelect) {
      const val = (aspectRatio === '9:16' || aspectRatio === 'portrait') ? 'portrait' :
                  (aspectRatio === '1:1' || aspectRatio === 'square') ? 'square' : 'landscape';
      aspectSelect.value = val;
      aspectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
    }

    // 4. Fill #prompts textarea
    const promptInput = doc.querySelector('#prompts') || doc.querySelector('textarea');
    if (!promptInput) {
      throw new Error('Canvas #prompts input not found.');
    }

    const initialImages = Array.from(doc.querySelectorAll('#image-grid img, #results-grid img, .grid img, img'))
      .filter(img => img.src && (img.naturalWidth > 100 || img.width > 100));
    const initialCount = initialImages.length;

    promptInput.focus();
    promptInput.value = promptText.trim();
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));

    // 5. Click Generate button
    const generateBtn = doc.querySelector('#generate-btn') || doc.querySelector('button[id*="generate"]');
    if (!generateBtn) {
      throw new Error('Canvas #generate-btn not found.');
    }

    generateBtn.click();
    console.log('[RenderX] Triggered Canvas #generate-btn for prompt:', promptText.slice(0, 40));

    // 6. Wait for image to render (up to 40 seconds)
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));

      const currentImages = Array.from(doc.querySelectorAll('#image-grid img, #results-grid img, .grid img, img'))
        .filter(img => img.src && (img.naturalWidth > 100 || img.width > 100) && img.complete);

      if (currentImages.length > initialCount) {
        const newestImg = currentImages[currentImages.length - 1];
        const dataUrl = imageToDataUrl(newestImg);
        return { dataUrl, width: newestImg.naturalWidth, height: newestImg.naturalHeight };
      }
    }

    throw new Error('Canvas generation timed out waiting for image tile.');
  }

  /**
   * Execute batch generation
   */
  async function executeBatchGeneration(payload) {
    const { prompts = [], aspect = 'landscape', charLock = false, charDesc = '', styleLock = false, styleDesc = '' } = payload;
    dismissGates();

    let doc = getCanvasDoc();
    if (!doc) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        doc = getCanvasDoc();
        if (doc) break;
      }
    }

    if (!doc) {
      throw new Error('Canvas app frame not found.');
    }

    // Set aspect ratio
    const aspectSelect = doc.querySelector('#aspectRatio');
    if (aspectSelect) {
      const val = (aspect === '9:16' || aspect === 'portrait') ? 'portrait' :
                  (aspect === '1:1' || aspect === 'square') ? 'square' : 'landscape';
      aspectSelect.value = val;
      aspectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
    }

    // Prompts
    const promptInput = doc.querySelector('#prompts') || doc.querySelector('textarea');
    if (!promptInput) throw new Error('#prompts textarea missing');

    const fullText = prompts.map(p => (p.prompt || p)).join('\n');
    promptInput.value = fullText;
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));

    // Generate
    const generateBtn = doc.querySelector('#generate-btn');
    if (!generateBtn) throw new Error('#generate-btn missing');
    generateBtn.click();

    return { total: prompts.length, status: 'started' };
  }
})();
