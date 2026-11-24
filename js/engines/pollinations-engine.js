/**
 * RenderX Image Studio - Pollinations FLUX.1 Engine
 * Free, high-speed, zero-API-key image generation using FLUX.1 Schnell & Dev.
 */

class PollinationsEngine {
  static getDimensions(aspectRatio) {
    switch (aspectRatio) {
      case 'portrait':
        return { width: 768, height: 1344 }; // 9:16 ratio
      case 'landscape':
        return { width: 1344, height: 768 }; // 16:9 ratio
      case 'square':
      default:
        return { width: 1024, height: 1024 }; // 1:1 ratio
    }
  }

  /**
   * Generate an image using Pollinations FLUX.1
   * @param {string} prompt - Full positive prompt
   * @param {Object} options - { aspectRatio, negativePrompt, seed }
   * @returns {Promise<Blob>}
   */
  static async generate(prompt, options = {}) {
    const { aspectRatio = 'square', negativePrompt = '', seed = null } = options;
    const { width, height } = PollinationsEngine.getDimensions(aspectRatio);

    // Build enriched prompt with negative guidance if supplied
    let fullPrompt = prompt;
    if (negativePrompt && negativePrompt.trim()) {
      fullPrompt += ` | avoid: ${negativePrompt.trim()}`;
    }

    const randomSeed = seed !== null ? seed : Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(fullPrompt);

    // Pollinations image generation endpoint with FLUX model
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux&seed=${randomSeed}&nologo=true&enhance=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // 45s timeout

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'image/jpeg, image/png, image/webp, */*'
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Pollinations HTTP Error: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size < 1000) {
        throw new Error('Received invalid or empty image from Pollinations');
      }

      return blob;
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`Pollinations Generation Failed: ${err.message}`);
    }
  }
}

// Global export
window.PollinationsEngine = PollinationsEngine;
