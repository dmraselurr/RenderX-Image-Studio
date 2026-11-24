/**
 * RenderX Image Studio - Engine Manager
 * Orchestrates multi-engine generation with automatic fallback protection.
 * Ensures image generation NEVER stops on error or rate-limits.
 */

class EngineManager {
  /**
   * Build complete enhanced prompt injecting Character and Style locks if enabled.
   */
  static composePrompt(basePrompt, options = {}) {
    let finalPrompt = basePrompt.trim();

    // 1. Inject Character details if locked
    if (options.charLock && options.charDesc && options.charDesc.trim()) {
      finalPrompt += `, Character appearance: ${options.charDesc.trim()}`;
    }

    // 2. Inject Style details if locked
    if (options.styleLock && options.styleDesc && options.styleDesc.trim()) {
      finalPrompt += `, Visual style: ${options.styleDesc.trim()}`;
    }

    return finalPrompt;
  }

  /**
   * Execute image generation with automatic fallback resilience.
   * @param {string} prompt 
   * @param {Object} options - { engine, autoFallback, aspectRatio, negativePrompt, charLock, charDesc, styleLock, styleDesc, apiKey, onEngineFallback }
   * @returns {Promise<{blob: Blob, engineUsed: string}>}
   */
  static async execute(prompt, options = {}) {
    const {
      engine = 'gemini-canvas',
      autoFallback = true,
      aspectRatio = 'square',
      negativePrompt = '',
      charLock = false,
      charDesc = '',
      charImage = null,
      styleLock = false,
      styleDesc = '',
      styleImage = null,
      apiKey = '',
      onEngineFallback = null
    } = options;

    const enrichedPrompt = EngineManager.composePrompt(prompt, { charLock, charDesc, styleLock, styleDesc });

    const engineParams = {
      aspectRatio,
      negativePrompt,
      charImage,
      styleImage,
      apiKey
    };

    // Primary Engine Execution
    try {
      if (engine === 'gemini-canvas') {
        const blob = await CanvasEngine.generate(enrichedPrompt, engineParams);
        return { blob, engineUsed: 'Gemini Canvas' };
      } else if (engine === 'google-aistudio') {
        const blob = await AIStudioEngine.generate(enrichedPrompt, engineParams);
        return { blob, engineUsed: 'Google AI Studio (Imagen 3)' };
      } else {
        const blob = await PollinationsEngine.generate(enrichedPrompt, engineParams);
        return { blob, engineUsed: 'Pollinations FLUX.1' };
      }
    } catch (primaryError) {
      console.warn(`Primary engine (${engine}) encountered an issue:`, primaryError.message);

      // If Auto-Fallback is disabled, rethrow the error
      if (!autoFallback) {
        throw primaryError;
      }

      // Notify caller of fallback transition
      if (typeof onEngineFallback === 'function') {
        onEngineFallback('Pollinations FLUX.1', primaryError.message);
      }

      // Fallback Strategy: Pollinations FLUX.1 (Always free, open, and resilient)
      try {
        const fallbackBlob = await PollinationsEngine.generate(enrichedPrompt, engineParams);
        return { blob: fallbackBlob, engineUsed: 'Pollinations FLUX.1 (Fallback)' };
      } catch (fallbackError) {
        throw new Error(`All engines failed: ${primaryError.message} -> ${fallbackError.message}`);
      }
    }
  }
}

// Global export
window.EngineManager = EngineManager;
