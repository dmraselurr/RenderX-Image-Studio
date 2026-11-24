/**
 * RenderX Image Studio - Storage Manager
 * Seamlessly abstracts Chrome Storage and Browser LocalStorage.
 */

class StorageManager {
  static isExtension() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  /**
   * Save key-value pairs
   * @param {Object} data 
   * @returns {Promise<void>}
   */
  static async save(data) {
    if (StorageManager.isExtension()) {
      return new Promise((resolve) => {
        chrome.storage.local.set(data, resolve);
      });
    } else {
      for (const [key, val] of Object.entries(data)) {
        localStorage.setItem(`rx_${key}`, JSON.stringify(val));
      }
    }
  }

  /**
   * Get specific keys or all settings
   * @param {Array<string>|null} keys 
   * @returns {Promise<Object>}
   */
  static async get(keys = null) {
    if (StorageManager.isExtension()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
      });
    } else {
      const result = {};
      const targetKeys = keys || ['googleApiKey', 'hfToken', 'engine', 'autoFallback', 'concurrency'];
      for (const key of targetKeys) {
        const item = localStorage.getItem(`rx_${key}`);
        if (item !== null) {
          try {
            result[key] = JSON.parse(item);
          } catch (e) {
            result[key] = item;
          }
        }
      }
      return result;
    }
  }

  /**
   * Clear session settings
   */
  static async clear() {
    if (StorageManager.isExtension()) {
      return new Promise((resolve) => {
        chrome.storage.local.clear(resolve);
      });
    } else {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('rx_')) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    }
  }
}

// Global export
window.StorageManager = StorageManager;
