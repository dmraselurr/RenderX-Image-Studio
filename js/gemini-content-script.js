/**
 * RenderX Image Studio - Gemini Canvas Direct Automation Content Script
 * Runs inside all frames on gemini.google.com (including sandboxed Canvas iframe)
 * Direct DOM automation for Bulk Image Generator app
 */

(function () {
  const isTopFrame = (window.self === window.top);

  function isCanvasFrame() {
    return !!(document.querySelector('#prompts') || document.querySelector('#generate-btn'));
  }

  console.log(`[RenderX] Content script active. isTop: ${isTopFrame}, hasCanvas: ${isCanvasFrame()}`);

  // Auto-dismiss shared app gates ("Continue" or "Got it") and Google banners
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
  setInterval(dismissGates, 2500);

  // Helper to extract image as high-res DataURL via canvas
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

  // -------------------------------------------------------------
  // Inside Canvas Child Frame Automation Execution
  // -------------------------------------------------------------
  async function runSingleGenerationInFrame(promptText, aspectRatio = 'landscape', options = {}) {
    dismissGates();

    // 1. Switch to Image Tab if needed
    const imageTab = document.querySelector("button[data-tab='image']");
    if (imageTab && !imageTab.classList.contains('active')) {
      imageTab.click();
      await new Promise(r => setTimeout(r, 400));
    }

    // 2. Set Aspect Ratio
    const aspectSelect = document.querySelector('#aspectRatio') || document.querySelector('select');
    if (aspectSelect) {
      const val = (aspectRatio === '9:16' || aspectRatio === 'portrait') ? 'portrait' :
                  (aspectRatio === '1:1' || aspectRatio === 'square') ? 'square' : 'landscape';
      aspectSelect.value = val;
      aspectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
    }

    // 3. Optional Character Lock
    if (options.charLock && options.charDesc) {
      const ccToggle = document.querySelector('#ccToggle');
      if (ccToggle && !ccToggle.checked) {
        ccToggle.checked = true;
        ccToggle.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
      }
      const ccText = document.querySelector('textarea.cc-text-input, #ccDesc');
      if (ccText) {
        ccText.value = options.charDesc;
        ccText.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // 4. Optional Style Lock
    if (options.styleLock && options.styleDesc) {
      const scToggle = document.querySelector('#scToggle');
      if (scToggle && !scToggle.checked) {
        scToggle.checked = true;
        scToggle.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
      }
      const scText = document.querySelector('textarea.sc-text-input, #scText');
      if (scText) {
        scText.value = options.styleDesc;
        scText.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // 5. Fill Prompts Textarea
    const promptInput = document.querySelector('#prompts') || document.querySelector('textarea');
    if (!promptInput) {
      throw new Error('Canvas #prompts textarea not found inside frame.');
    }

    const initialImages = Array.from(document.querySelectorAll('#image-grid img, #results-grid img, .grid img, img'))
      .filter(img => img.src && (img.naturalWidth > 120 || img.width > 120));
    const initialCount = initialImages.length;

    promptInput.focus();
    promptInput.value = promptText.trim();
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));

    // 6. Click Generate Button
    const generateBtn = document.querySelector('#generate-btn') || 
      document.querySelector('button[id*="generate"]') ||
      Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').toLowerCase().includes('generate'));

    if (!generateBtn) {
      throw new Error('Canvas #generate-btn not found inside frame.');
    }

    generateBtn.click();
    console.log('[RenderX] Clicked #generate-btn in Canvas frame. Waiting for rendered image...');

    // 7. Poll for output image (up to 45 seconds)
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));

      const currentImages = Array.from(document.querySelectorAll('#image-grid img, #results-grid img, .grid img, img'))
        .filter(img => img.src && (img.naturalWidth > 120 || img.width > 120) && img.complete);

      if (currentImages.length > initialCount) {
        const newestImg = currentImages[currentImages.length - 1];
        const dataUrl = imageToDataUrl(newestImg);
        return { dataUrl, width: newestImg.naturalWidth, height: newestImg.naturalHeight };
      }
    }

    throw new Error('Canvas generation timed out waiting for image tile.');
  }

  // -------------------------------------------------------------
  // Message Handling: Dual Direct & postMessage Bridge
  // -------------------------------------------------------------

  // Listen for direct Chrome Extension messages (sent to tab or specific frame)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'RENDERX_CANVAS_PING') {
      if (isCanvasFrame()) {
        sendResponse({ success: true, hasCanvas: true, isCanvasFrame: true, url: window.location.href });
      } else {
        // Forward ping to child iframes
        forwardToIframes(request);
        sendResponse({ success: true, hasCanvas: false, isCanvasFrame: false, isTop: isTopFrame });
      }
      return true;
    }

    if (request.type === 'RENDERX_GENERATE_IMAGE') {
      if (isCanvasFrame()) {
        runSingleGenerationInFrame(request.prompt, request.aspectRatio, request.options)
          .then(res => sendResponse({ success: true, ...res }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
      } else {
        // Top frame: Forward down to child iframes via postMessage
        forwardToIframesWithResponse(request, sendResponse);
        return true;
      }
    }
  });

  // Forward helper for top frame
  function forwardToIframes(req) {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(f => {
      try {
        f.contentWindow.postMessage({ fromRenderXParent: true, req }, '*');
      } catch (e) {}
    });
  }

  function forwardToIframesWithResponse(req, sendResponse) {
    const iframes = document.querySelectorAll('iframe');
    const reqId = 'rx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    function onMsg(e) {
      if (e.data && e.data.fromRenderXChild && e.data.reqId === reqId) {
        window.removeEventListener('message', onMsg);
        sendResponse(e.data.response);
      }
    }
    window.addEventListener('message', onMsg);
    setTimeout(() => {
      window.removeEventListener('message', onMsg);
      sendResponse({ success: false, error: 'Canvas child iframe bridge timeout' });
    }, 48000);

    iframes.forEach(f => {
      try {
        f.contentWindow.postMessage({ fromRenderXParent: true, req, reqId }, '*');
      } catch (e) {}
    });
  }

  // Child frame listener for forwarded parent messages
  window.addEventListener('message', async (event) => {
    if (event.data && event.data.fromRenderXParent && isCanvasFrame()) {
      const { req, reqId } = event.data;
      if (req.type === 'RENDERX_GENERATE_IMAGE') {
        try {
          const res = await runSingleGenerationInFrame(req.prompt, req.aspectRatio, req.options);
          window.parent.postMessage({ fromRenderXChild: true, reqId, response: { success: true, ...res } }, '*');
        } catch (err) {
          window.parent.postMessage({ fromRenderXChild: true, reqId, response: { success: false, error: err.message } }, '*');
        }
      }
    }
  });

})();
