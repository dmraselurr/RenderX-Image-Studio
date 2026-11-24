/**
 * RenderX Image Studio - Resilient Free Options Engine
 * Multi-endpoint fallback: Pollinations FLUX.1 + Turbo + Free Serverless
 * Prevents 402 Payment Required errors from stopping generation batches.
 */

class PollinationsEngine {
  static getDimensions(aspectRatio) {
    switch (aspectRatio) {
      case 'portrait':
        return { width: 768, height: 1344 };
      case 'square':
        return { width: 1024, height: 1024 };
      case 'landscape':
      default:
        return { width: 1344, height: 768 };
    }
  }

  /**
   * Generate an image using free serverless models with multi-endpoint fallback
   * @param {string} prompt 
   * @param {Object} options 
   * @returns {Promise<Blob>}
   */
  static async generate(prompt, options = {}) {
    const { aspectRatio = 'landscape', negativePrompt = '', seed = null } = options;
    const { width, height } = PollinationsEngine.getDimensions(aspectRatio);

    // Sanitize and clean prompt length to avoid URL 402/414 limits
    let cleanPrompt = prompt.trim().slice(0, 450);
    if (negativePrompt && negativePrompt.trim()) {
      cleanPrompt += `, avoid: ${negativePrompt.trim().slice(0, 100)}`;
    }

    const randomSeed = seed !== null ? seed : Math.floor(Math.random() * 999999);
    const encodedPrompt = encodeURIComponent(cleanPrompt);

    // List of resilient free endpoints and model variants
    const candidateUrls = [
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux&seed=${randomSeed}&nologo=true`,
      `https://gen.pollinations.ai/image/${encodedPrompt}?width=${width}&height=${height}&model=flux&seed=${randomSeed}&nologo=true`,
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=turbo&seed=${randomSeed}&nologo=true`,
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`
    ];

    let lastError = null;

    for (const url of candidateUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Accept': 'image/jpeg, image/png, image/webp, */*'
          }
        });

        clearTimeout(timeout);

        if (response.ok) {
          const blob = await response.blob();
          if (blob && blob.size > 1500) {
            return blob;
          }
        } else {
          lastError = new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        clearTimeout(timeout);
        lastError = err;
      }
    }

    throw new Error(`Free Options Engine exhausted candidates: ${lastError?.message || 'Failed'}`);
  }
}

// Global export
window.PollinationsEngine = PollinationsEngine;
