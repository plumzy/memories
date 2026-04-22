(() => {
  const LARGE_QUEUE_LIMIT = 2000;
  const QUEUE_RENDER_LIMIT = 90;
  const MISSING_FILE_MESSAGE = "File is no longer available, please re-upload";
  const MISSING_FILE_PATTERN = /missing from recovery storage|no longer available|please re-upload/i;
  const previewWork = new Set();
  const fileCheckWork = new Set();
  let reuploadTargetId = null;

  function isMissingFileItem(item = {}) {
    return item.missingFile === true || item.hasFile === false && item.status !== "uploaded" || MISSING_FILE_PATTERN.test(item.error || "");
  }

  function activeItemCount() {
    return state.uploadQueue.filter((item) => ["compressing", "uploading"].includes(item.status)).length;
  }

  function queueStatsWithMissing() {
    const total = state.uploadQueue.length;
    const uploaded = state.uploadQueue.filter((item) => item.status === "uploaded").length;
    const failed = state.uploadQueue.filter((item) => item.status === "failed").length;
    const missing = state.uploadQueue.filter((item) => item.status === "failed" && isMissingFileItem(item)).length;
    const active = activeItemCount();
    const pending = state.uploadQueue.filter((item) => item.status === "pending").length;
    const retryable = state.uploadQueue.filter((item) => item.status === "failed" && !isMissingFileItem(item)).length;
    const progress = total ? Math.round(state.uploadQueue.reduce((sum, item) => sum + (item.progress || 0), 0) / total) : 0;
    return { total, uploaded, failed, missing, active, pending, retryable, progress };
  }

  function statusText(item) {
    if (isMissingFileItem(item)) return MISSING_FILE_MESSAGE;
    if (item.error && item.status === "failed") return `failed: ${item.error}`;
    return item.status || "pending";
  }

  function previewMarkup(item) {
    if (item.previewDataUrl) {
      return `<img src="${item.previewDataUrl}" alt="">`;
    }
    return `<div class="queue-preview-empty" aria-hidden="true"><span></span></div>`;
  }

  function createPreviewDataUrl(file) {
    return new Promise((resolve) => {
      if (!file || !file.type?.startsWith("image/")) return resolve(null);
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const maxSide = 128;
        const width = image.naturalWidth || maxSide;
        const height = image.naturalHeight || maxSide;
        const scale = Math.min(1, maxSide / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d", { alpha: false });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/jpeg", 0.5));
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      image.src = objectUrl;
    });
  }

  function imageDimensions(file) {
    return new Promise((resolve) => {
      if (!file || !file.type?.startsWith("image/")) return resolve({ width: 0, height: 0 });
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: 0, height: 0 });
      };
      image.src = objectUrl;
    });
  }

  function bufferToHex(buffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashFile(file) {
    if (!window.crypto?.subtle) return null;
    const buffer = await file.arrayBuffer();
    return bufferToHex(await crypto.subtle.digest("SHA-256", buffer));
  }

  async function describeReplacementFile(file) {
    const [dimensions, fileHash, previewDataUrl] = await Promise.all([
      imageDimensions(file),
      hashFile(file).catch(() => null),
      createPreviewDataUrl(file)
    ]);
    const normalizedName = String(file.name || "photo.jpg").trim().toLowerCase();
    return {
      name: file.name || "photo.jpg",
      size: file.size || 0,
      type: file.type || "image/jpeg",
      fileHash,
      originalWidth: dimensions.width,
      originalHeight: dimensions.height,
      originalLastModified: file.lastModified || 0,
      duplicateSignature: `${normalizedName}|${file.size || 0}|${dimensions.width || 0}x${dimensions.height || 0}`,
      previewDataUrl
    };
  }

  async function markMissingFile(item) {
    await updateQueueItem(item.id, {
      status: "failed",
      progress: Math.max(0, item.progress || 0),
      retries: item.retries || 0,
      nextAttemptAt: 0,
      hasFile: false,
      missingFile: true,
      error: MISSING_FILE_MESSAGE
    });
  }

  async function ensurePreviewForItem(item) {
    if (!item || item.previewDataUrl || previewWork.has(item.id) || item.status === "uploaded" || isMissingFileItem(item)) return;
    previewWork.add(item.id);
    try {
      const file = item.file || await loadQueueFile(item.id).catch(() => null);
      if (!file) {
        if (item.status === "failed") await markMissingFile(item);
        return;
      }
      const previewDataUrl = await createPreviewDataUrl(file);
      if (previewDataUrl) await updateQueueItem(item.id, { previewDataUrl, hasFile: true, missingFile: false });
    } finally {
      previewWork.delete(item.id);
    }
  }

  async function verifyFailedItemFile(item) {
    if (!item || item.status !== "failed" || isMissingFileItem(item) || fileCheckWork.has(item.id)) return;
    fileCheckWork.add(item.id);
    try {
      const file = await loadQueueFile(item.id).catch(() => null);
      if (!file) {
        await markMissingFile(item);
        return;
      }
      if (!item.previewDataUrl) {
        const previewDataUrl = await createPreviewDataUrl(file);
        if (previewDataUrl) await updateQueueItem(item.id, { previewDataUrl, hasFile: true, missingFile: false });
      }
    } finally {
      fileCheckWork.delete(item.id);
    }
  }

  function afterQueueRender(visible) {
    window.setTimeout(() => {
      visible.slice(0, 35).forEach((item) => {
        ensurePreviewForItem(item).catch(console.error);
        verifyFailedItemFile(item).catch(console.error);
      });
    }, 0);
  }

  function ensureRecoveryControls() {
    const actions = byId("uploadQueuePanel")?.querySelector(".queue-actions");
    if (actions && !byId("retryFailedUploadsButton")) {
      actions.insertAdjacentHTML("beforeend", `
        <button class="secondary-button" id="retryFailedUploadsButton" type="button">Retry failed</button>
        <button class="secondary-button danger-soft" id="removeFailedUploadsButton" type="button">Remove failed</button>
      `);
    }
    if (!byId("queueReuploadInput")) {
      const input = document.createElement("input");
      input.id = "queueReuploadInput";
      input.type = "file";
      input.accept = "image/*";
      input.hidden = true;
      document.body.appendChild(input);
      input.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !reuploadTargetId) return;
        await replaceMissingQueueFile(reuploadTargetId, file).catch(showError);
        reuploadTargetId = null;
      });
    }
  }

  renderUploadQueue = function recoveryRenderUploadQueue() {
    ensureRecoveryControls();
    const list = byId("uploadQueueList");
    if (!list) return;
    const stats = queueStatsWithMissing();
    byId("queueSummary").textContent = `${stats.total} / ${LARGE_QUEUE_LIMIT} queued`;
    byId("queueHint").textContent = stats.total
      ? `${stats.uploaded} uploaded, ${stats.active} active, ${stats.pending} waiting, ${stats.failed} failed${stats.missing ? `, ${stats.missing} need re-upload` : ""}.`
      : "Select device photos to begin.";
    byId("queueOverallBar").style.width = `${stats.progress}%`;
    byId("resumeUploadsButton").disabled = !stats.total || !navigator.onLine;
    byId("clearCompletedUploadsButton").disabled = !stats.uploaded;
    if (byId("retryFailedUploadsButton")) byId("retryFailedUploadsButton").disabled = !stats.retryable || !navigator.onLine;
    if (byId("removeFailedUploadsButton")) byId("removeFailedUploadsButton").disabled = !stats.failed;

    if (!state.uploadQueue.length) {
      list.innerHTML = `<div class="queue-empty">No photos queued yet. Choose files or drop images above.</div>`;
      return;
    }

    const visible = [
      ...state.uploadQueue.filter((item) => ["compressing", "uploading", "failed"].includes(item.status)),
      ...state.uploadQueue.filter((item) => item.status === "pending"),
      ...state.uploadQueue.filter((item) => item.status === "uploaded")
    ].slice(0, QUEUE_RENDER_LIMIT);

    list.innerHTML = visible.map((item) => {
      const missingFile = isMissingFileItem(item);
      const canRetry = item.status === "failed" && !missingFile && !state.activeUploads.has(item.id);
      const canReupload = item.status === "failed" && missingFile && !state.activeUploads.has(item.id);
      const canRemove = !state.activeUploads.has(item.id);
      return `<article class="queue-item queue-item-preview ${item.status} ${missingFile ? "missing-file" : ""}" data-queue-id="${item.id}">
        <div class="queue-preview">${previewMarkup(item)}</div>
        <div class="queue-name">
          <span class="queue-dot"></span>
          <div class="queue-title"><strong>${escapeHtml(item.name || "photo.jpg")}</strong><span>${escapeHtml(statusText(item))} - ${fileSizeLabel(item.size || 0)}</span></div>
        </div>
        <div class="queue-item-actions">
          ${item.status === "failed" ? `<button type="button" ${canRetry ? `data-queue-retry="${item.id}"` : "disabled"}>Retry</button>` : ""}
          ${canReupload ? `<button type="button" data-queue-reupload="${item.id}">Re-upload</button>` : ""}
          ${canRemove ? `<button type="button" data-queue-remove="${item.id}">Remove</button>` : ""}
        </div>
        <div class="queue-meter"><span style="width:${item.progress || 0}%"></span></div>
      </article>`;
    }).join("") + (state.uploadQueue.length > visible.length
      ? `<div class="queue-empty">Showing ${visible.length} active or recent queue items. ${state.uploadQueue.length - visible.length} more are safely waiting in the background.</div>`
      : "");

    afterQueueRender(visible);
  };

  nextUploadItem = function recoveryNextUploadItem() {
    const now = Date.now();
    return state.uploadQueue.find((item) => {
      if (state.activeUploads.has(item.id)) return false;
      if (isMissingFileItem(item)) return false;
      if (item.status === "pending") return true;
      return item.status === "failed" && item.retries < MAX_UPLOAD_RETRIES && (item.nextAttemptAt || 0) <= now;
    });
  };

  processQueueItem = async function recoveryProcessQueueItem(item) {
    if (state.activeUploads.has(item.id)) return;
    state.activeUploads.set(item.id, true);
    let activeItem = null;
    try {
      const file = await loadQueueFile(item.id).catch(() => null);
      if (!file) {
        await markMissingFile(item);
        byId("importStatus").textContent = `${item.name}: ${MISSING_FILE_MESSAGE}`;
        return;
      }
      if (!item.previewDataUrl) {
        const previewDataUrl = await createPreviewDataUrl(file);
        if (previewDataUrl) await updateQueueItem(item.id, { previewDataUrl });
      }
      activeItem = { ...item, file };
      await updateQueueItem(item.id, { status: "compressing", progress: 12, error: null, hasFile: true, missingFile: false });
      await delay(80);
      await updateQueueItem(item.id, { status: "uploading", progress: 22, error: null, hasFile: true, missingFile: false });
      const result = await uploadWithProgress(activeItem, (progress) => updateQueueItem(item.id, { progress }));
      await updateQueueItem(item.id, { status: "uploaded", progress: 100, error: null, hasFile: false, missingFile: false, mediaId: result.media?.[0]?.id || null });
      await removeQueueFileFromDb(item.id);
      byId("importStatus").textContent = `${item.name} uploaded.`;
      await loadData();
    } catch (error) {
      if (MISSING_FILE_PATTERN.test(error.message || "")) {
        await markMissingFile(item);
        byId("importStatus").textContent = `${item.name}: ${MISSING_FILE_MESSAGE}`;
        return;
      }
      const retries = (item.retries || 0) + 1;
      const nextAttemptAt = Date.now() + Math.min(45000, 1500 * (2 ** Math.min(retries, 5)));
      await updateQueueItem(item.id, {
        status: "failed",
        progress: Math.max(0, item.progress || 0),
        retries,
        nextAttemptAt,
        missingFile: false,
        error: error.message || "Upload failed."
      });
      byId("importStatus").textContent = retries < MAX_UPLOAD_RETRIES
        ? `${item.name} failed. Retrying automatically.`
        : `${item.name} failed. Use Retry when ready.`;
      if (retries < MAX_UPLOAD_RETRIES) window.setTimeout(resumeUploadQueue, Math.max(1500, nextAttemptAt - Date.now()));
    } finally {
      if (activeItem) activeItem.file = null;
      state.activeUploads.delete(item.id);
      renderUploadQueue();
      window.setTimeout(resumeUploadQueue, 120);
    }
  };

  retryQueueItem = async function recoveryRetryQueueItem(id) {
    const item = state.uploadQueue.find((entry) => entry.id === id);
    if (!item) return;
    const file = await loadQueueFile(id).catch(() => null);
    if (!file) {
      await markMissingFile(item);
      byId("importStatus").textContent = `${item.name}: ${MISSING_FILE_MESSAGE}`;
      return;
    }
    const previewDataUrl = item.previewDataUrl || await createPreviewDataUrl(file);
    await updateQueueItem(id, { status: "pending", progress: 0, error: null, nextAttemptAt: 0, missingFile: false, hasFile: true, previewDataUrl });
    resumeUploadQueue();
  };

  async function replaceMissingQueueFile(id, file) {
    const item = state.uploadQueue.find((entry) => entry.id === id);
    if (!item || !file?.type?.startsWith("image/")) return;
    const descriptor = await describeReplacementFile(file);
    await persistQueueFile(id, file);
    await updateQueueItem(id, {
      ...descriptor,
      status: "pending",
      progress: 0,
      retries: 0,
      error: null,
      nextAttemptAt: 0,
      hasFile: true,
      missingFile: false,
      updatedAt: Date.now()
    });
    byId("importStatus").textContent = `${descriptor.name} re-added to the upload queue.`;
    resumeUploadQueue();
  }

  async function retryAllValidFailed() {
    const failed = state.uploadQueue.filter((item) => item.status === "failed" && !isMissingFileItem(item) && !state.activeUploads.has(item.id));
    let retryable = 0;
    for (const item of failed) {
      const file = await loadQueueFile(item.id).catch(() => null);
      if (!file) {
        await markMissingFile(item);
        continue;
      }
      retryable += 1;
      const previewDataUrl = item.previewDataUrl || await createPreviewDataUrl(file);
      await updateQueueItem(item.id, { status: "pending", progress: 0, error: null, nextAttemptAt: 0, missingFile: false, hasFile: true, previewDataUrl });
      await delay(0);
    }
    byId("importStatus").textContent = retryable ? `${retryable} failed upload${retryable === 1 ? "" : "s"} queued to retry.` : "No valid failed uploads can be retried.";
    resumeUploadQueue();
  }

  async function removeAllFailedItems() {
    const failedIds = state.uploadQueue.filter((item) => item.status === "failed" && !state.activeUploads.has(item.id)).map((item) => item.id);
    if (!failedIds.length) return;
    state.uploadQueue = state.uploadQueue.filter((item) => !failedIds.includes(item.id));
    for (const id of failedIds) await removeQueueItemFromDb(id);
    byId("importStatus").textContent = `${failedIds.length} failed upload${failedIds.length === 1 ? "" : "s"} removed.`;
    renderUploadQueue();
  }

  document.addEventListener("click", (event) => {
    const reupload = event.target.closest("[data-queue-reupload]");
    if (reupload) {
      reuploadTargetId = reupload.dataset.queueReupload;
      byId("queueReuploadInput")?.click();
      return;
    }
    if (event.target.closest("#retryFailedUploadsButton")) {
      retryAllValidFailed().catch(showError);
      return;
    }
    if (event.target.closest("#removeFailedUploadsButton")) {
      removeAllFailedItems().catch(showError);
    }
  });

  window.setTimeout(() => {
    ensureRecoveryControls();
    renderUploadQueue();
  }, 900);
})();
