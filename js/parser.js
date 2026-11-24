/**
 * RenderX Image Studio - Smart Timeline & Prompt Parser
 * Extracts script timestamps, cleans prompts, and auto-formats raw scripts.
 */

class TimelineParser {
  /**
   * Parse multiline text into structured timeline prompt items.
   * Handles:
   *  - 0.0-0.5 | Prompt text
   *  - [0.0 - 0.5s] Prompt text
   *  - 1. 0.0-0.5: Prompt text
   *  - Plain prompts (auto-computes timeline 0.0-3.0, 3.0-6.0...)
   * @param {string} rawText 
   * @param {number} defaultDuration - Default duration per image in seconds if none specified
   * @returns {Array<{index: number, timestamp: string, cleanTimestamp: string, prompt: string}>}
   */
  static parse(rawText, defaultDuration = 3.0) {
    if (!rawText || !rawText.trim()) return [];

    // Split by newlines, filtering out empty lines
    const rawLines = rawText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const items = [];
    let currentTime = 0.0;

    // Regex patterns for matching timestamps:
    // Group 1: Start-End time (e.g. 0.0-0.5, 0:00-0:05, 0.5-2.7)
    // Group 2: The actual prompt text
    const bracketPattern = /^\[?(\d+(?:\.\d+)?(?::\d+)?\s*[-–—to]+\s*\d+(?:\.\d+)?(?::\d+)?s?)\]?\s*[:|–—-]?\s*(.*)$/i;
    const numberedPattern = /^\d+[\.\)]\s*(?:\[?(\d+(?:\.\d+)?(?::\d+)?\s*[-–—to]+\s*\d+(?:\.\d+)?(?::\d+)?s?)\]?\s*[:|–—-]?\s*)?(.*)$/i;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      let timestamp = null;
      let promptText = line;

      // Try matching bracket or explicit timestamp pattern
      const bracketMatch = line.match(bracketPattern);
      if (bracketMatch) {
        timestamp = bracketMatch[1].trim();
        promptText = bracketMatch[2].trim();
      } else {
        // Try matching numbered prefix like "1. 0.0-0.5 | Prompt" or "1. Prompt"
        const numMatch = line.match(numberedPattern);
        if (numMatch) {
          if (numMatch[1]) {
            timestamp = numMatch[1].trim();
          }
          promptText = (numMatch[2] || '').trim();
        }
      }

      // If no timestamp was found in line, auto-calculate from defaultDuration
      if (!timestamp) {
        const start = currentTime.toFixed(1);
        const end = (currentTime + defaultDuration).toFixed(1);
        timestamp = `${start}-${end}`;
        currentTime += defaultDuration;
      } else {
        // Try updating currentTime if timestamp had an end time
        const parts = timestamp.split(/[-–—to]+/i);
        if (parts.length === 2) {
          const parsedEnd = parseFloat(parts[1].replace(/[^0-9.]/g, ''));
          if (!isNaN(parsedEnd)) currentTime = parsedEnd;
        }
      }

      // Sanitize prompt
      promptText = promptText.replace(/^[:|–—-]\s*/, '').trim();
      if (!promptText) promptText = `Scene ${i + 1}`;

      // Clean timestamp for file naming (e.g., "0.0-0.5" -> "0-0.5")
      const cleanTimestamp = timestamp
        .replace(/\s+/g, '')
        .replace(/s$/i, '')
        .replace(/:/g, '.');

      items.push({
        index: i + 1,
        timestamp,
        cleanTimestamp,
        prompt: promptText
      });
    }

    return items;
  }

  /**
   * Auto-formats cluttered or continuous script into clean 1-line-gapped timeline entries.
   * Useful when user pastes an unformatted text or continuous paragraph.
   * @param {string} rawText 
   * @returns {string} Cleanly formatted text with line gaps
   */
  static autoFormat(rawText) {
    if (!rawText || !rawText.trim()) return '';

    // Check if user pasted a single blob with embedded numbers like "1. ... 2. ..."
    let text = rawText.trim();
    
    // Insert newlines before embedded numbering like " 2. " or " 2) "
    text = text.replace(/(\s+)(\d+[\.\)])\s+/g, '\n\n$2 ');

    // Insert newlines before embedded timestamps like " [0.5-2.7] "
    text = text.replace(/(\s+)(\[\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?s?\])/g, '\n\n$2');

    // Parse the items
    const parsed = TimelineParser.parse(text);
    if (parsed.length === 0) return rawText;

    // Reconstruct with standard clean format:
    // "0.0-0.5 | Prompt text\n\n0.5-2.7 | Prompt text..."
    return parsed.map(item => `${item.timestamp} | ${item.prompt}`).join('\n\n');
  }

  /**
   * Creates safe and standardized file names for video editors.
   * Format: "01. 0-0.5.png" or "001_0.0-0.5s_Scene.png"
   * @param {number} index 
   * @param {string} cleanTimestamp 
   * @param {string} [slug] - Optional short prompt slug
   * @returns {string}
   */
  static generateFilename(index, cleanTimestamp, slug = '') {
    const padIndex = String(index).padStart(2, '0');
    if (slug) {
      const cleanSlug = slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 25)
        .replace(/-+$/, '');
      return `${padIndex}. ${cleanTimestamp}_${cleanSlug}.png`;
    }
    return `${padIndex}. ${cleanTimestamp}.png`;
  }
}

// Global export
window.TimelineParser = TimelineParser;
