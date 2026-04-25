// Shared browser utilities used by enhancements.js, upload-scale.js, and upload-recovery.js.
window.mediaUtils = (() => {
  function bufferToHex(buffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashFile(file) {
    if (!window.crypto?.subtle) return null;
    const buffer = await file.arrayBuffer();
    return bufferToHex(await crypto.subtle.digest("SHA-256", buffer));
  }

  function imageDimensions(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      image.src = url;
    });
  }

  async function describeImageFile(file, createId) {
    const [fileHash, dimensions] = await Promise.all([hashFile(file).catch(() => null), imageDimensions(file)]);
    const name = String(file.name || "").trim().toLowerCase();
    return {
      reviewId: createId ? createId() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      name,
      fileHash,
      width: dimensions.width,
      height: dimensions.height,
      size: file.size || 0,
      lastModified: file.lastModified || 0,
      fallbackSignature: `${name}|${file.size || 0}`,
      dimensionSignature: `${name}|${file.size || 0}|${dimensions.width || 0}x${dimensions.height || 0}`
    };
  }

  return { hashFile, imageDimensions, describeImageFile };
})();
