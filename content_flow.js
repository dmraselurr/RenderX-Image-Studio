/**
 * RenderX Image Studio - Google Flow Account-Level Content Script
 * Injected into https://flow.google.com/* and https://labs.google/*
 * Directly drives Google Flow / VideoFX for Bulk Images, Text-to-Video, and Image-to-Video.
 */

(function () {
  console.log('[RenderX Flow] Content script active on:', window.location.href);

  // Announce presence
  try {
    chrome.runtime.sendMessage({ type: 'RENDERX_FLOW_READY', url: window.location.href });
  } catch (e) {}

  /**
   * Helper: Convert DataURL to File object for drag/drop or input upload
   */
  function dataUrlToFile(dataUrl, filename = 'reference.png') {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }

  /**
   * Helper: Switch Flow Workspace Sub-Mode
   * ('image' | 'text-to-video' | 'image-to-video')
   */
  async function switchFlowSubMode(subMode) {
    const allClickables = Array.from(document.querySelectorAll('button, [role="tab"], div[role="button"], label'));
    let targetKeyword = 'image';

    if (subMode === 'text-to-video') {
      targetKeyword = 'video';
    } else if (subMode === 'image-to-video') {
      targetKeyword = 'frames';
    }

    const matched = allClickables.find(el => {
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (subMode === 'text-to-video') {
        return (text.includes('text to video') || text === 'video') && !text.includes('frames');
      } else if (subMode === 'image-to-video') {
        return text.includes('frames to video') || text.includes('image to video') || text.includes('frames') || aria.includes('frames');
      } else {
        return (text.includes('image') || text.includes('create image')) && !text.includes('video');
      }
    });

    if (matched) {
      try {
        matched.click();
        console.log(`[RenderX Flow] Switched sub-mode to ${subMode} via element:`, matched);
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {}
    }
  }

  /**
   * Helper: Find the Flow prompt input box
   */
  function findFlowPromptInput() {
    const selectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[aria-label*="prompt" i]',
      'div[contenteditable="true"][role="textbox"]',
      'div.ql-editor',
      'textarea',
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
   * Helper: Find the Generate / Create button in Flow
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
   * Helper: Attach Reference Image for Image-to-Video
   */
  async function attachReferenceFrame(dataUrl) {
    if (!dataUrl) return;

    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      const file = dataUrlToFile(dataUrl, 'frame_ref.png');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('[RenderX Flow] Reference image attached to file input');
      await new Promise(r => setTimeout(r, 800));
    }
  }

  /**
   * Helper: Extract Media as Data URL (Image or Video)
   */
  async function extractMediaBlob(mediaEl, isVideo = false) {
    const src = mediaEl.currentSrc || mediaEl.src || (mediaEl.querySelector('source') ? mediaEl.querySelector('source').src : '');
    if (!src) throw new Error('Rendered media element has no src attribute');

    if (src.startsWith('data:')) return src;

    // Fetch using active Google session credentials
    try {
      const resp = await fetch(src, {
        method: 'GET',
        credentials: 'include'
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed to read media blob'));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('[RenderX Flow] Direct fetch note, returning raw src:', err.message);
      return src;
    }
  }

  /**
   * Execute Flow Turn (Image, Text-to-Video, Image-to-Video)
   */
  async function executeFlowTurn(promptText, subMode = 'image', referenceImage = null, options = {}) {
    console.log(`[RenderX Flow] Executing turn: subMode=${subMode}, prompt="${promptText.slice(0, 50)}..."`);

    // 1. Switch to required sub-mode
    await switchFlowSubMode(subMode);

    // 2. Attach reference image if Image-to-Video
    if (subMode === 'image-to-video' && referenceImage) {
      await attachReferenceFrame(referenceImage);
    }

    // 3. Locate and populate prompt input
    let inputBox = findFlowPromptInput();
    if (!inputBox) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        inputBox = findFlowPromptInput();
        if (inputBox) break;
      }
    }

    if (!inputBox) {
      throw new Error('Google Flow prompt input not found. Please ensure Flow workspace is open.');
    }

    // Populate prompt
    inputBox.focus();
    if (inputBox.tagName === 'TEXTAREA' || inputBox.tagName === 'INPUT') {
      inputBox.value = promptText;
    } else {
      inputBox.innerText = promptText;
    }

    inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText }));
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 400));

    // 4. Record existing media count
    const initialImages = Array.from(document.querySelectorAll('img')).map(i => i.src);
    const initialVideos = Array.from(document.querySelectorAll('video')).map(v => v.currentSrc || v.src);

    // 5. Trigger Generate
    let genBtn = findFlowGenerateButton();
    if (!genBtn) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 300));
        genBtn = findFlowGenerateButton();
        if (genBtn) break;
      }
    }

    if (genBtn) {
      genBtn.click();
      console.log('[RenderX Flow] Clicked Generate button');
    } else {
      // Fallback Enter
      inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    // 6. Observe output: 25s for Image, 120s for Video
    const isVideoMode = (subMode === 'text-to-video' || subMode === 'image-to-video');
    const timeoutMs = isVideoMode ? 120000 : 25000;
    const deadline = Date.now() + timeoutMs;

    console.log(`[RenderX Flow] Waiting for ${isVideoMode ? 'video' : 'image'} generation (timeout ${timeoutMs / 1000}s)...`);

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));

      if (isVideoMode) {
        // Look for new video element
        const currentVideos = Array.from(document.querySelectorAll('video'));
        const newVideo = currentVideos.find(v => {
          const src = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
          return src && !initialVideos.includes(src) && (v.duration > 0 || v.readyState >= 2 || v.videoWidth > 100);
        });

        if (newVideo) {
          console.log('[RenderX Flow] New video detected:', newVideo);
          const dataUrl = await extractMediaBlob(newVideo, true);
          return {
            success: true,
            mediaType: 'video',
            dataUrl,
            duration: newVideo.duration || 4.0,
            prompt: promptText
          };
        }
      } else {
        // Look for new image element
        const currentImgs = Array.from(document.querySelectorAll('img'));
        const newImg = currentImgs.find(img => {
          return img.src && !initialImages.includes(img.src) && (img.naturalWidth > 200 || img.width > 200) && !img.src.includes('avatar');
        });

        if (newImg && newImg.complete) {
          console.log('[RenderX Flow] New image detected:', newImg);
          const dataUrl = await extractMediaBlob(newImg, false);
          return {
            success: true,
            mediaType: 'image',
            dataUrl,
            prompt: promptText
          };
        }
      }
    }

    throw new Error(`Google Flow generation timed out waiting for ${isVideoMode ? 'video (.mp4)' : 'image (.png)'} output.`);
  }

  // Runtime message handler
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
      sendResponse({ status: 'READY', mode: 'google-flow', url: window.location.href });
      return true;
    }

    if (request.type === 'GENERATE_FLOW_TURN') {
      executeFlowTurn(request.prompt, request.subMode || 'image', request.referenceImage || null, request.options || {})
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

})();
