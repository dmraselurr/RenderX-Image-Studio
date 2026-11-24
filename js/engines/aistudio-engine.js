/**
 * RenderX Image Studio - Google AI Studio (Imagen 3) Engine
 * Official developer API integration for Imagen 3 (imagen-3.0-generate-002).
 */

class AIStudioEngine {
  static formatAspectRatio(ratio) {
    switch (ratio) {
      case 'portrait':
        return '9:16';
      case 'landscape':
        return '16:9';
      case 'square':
      default:
        return '1:1';
    }
  }

  /**
   * Generate image via Google AI Studio Imagen 3
   * @param {string} prompt 
   * @param {Object} options - { apiKey, aspectRatio }
   * @returns {Promise<Blob>}
   */
  static async generate(prompt, options = {}) {
    const { apiKey, aspectRatio = 'square' } = options;

    if (!apiKey || !apiKey.trim()) {
      throw new Error('Google AI Studio API Key is missing. Please add it in settings.');
    }

    const targetRatio = AIStudioEngine.formatAspectRatio(aspectRatio);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey.trim())}`;

    const payload = {
      instances: [
        { prompt }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: targetRatio,
        personGeneration: 'ALLOW_ADULT',
        outputOptions: {
          mimeType: 'image/png'
        }
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.error?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`Google Imagen 3 API Error: ${msg}`);
    }

    const data = await response.json();
    const base64Data = data.predictions?.[0]?.bytesBase64Encoded;

    if (!base64Data) {
      throw new Error('Imagen 3 returned empty image data.');
    }

    // Convert Base64 to Blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    return new Blob([byteArray], { type: 'image/png' });
  }
}

// Global export
window.AIStudioEngine = AIStudioEngine;
