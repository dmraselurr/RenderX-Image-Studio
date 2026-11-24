/**
 * RenderX Image Studio - Gemini Canvas Bridge Engine
 * Communicates with Gemini Web Session / Canvas Shim via PostMessage RPC.
 */

class CanvasEngine {
  /**
   * Attempts to generate image via Gemini Canvas postMessage bridge or browser session.
   * If Canvas bridge is not connected (e.g. outside Gemini Canvas environment),
   * it fails quickly so the Auto-Fallback immediately routes to Pollinations FLUX.
   * @param {string} prompt 
   * @param {Object} options 
   * @returns {Promise<Blob>}
   */
  static async generate(prompt, options = {}) {
    const { aspectRatio = 'square', charImage = null, styleImage = null } = options;

    // Check if running inside Gemini Canvas Iframe shim
    const isInsideCanvas = window.parent && window.parent !== window;

    if (isInsideCanvas) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', handleResponse);
          reject(new Error('Gemini Canvas RPC Timeout (Falling back to FLUX)'));
        }, 30000);

        const requestId = 'rx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        function handleResponse(event) {
          if (event.data && event.data.requestId === requestId) {
            clearTimeout(timeout);
            window.removeEventListener('message', handleResponse);

            if (event.data.error) {
              reject(new Error(event.data.error));
            } else if (event.data.blob) {
              resolve(event.data.blob);
            } else if (event.data.base64) {
              const byteCharacters = atob(event.data.base64.split(',')[1] || event.data.base64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              resolve(new Blob([byteArray], { type: 'image/png' }));
            } else {
              reject(new Error('Unknown Canvas response format'));
            }
          }
        }

        window.addEventListener('message', handleResponse);

        // Send generation command to host Gemini container
        window.parent.postMessage({
          type: 'GENERATE_IMAGE',
          requestId,
          prompt,
          aspectRatio,
          charImage,
          styleImage
        }, '*');
      });
    }

    // If outside Canvas iframe, signal fallback requirement
    throw new Error('Gemini Canvas Web Bridge not active in standalone tab. Auto-switching to FLUX.1.');
  }
}

// Global export
window.CanvasEngine = CanvasEngine;
