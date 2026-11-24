/**
 * RenderX Image Studio - Resilient Engine Manager
 * Strict Priority Order:
 *  1. Gemini Canvas (5 Retries, 15-20s duration)
 *  2. Google AI Studio (Imagen 3)
 *  3. Free Options (FLUX.1 / Serverless)
 */

class EngineManager {
  static composePrompt(basePrompt, options = {}) {
    let finalPrompt = basePrompt.trim();

    // 1. Inject Character details if locked
    if (options.charLock && options.charDesc && options.charDesc.trim()) {
      finalPrompt += `, Character: ${options.charDesc.trim()}`;
    }

    // 2. Inject Style details if locked
    if (options.styleLock && options.styleDesc && options.styleDesc.trim()) {
      finalPrompt += `, Style: ${options.styleDesc.trim()}`;
    }

    return finalPrompt;
  }

  /**
   * Execute with 5-retry loop and hierarchical fallback priority
   * @param {string} prompt 
   * @param {Object} options 
   * @returns {Promise<{blob: Blob, engineUsed: string}>}
   */
  static async execute(prompt, options = {}) {
    const {
      engine = 'gemini-canvas',
      autoFallback = true,
      aspectRatio = 'landscape',
      negativePrompt = '',
      charLock = false,
      charDesc = '',
      charImage = null,
      styleLock = false,
      styleDesc = '',
      styleImage = null,
      apiKey = '',
      onStatusUpdate = null,
      onEngineFallback = null
    } = options;

    const enrichedPrompt = EngineManager.composePrompt(prompt, { charLock, charDesc, styleLock, styleDesc });

    const params = {
      aspectRatio,
      negativePrompt,
      charImage,
      styleImage,
      apiKey
    };

    // -----------------------------------------------------------------
    // PRIORITY 1: GEMINI CANVAS (Primary Option with 5 Retries)
    // -----------------------------------------------------------------
    if (engine === 'gemini-canvas') {
      try {
        const blob = await CanvasEngine.generate(enrichedPrompt, params, (attempt, max) => {
          if (typeof onStatusUpdate === 'function') {
            onStatusUpdate(`Gemini Canvas (Attempt ${attempt}/${max})...`);
          }
        });
        return { blob, engineUsed: 'Gemini Canvas (Primary)' };
      } catch (canvasError) {
        console.warn('[EngineManager] Gemini Canvas exhausted 5 retries:', canvasError.message);

        if (!autoFallback) {
          throw canvasError;
        }

        // -----------------------------------------------------------------
        // PRIORITY 2: GOOGLE AI STUDIO (Imagen 3 API)
        // -----------------------------------------------------------------
        if (apiKey && apiKey.trim()) {
          try {
            if (typeof onEngineFallback === 'function') {
              onEngineFallback('Google AI Studio (Imagen 3)', 'Canvas retry limit reached');
            }
            const blob = await AIStudioEngine.generate(enrichedPrompt, params);
            return { blob, engineUsed: 'Google AI Studio (Fallback 2)' };
          } catch (aiStudioError) {
            console.warn('[EngineManager] Google AI Studio failed:', aiStudioError.message);
          }
        }

        // -----------------------------------------------------------------
        // PRIORITY 3: FREE OPTIONS (FLUX.1 / Multi-Endpoint)
        // -----------------------------------------------------------------
        if (typeof onEngineFallback === 'function') {
          onEngineFallback('Free Options (FLUX.1)', 'Switching to free tier');
        }

        try {
          const blob = await PollinationsEngine.generate(enrichedPrompt, params);
          return { blob, engineUsed: 'Free Options (Fallback 3)' };
        } catch (freeError) {
          throw new Error(`All priority engines exhausted: Canvas (${canvasError.message}) -> Free (${freeError.message})`);
        }
      }
    }

    // -----------------------------------------------------------------
    // DIRECT GOOGLE AI STUDIO EXPLICIT SELECTION
    // -----------------------------------------------------------------
    if (engine === 'google-aistudio') {
      try {
        const blob = await AIStudioEngine.generate(enrichedPrompt, params);
        return { blob, engineUsed: 'Google AI Studio' };
      } catch (err) {
        if (!autoFallback) throw err;
        if (typeof onEngineFallback === 'function') {
          onEngineFallback('Free Options (FLUX.1)', err.message);
        }
        const blob = await PollinationsEngine.generate(enrichedPrompt, params);
        return { blob, engineUsed: 'Free Options (Fallback)' };
      }
    }

    // -----------------------------------------------------------------
    // DIRECT FREE OPTIONS EXPLICIT SELECTION
    // -----------------------------------------------------------------
    const blob = await PollinationsEngine.generate(enrichedPrompt, params);
    return { blob, engineUsed: 'Free Options (FLUX.1)' };
  }
}

// Global export
window.EngineManager = EngineManager;
