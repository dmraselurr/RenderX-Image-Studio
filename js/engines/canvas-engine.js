/**
 * RenderX Image Studio - Gemini Canvas Engine
 * 5-Retry Resilient Bridge with Tab Communication & Direct RPC Support
 */

class CanvasEngine {
  /**
   * Attempt to find an active Gemini tab or use web session credentials
   */
  static async getGeminiTab() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const tabs = await chrome.tabs.query({ url: "*://gemini.google.com/*" });
        if (tabs && tabs.length > 0) {
          return tabs[0];
        }
      } catch (e) {
        console.warn('Chrome tabs query error:', e);
      }
    }
    return null;
  }

  /**
   * Execute single Gemini Canvas generation attempt
   */
  static async attemptGeneration(prompt, options = {}) {
    const { aspectRatio = 'landscape' } = options;

    // 1. Check if running inside iframe shim (e.g. Canvas share page)
    if (window.parent && window.parent !== window) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', handleResponse);
          reject(new Error('Canvas iframe postMessage timeout'));
        }, 18000);

        const requestId = 'rx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

        function handleResponse(event) {
          if (event.data && event.data.requestId === requestId) {
            clearTimeout(timeout);
            window.removeEventListener('message', handleResponse);
            if (event.data.error) reject(new Error(event.data.error));
            else if (event.data.blob) resolve(event.data.blob);
            else if (event.data.base64) {
              const byteCharacters = atob(event.data.base64.split(',')[1] || event.data.base64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              resolve(new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' }));
            } else {
              reject(new Error('Unknown Canvas response'));
            }
          }
        }

        window.addEventListener('message', handleResponse);
        window.parent.postMessage({
          type: 'GENERATE_IMAGE',
          requestId,
          prompt,
          aspectRatio
        }, '*');
      });
    }

    // 2. Extension Tab Communication Bridge
    const geminiTab = await CanvasEngine.getGeminiTab();
    if (geminiTab && geminiTab.id && chrome.tabs.sendMessage) {
      try {
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Gemini tab bridge timeout')), 15000);
          chrome.tabs.sendMessage(geminiTab.id, {
            type: 'RENDERX_GENERATE_IMAGE',
            prompt,
            aspectRatio
          }, (res) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res);
          });
        });

        if (response && response.blob) return response.blob;
      } catch (tabErr) {
        // Fall through to Direct RPC
      }
    }

    // 3. Direct Gemini Web RPC with session cookies
    // Endpoint used by Gemini web for Imagen 3 batch execution
    const rpcUrl = 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=q4uTj&source-path=%2Fapp';
    const payloadData = JSON.stringify([[[ "q4uTj", JSON.stringify([prompt, 1, aspectRatio]), null, "generic" ]]]);
    const body = new URLSearchParams({ 'f.req': payloadData });

    const rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: body.toString(),
      credentials: 'include' // Sends logged-in Google session cookies
    });

    if (!rpcResponse.ok) {
      throw new Error(`Gemini Web Session HTTP ${rpcResponse.status}`);
    }

    const text = await rpcResponse.text();
    // Parse Google RPC envelope format: )]}' \n <length> \n [[...]]
    const cleanJsonText = text.replace(/^\)\]\}'\s*/, '');
    const jsonMatch = cleanJsonText.match(/\[\[.*\]\]/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const imagePayload = parsed[0]?.[2];
      if (imagePayload) {
        const innerData = JSON.parse(imagePayload);
        const imageUrl = innerData?.[0]?.[0] || innerData?.imageUrl;
        if (imageUrl) {
          const imgFetch = await fetch(imageUrl);
          return await imgFetch.blob();
        }
      }
    }

    throw new Error('Gemini Canvas active session not responding');
  }

  /**
   * Main Generate method with 5-Retry Loop (15-20 seconds total)
   * @param {string} prompt 
   * @param {Object} options 
   * @param {Function} [onRetry] - Status update callback
   * @returns {Promise<Blob>}
   */
  static async generate(prompt, options = {}, onRetry = null) {
    let lastError = null;
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (typeof onRetry === 'function' && attempt > 1) {
          onRetry(attempt, maxRetries);
        }

        const blob = await CanvasEngine.attemptGeneration(prompt, options);
        if (blob && blob.size > 1000) {
          return blob;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini Canvas] Attempt ${attempt}/${maxRetries} failed:`, err.message);

        // Wait 2-3 seconds between retries (total 15-20s duration)
        if (attempt < maxRetries) {
          const delayMs = 2000 + (attempt * 500);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(`Gemini Canvas failed after ${maxRetries} retries (${lastError?.message || 'Timeout'})`);
  }
}

// Global export
window.CanvasEngine = CanvasEngine;
