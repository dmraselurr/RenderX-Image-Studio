/**
 * RenderX Image Studio - Google Flow Isolated Content Relay
 * 1. Bridges background.js <-> MAIN world flow_page_bridge.js.
 * 2. Executes initial Shot #1 in left-pane Flow UI when no captured payload template exists yet.
 */

(function () {
  if (window.__renderexFlowLoaded) return;
  window.__renderexFlowLoaded = true;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'RENDERX_FLOW_BRIDGE') return;

    if (data.type === 'CAPTURED_FLOW_RAW') {
      chrome.runtime.sendMessage({
        type: 'CAPTURED_FLOW_RAW',
        url: data.url,
        headers: data.headers,
        body: data.body,
        promptHint: data.promptHint,
        siteKey: data.siteKey,
        isMediaGen: data.isMediaGen
      }).catch(() => {});
    }

    if (data.type === 'MAIN_BATCH_SHOT_RESULT') {
      chrome.runtime.sendMessage({
        type: 'MAIN_BATCH_SHOT_RESULT',
        engine: 'google-flow',
        batchId: data.batchId,
        index: data.index,
        ok: data.ok,
        httpStatus: data.httpStatus,
        dataUrl: data.dataUrl,
        imageUrl: data.imageUrl,
        error: data.error
      }).catch(() => {});
    }

    if (data.type === 'MAIN_BATCH_DONE') {
      chrome.runtime.sendMessage({
        type: 'MAIN_BATCH_DONE',
        engine: 'google-flow',
        batchId: data.batchId
      }).catch(() => {});
    }
  });

  function isVisible(el) {
    return el && (el.offsetParent !== null || el.getClientRects().length > 0);
  }

  function forceRealClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {}
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const pOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
    const mOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', pOpts));
    el.dispatchEvent(new MouseEvent('mousedown', mOpts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...pOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...mOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...mOpts, buttons: 0 }));
    return true;
  }

  async function executeFlowLeftPaneTurn(promptText, subMode = 'image') {
    const clickables = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(isVisible);
    const newProjBtn = clickables.find(b => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      return t === 'new project' || t.includes('new project') || t === 'create project';
    });
    if (newProjBtn) {
      forceRealClick(newProjBtn);
      await new Promise(r => setTimeout(r, 2500));
    }

    if (subMode === 'image') {
      const pills = Array.from(document.querySelectorAll('button, [role="button"], [role="combobox"]')).filter(isVisible);
      const videoPill = pills.find(el => {
        const rect = el.getBoundingClientRect();
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        return rect.top > window.innerHeight * 0.4 && (t === 'video' || t.includes('to video')) && !t.includes('image');
      });
      if (videoPill) {
        forceRealClick(videoPill);
        await new Promise(r => setTimeout(r, 350));
        const opts = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, div[role="button"]')).filter(isVisible);
        const imgOpt = opts.find(el => {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          return (t === 'image' || t === 'create image' || t === 'images') && !t.includes('video');
        });
        if (imgOpt) {
          forceRealClick(imgOpt);
          await new Promise(r => setTimeout(r, 350));
        }
      }
    }

    const inputBox = ['textarea[placeholder*="describe" i]', 'textarea[placeholder*="prompt" i]', 'textarea', 'div[contenteditable="true"][role="textbox"]']
      .map(s => document.querySelector(s))
      .find(isVisible);

    if (!inputBox) {
      throw new Error('Google Flow prompt input not found in left pane.');
    }

    inputBox.focus();
    if (inputBox.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(inputBox, promptText);
    } else {
      inputBox.innerText = promptText;
    }
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));

    const preSrcs = new Set();
    document.querySelectorAll('img, video').forEach(el => {
      if (el.src) preSrcs.add(el.src);
      if (el.currentSrc) preSrcs.add(el.currentSrc);
    });

    await new Promise(r => setTimeout(r, 150));

    const candidates = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(isVisible);
    let submitBtn = candidates.find(b => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return t === '→' || t === 'arrow_forward' || t === 'send' || t === 'generate' || aria.includes('generate') || aria.includes('submit');
    });

    if (!submitBtn) {
      const ir = inputBox.getBoundingClientRect();
      const nearby = candidates.filter(b => {
        if (!b.querySelector('svg')) return false;
        const r = b.getBoundingClientRect();
        return r.top >= ir.top - 20 && r.bottom <= ir.bottom + 80 && r.left >= ir.left && r.width >= 24 && r.width <= 64;
      }).sort((a, b) => (b.getBoundingClientRect().right + b.getBoundingClientRect().bottom) - (a.getBoundingClientRect().right + a.getBoundingClientRect().bottom));
      submitBtn = nearby[0] || null;
    }

    if (submitBtn) {
      if (submitBtn.disabled) submitBtn.removeAttribute('disabled');
      forceRealClick(submitBtn);
    }
    inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

    const isVideo = subMode.includes('video');
    const timeoutMs = isVideo ? 90000 : 35000;

    return await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(poller);
        reject(new Error('Flow left-pane sync timed out (ensure signed in to Google Flow).'));
      }, timeoutMs);

      async function checkOutput() {
        if (settled) return;
        const nodes = Array.from(document.querySelectorAll(isVideo ? 'video' : 'img'));
        for (const el of nodes) {
          const src = el.currentSrc || el.src;
          if (!src || preSrcs.has(src)) continue;
          const lower = src.toLowerCase();
          if (lower.includes('avatar') || lower.includes('profile') || lower.includes('icon') || lower.includes('logo')) continue;

          const ready = isVideo
            ? (el.readyState >= 2 || el.videoWidth > 100)
            : (el.complete && el.naturalWidth > 256);

          if (ready) {
            settled = true;
            clearTimeout(timer);
            clearInterval(poller);
            resolve({ ok: true, imageUrl: src, mediaType: isVideo ? 'video' : 'image' });
            return;
          }
        }
      }

      const poller = setInterval(checkOutput, 600);
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return false;

    if (request.type === 'PING') {
      sendResponse({ status: 'READY', mode: 'google-flow-relay', url: window.location.href });
      return true;
    }

    if (request.type === 'EXECUTE_FLOW_MAIN_BATCH') {
      window.postMessage({
        source: 'RENDERX_FLOW_CS',
        type: 'EXECUTE_FLOW_MAIN_BATCH',
        items: request.items,
        template: request.template,
        batchId: request.batchId
      }, '*');
      sendResponse({ ok: true, dispatched: true });
      return true;
    }

    if (request.type === 'RUN_FLOW_LEFT_PANE_TURN') {
      executeFlowLeftPaneTurn(request.prompt, request.subMode || 'image')
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
})();
