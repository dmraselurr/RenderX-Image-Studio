/**
 * RenderX Image Studio - Gemini Canvas Direct Automation Content Script
 * Runs inside https://gemini.google.com/share/* and https://share.gemini.google/*
 * Directly automates the shared Canvas app, injects prompts, clicks Generate, and streams images back.
 */

(function () {
  console.log('[RenderX] Gemini Canvas Automation Content Script Initialized');

  // Helper to find the Canvas iframe
  function getCanvasFrame() {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (doc && (doc.querySelector('#prompts') || doc.querySelector('textarea'))) {
          return { frame: iframe, doc, win: iframe.contentWindow };
        }
      } catch (e) {
        // Cross-origin iframe fallback: communicate via postMessage
      }
    }
    return null;
  }

  // Listen for messages from RenderX Image Studio
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'RENDERX_CANVAS_PING') {
      sendResponse({ success: true, status: 'Connected 🟢', url: window.location.href });
      return true;
    }

    if (request.type === 'RENDERX_START_CANVAS_GEN') {
      executeCanvasGeneration(request.payload)
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response
    }
  });

  async function executeCanvasGeneration(payload) {
    const { prompts, aspect = 'landscape', charLock = false, charDesc = '', styleLock = false, styleDesc = '' } = payload;

    // Handle initial "Continue" or "Got it" shared app gates if present on host page
    const gateButtons = document.querySelectorAll('button');
    for (const btn of gateButtons) {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (txt === 'continue' || txt === 'got it') {
        btn.click();
        await new Promise(r => setTimeout(r, 1000));
        break;
      }
    }

    // Dismiss Google sign-in overlay banner if present
    const closeButtons = document.querySelectorAll('button[aria-label="Close"], button');
    for (const btn of closeButtons) {
      if ((btn.getAttribute('aria-label') || '').toLowerCase().includes('close')) {
        btn.click();
        break;
      }
    }

    // Locate the Canvas DOM
    let target = getCanvasFrame();
    if (!target) {
      // Wait up to 15 seconds for iframe to load
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        target = getCanvasFrame();
        if (target) break;
      }
    }

    if (!target) {
      throw new Error('Canvas app iframe not found. Please ensure the shared Canvas is fully loaded.');
    }

    const { doc, win } = target;

    // 1. Switch to Image Tab if needed
    const imageTab = doc.querySelector('button[data-tab="image"], button.tab-btn');
    if (imageTab && !imageTab.classList.contains('active')) {
      imageTab.click();
      await new Promise(r => setTimeout(r, 400));
    }

    // 2. Set Aspect Ratio
    const aspectSelect = doc.querySelector('#aspectRatio');
    if (aspectSelect) {
      const val = (aspect === '9:16' || aspect === 'portrait') ? 'portrait' :
                  (aspect === '1:1' || aspect === 'square') ? 'square' : 'landscape';
      aspectSelect.value = val;
      aspectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
    }

    // 3. Set Character Consistency if requested
    if (charLock) {
      const ccToggle = doc.querySelector('#ccToggle');
      if (ccToggle && !ccToggle.checked) {
        ccToggle.checked = true;
        ccToggle.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
      }
      const ccText = doc.querySelector('textarea.cc-text-input, #ccDesc');
      if (ccText && charDesc) {
        ccText.value = charDesc;
        ccText.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // 4. Set Style Consistency if requested
    if (styleLock) {
      const scToggle = doc.querySelector('#scToggle');
      if (scToggle && !scToggle.checked) {
        scToggle.checked = true;
        scToggle.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
      }
      const scText = doc.querySelector('textarea.sc-text-input, #scText, #scDesc');
      if (scText && styleDesc) {
        scText.value = styleDesc;
        scText.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // 5. Fill Prompts Textarea
    const promptInput = doc.querySelector('#prompts, textarea');
    if (!promptInput) {
      throw new Error('Could not find #prompts textarea inside Canvas');
    }

    const fullPromptText = prompts.map(p => p.prompt || p).join('\n');
    promptInput.value = fullPromptText;
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));

    // Verify counter matches
    const counterEl = doc.querySelector('#prompt-count');
    console.log('[RenderX] Injected prompts. Counter reads:', counterEl ? counterEl.textContent : 'N/A');

    // 6. Click Generate Button
    const generateBtn = doc.querySelector('#generate-btn, button[id*="generate"]');
    if (!generateBtn) {
      throw new Error('Could not find #generate-btn in Canvas');
    }

    generateBtn.click();
    console.log('[RenderX] Clicked #generate-btn inside Canvas');

    // 7. Poll and monitor the Image Grid for output images
    const totalScenes = prompts.length;
    const capturedImages = new Array(totalScenes).fill(null);
    let completedCount = 0;

    const startTime = Date.now();
    const maxWaitMs = 180000; // 3 minutes max for large batches

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, 2000));

      // Scan grid for rendered images
      const imgElements = doc.querySelectorAll('#image-grid img, .gallery-grid img, img[src^="blob:"]');
      imgElements.forEach((img, idx) => {
        if (idx < totalScenes && !capturedImages[idx] && img.src && img.complete && img.naturalWidth > 100) {
          capturedImages[idx] = img.src;
          completedCount++;

          // Send individual scene image back to RenderX Studio
          chrome.runtime.sendMessage({
            type: 'RENDERX_CANVAS_IMAGE_EMITTED',
            index: idx + 1,
            src: img.src
          });
        }
      });

      if (completedCount >= totalScenes) {
        break;
      }
    }

    return {
      total: totalScenes,
      completed: completedCount,
      images: capturedImages
    };
  }
})();
