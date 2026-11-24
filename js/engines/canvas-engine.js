/**
 * RenderX Image Studio - Gemini Canvas Engine (v1.0.5 PRO)
 * Dual-URL Bridge with Auto-Tab Launch, Frame Routing & Resilient Retries
 * Primary App URL: https://share.gemini.google/cTnZQ3bpoER7
 * Fallback App URL: https://gemini.google.com/share/f8350ff50be0
 */

class CanvasEngine {
  static PRIMARY_CANVAS_URL = 'https://share.gemini.google/cTnZQ3bpoER7';
  static FALLBACK_CANVAS_URL = 'https://gemini.google.com/share/f8350ff50be0';

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
   * Locate an open Gemini tab (share or app), or auto-launch one
   */
  static async getOrCreateGeminiTab() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const tabs = await chrome.tabs.query({
          url: [
            "*://gemini.google.com/*",
            "*://share.gemini.google/*",
            "*://*.googleusercontent.com/*"
          ]
        });
        if (tabs && tabs.length > 0) {
          return tabs[0];
        }

        // Auto-launch Canvas session tab if not already open
        console.log('[RenderX] No active Canvas tab found. Auto-launching Canvas session...');
        const newTab = await new Promise(resolve => {
          chrome.tabs.create({ url: CanvasEngine.PRIMARY_CANVAS_URL, active: false }, resolve);
        });

        // Allow 5s for the shared Canvas iframe to mount
        await new Promise(r => setTimeout(r, 5000));
        return newTab;
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

    const geminiTab = await CanvasEngine.getOrCreateGeminiTab();
    if (!geminiTab) {
      throw new Error('Unable to detect or launch Gemini Canvas tab (No active extension tab bridge).');
    }

    if (geminiTab.id && chrome.tabs && chrome.tabs.sendMessage) {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Canvas bridge response timeout (45s).'));
        }, 46000);

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
            reject(new Error(res?.error || 'Canvas frame returned no image.'));
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

    throw new Error('Canvas session did not produce a valid image tile.');
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
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    throw new Error(`Gemini Canvas failed after ${maxRetries} attempts: ${lastError?.message || 'Timeout'}`);
  }
}

// Global export
window.CanvasEngine = CanvasEngine;
