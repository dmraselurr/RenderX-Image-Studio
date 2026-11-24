/**
 * SimpleZip - Lightweight, zero-dependency client-side ZIP generator
 * Optimized for bundling already-compressed files (PNG, JPG, WAV) instantly.
 * Compatible with Windows Explorer, macOS Archive Utility, 7-Zip, CapCut, Premiere Pro.
 */
class SimpleZip {
  constructor() {
    this.files = [];
  }

  // Precomputed CRC32 table
  static crcTable = (() => {
    let table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  static crc32(bytes) {
    let crc = 0xFFFFFFFF;
    const table = SimpleZip.crcTable;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Add a file to the zip
   * @param {string} filename - Path or filename inside the zip
   * @param {Uint8Array|ArrayBuffer|Blob|string} data - Content of the file
   */
  async file(filename, data) {
    let bytes;
    if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      bytes = new Uint8Array(buffer);
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else {
      throw new Error(`Unsupported data format for ${filename}`);
    }

    const nameBytes = new TextEncoder().encode(filename);
    const crc = SimpleZip.crc32(bytes);

    this.files.push({
      name: filename,
      nameBytes,
      bytes,
      crc,
      size: bytes.length
    });
  }

  /**
   * Generate the final ZIP Blob
   * @returns {Blob}
   */
  generate() {
    let localHeadersSize = 0;
    let centralDirSize = 0;

    for (const f of this.files) {
      localHeadersSize += 30 + f.nameBytes.length + f.size;
      centralDirSize += 46 + f.nameBytes.length;
    }

    const totalSize = localHeadersSize + centralDirSize + 22; // 22 is EOCD size
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const outBytes = new Uint8Array(buffer);

    let offset = 0;
    const centralEntries = [];

    // 1. Write Local File Headers + Data
    for (const f of this.files) {
      const localOffset = offset;
      centralEntries.push({ f, localOffset });

      // Local file header signature (0x04034b50)
      view.setUint32(offset, 0x04034b50, true);
      view.setUint16(offset + 4, 10, true); // Version needed (1.0)
      view.setUint16(offset + 6, 0x0800, true); // UTF-8 filename flag
      view.setUint16(offset + 8, 0, true); // Compression: Store (0)
      view.setUint16(offset + 10, 0, true); // Mod time
      view.setUint16(offset + 12, 0, true); // Mod date
      view.setUint32(offset + 14, f.crc, true); // CRC32
      view.setUint32(offset + 18, f.size, true); // Compressed size
      view.setUint32(offset + 22, f.size, true); // Uncompressed size
      view.setUint16(offset + 26, f.nameBytes.length, true);
      view.setUint16(offset + 28, 0, true); // Extra field length

      offset += 30;
      outBytes.set(f.nameBytes, offset);
      offset += f.nameBytes.length;
      outBytes.set(f.bytes, offset);
      offset += f.size;
    }

    // 2. Write Central Directory Headers
    const centralDirOffset = offset;
    for (const entry of centralEntries) {
      const f = entry.f;
      // Central directory header signature (0x02014b50)
      view.setUint32(offset, 0x02014b50, true);
      view.setUint16(offset + 4, 20, true); // Version made by
      view.setUint16(offset + 6, 10, true); // Version needed
      view.setUint16(offset + 8, 0x0800, true); // UTF-8 filename flag
      view.setUint16(offset + 10, 0, true); // Compression: Store (0)
      view.setUint16(offset + 12, 0, true); // Mod time
      view.setUint16(offset + 14, 0, true); // Mod date
      view.setUint32(offset + 16, f.crc, true); // CRC32
      view.setUint32(offset + 20, f.size, true); // Compressed size
      view.setUint32(offset + 24, f.size, true); // Uncompressed size
      view.setUint16(offset + 28, f.nameBytes.length, true);
      view.setUint16(offset + 30, 0, true); // Extra field length
      view.setUint16(offset + 32, 0, true); // Comment length
      view.setUint16(offset + 34, 0, true); // Disk number start
      view.setUint16(offset + 36, 0, true); // Internal file attributes
      view.setUint32(offset + 38, 0, true); // External file attributes
      view.setUint32(offset + 42, entry.localOffset, true); // Relative offset of local header

      offset += 46;
      outBytes.set(f.nameBytes, offset);
      offset += f.nameBytes.length;
    }

    const centralDirLength = offset - centralDirOffset;

    // 3. Write End of Central Directory Record (EOCD)
    // EOCD signature (0x06054b50)
    view.setUint32(offset, 0x06054b50, true);
    view.setUint16(offset + 4, 0, true); // Number of this disk
    view.setUint16(offset + 6, 0, true); // Disk where central directory starts
    view.setUint16(offset + 8, this.files.length, true); // Number of central directory records on this disk
    view.setUint16(offset + 10, this.files.length, true); // Total number of central directory records
    view.setUint32(offset + 12, centralDirLength, true); // Size of central directory
    view.setUint32(offset + 16, centralDirOffset, true); // Offset of start of central directory
    view.setUint16(offset + 20, 0, true); // ZIP file comment length

    return new Blob([buffer], { type: 'application/zip' });
  }
}

// Global export
window.SimpleZip = SimpleZip;
