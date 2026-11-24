/**
 * RenderX Image Studio - Gemini Canvas Engine
 * 5-Retry Resilient Bridge with Active Tab Communication & Direct DOM Frame Extraction
 */

class CanvasEngine {
  /**
   * Helper to convert Base64 DataURL to Blob
   */
  static dataUrlToBlob(dataUrl) {
    if (!dataUrl) return null;
    if (dataUrl.startsWith('data:image')) {
      const parts = dataUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const binary = atob(parts[1]);
      const array = [];
      for (let i = 0; i < binary.length; i++) {
        array.push(binary.charCodeAt(i));
      }
      return new Blob([new Uint8Array(array)], { type: mime || 'image/png' });
    }
    return null;
  }

  /**
   * Locate an open Gemini tab (share or app)
   */
  static async getGeminiTab() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const tabs = await chrome.tabs.query({ url: ["*://gemini.google.com/*", "*://share.gemini.google/*"] });
        if (tabs && tabs.length > 0) {
          return tabs[0];
        }
      } catch (e) {
        console.warn('[RenderX] Chrome tabs query error:', e);
      }
    }
    return null;
  }

  /**
   * Execute single Gemini Canvas generation attempt
   */
  static async attemptGeneration(prompt, options = {}) {
    const { aspectRatio = 'landscape' } = options;

    // 1. Extension Tab Communication Bridge
    const geminiTab = await CanvasEngine.getGeminiTab();
    if (!geminiTab) {
      throw new Error('Gemini Canvas tab not detected. Click [🔑 Open Canvas] in Box 1 to launch your session.');
    }

    if (geminiTab.id && chrome.tabs && chrome.tabs.sendMessage) {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Canvas bridge response timeout (45s). Ensure Canvas tab is active.'));
        }, 50000);

        chrome.tabs.sendMessage(geminiTab.id, {
          type: 'RENDERX_GENERATE_IMAGE',
          prompt,
          aspectRatio,
          options
        }, (res) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!res || !res.success) {
            reject(new Error(res?.error || 'Canvas returned an empty response'));
          } else {
            resolve(res);
          }
        });
      });

      if (response && response.dataUrl) {
        const blob = CanvasEngine.dataUrlToBlob(response.dataUrl);
        if (blob && blob.size > 1000) {
          return blob;
        }
      }
    }

    throw new Error('Gemini Canvas active session did not return an image tile.');
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
        if (typeof onRetry === 'function') {
          onRetry(attempt, maxRetries);
        }

        const blob = await CanvasEngine.attemptGeneration(prompt, options);
        if (blob && blob.size > 1000) {
          return blob;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[RenderX] Canvas attempt ${attempt}/${maxRetries} failed:`, err.message);

        if (attempt < maxRetries) {
          // 2.5s backoff between retries
          await new Promise(r => setTimeout(r, 2500));
        }
      }
    }

    throw new Error(`Gemini Canvas failed after ${maxRetries} attempts: ${lastError?.message || 'Timeout'}`);
  }
}

// Global export
window.CanvasEngine = CanvasEngine;
