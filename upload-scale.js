(() => {
  const LARGE_QUEUE_DB_NAME = "lavender-memories-upload-queue-large-v1";
  const QUEUE_FILE_STORE = "files";
  const LARGE_MAX_QUEUE_ITEMS = 2000;
  const QUEUE_RENDER_LIMIT = 90;
  const QUEUE_BATCH_SIZE = 25;
  const DUPLICATE_FOLDER_NAME = "DUPLICATE UPLOADS";

  const pauseForUi = () => new Promise((resolve) => window.setTimeout(resolve, 0));
  const normalizeName = (name = "") => String(name).trim().toLowerCase();

  function scaledConcurrency() {
    const configured = typeof UPLOAD_CONCURRENCY === "number" ? UPLOAD_CONCURRENCY : 3;
    return Math.max(2, Math.min(3, configured));
  }

  const describeImageFile = (file) => window.mediaUtils.describeImageFile(file, createQueueId);

  function existingDuplicateKeys() {
    const hashes = new Set();
    const fallback = new Set();
    const dimensions = new Set();
    for (const item of state.media || []) {
      const meta = item.metadata || {};
      const name = normalizeName(meta.originalName || meta.fileName || "");
      const size = Number(meta.size || 0);
      const width = Number(meta.originalWidth || meta.width || 0);
      const height = Number(meta.originalHeight || meta.height || 0);
      if (meta.fileHash) hashes.add(meta.fileHash);
      if (meta.googlePhotosId) hashes.add(`google:${meta.googlePhotosId}`);
      if (meta.duplicateSignature) dimensions.add(meta.duplicateSignature);
      if (name && size) fallback.add(`${name}|${size}`);
      if (name && size && width && height) dimensions.add(`${name}|${size}|${width}x${height}`);
    }
    return { hashes, fallback, dimensions };
  }

  function isDuplicateDescriptor(descriptor, known) {
    if (descriptor.fileHash && known.hashes.has(descriptor.fileHash)) return true;
    if (known.dimensions.has(descriptor.dimensionSignature)) return true;
    return known.fallback.has(descriptor.fallbackSignature);
  }

  async function ensureDuplicateFolder() {
    const existing = state.folders.find((folder) => folder.name === DUPLICATE_FOLDER_NAME);
    if (existing) return existing;
    const folder = await api("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: DUPLICATE_FOLDER_NAME })
    });
    await loadData();
    return folder;
  }

  function duplicateFileName(item) {
    return item.file?.name || item.fileName || item.id || "Photo";
  }

  function duplicateFileSize(item) {
    return item.file?.size ? ` - ${fileSizeLabel(item.file.size)}` : "";
  }

  function ensureDuplicateDialog() {
    let dialog = document.getElementById("duplicateDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "panel-dialog duplicate-dialog";
    dialog.id = "duplicateDialog";
    dialog.innerHTML = `<div class="dialog-shell">
      <header class="dialog-header">
        <button class="icon-button ghost" id="closeDuplicateDialog" type="button" aria-label="Close duplicate warning">x</button>
        <div class="duplicate-copy"><h2>This picture already exists</h2><p id="duplicateSummary">Choose how to handle duplicate photos.</p></div>
        <span></span>
      </header>
      <div class="duplicate-list" id="duplicateList"></div>
      <div class="duplicate-actions" id="duplicateBatchActions"></div>
    </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("#closeDuplicateDialog").addEventListener("click", () => dialog.close("cancel"));
    return dialog;
  }

  function askDuplicateAction(duplicates, options = {}) {
    const allowNormal = options.allowNormal !== false;
    const dialog = ensureDuplicateDialog();
    const list = dialog.querySelector("#duplicateList");
    const summary = dialog.querySelector("#duplicateSummary");
    const actions = dialog.querySelector("#duplicateBatchActions");
    const choices = new Map(duplicates.map((item) => [item.reviewId, "skip"]));
    summary.textContent = duplicates.length === 1
      ? "This photo appears to already be in your gallery."
      : `${duplicates.length} photos appear to already be in your gallery.`;
    list.innerHTML = duplicates.map((item) => `<div class="duplicate-card"><strong>${escapeHtml(duplicateFileName(item))}</strong><span>Likely duplicate${duplicateFileSize(item)}</span></div>`).join("");
    actions.innerHTML = `<button class="secondary-button" data-duplicate-action="skip" type="button">Skip all duplicates</button>
      <button class="primary-button" data-duplicate-action="duplicates" type="button">Send all to DUPLICATE UPLOADS</button>
      <button class="secondary-button" data-duplicate-action="review" type="button">Review one by one</button>`;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        dialog.close();
        resolve(value);
      };

      actions.onclick = (event) => {
        const button = event.target.closest("[data-duplicate-action]");
        if (!button) return;
        const action = button.dataset.duplicateAction;
        if (action === "finish-review") return settle({ action: "review", choices });
        if (action !== "review") return settle({ action });
        list.innerHTML = duplicates.map((item) => `<div class="duplicate-review-row" data-review-id="${item.reviewId}">
          <div><strong>${escapeHtml(duplicateFileName(item))}</strong><span>Already in gallery${duplicateFileSize(item)}</span></div>
          <div class="duplicate-review-controls">
            <button class="active" data-review-choice="skip" type="button">Skip</button>
            <button data-review-choice="duplicates" type="button">DUPLICATE UPLOADS</button>
            ${allowNormal ? `<button data-review-choice="normal" type="button">Upload anyway</button>` : ""}
          </div>
        </div>`).join("");
        actions.innerHTML = `<button class="primary-button" data-duplicate-action="finish-review" type="button">Apply choices</button>`;
      };

      list.onclick = (event) => {
        const button = event.target.closest("[data-review-choice]");
        const row = event.target.closest("[data-review-id]");
        if (!button || !row) return;
        choices.set(row.dataset.reviewId, button.dataset.reviewChoice);
        row.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      };

      dialog.addEventListener("close", function onClose() {
        dialog.removeEventListener("close", onClose);
        if (!settled) settle({ action: "skip" });
      });
      dialog.showModal();
    });
  }

  function requestToPromiseSafe(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function metadataOnly(item) {
    const { file, ...metadata } = item;
    return {
      ...metadata,
      hasFile: metadata.status === "uploaded" ? false : metadata.hasFile !== false
    };
  }

  openQueueDb = function scaledOpenQueueDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(LARGE_QUEUE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(QUEUE_FILE_STORE)) db.createObjectStore(QUEUE_FILE_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  queueStore = function scaledQueueStore(mode = "readonly", storeName = QUEUE_STORE) {
    if (!state.queueDb) return null;
    return state.queueDb.transaction(storeName, mode).objectStore(storeName);
  };

  persistQueueFile = async function scaledPersistQueueFile(id, file) {
    if (!state.queueDb || !file) return;
    await requestToPromiseSafe(queueStore("readwrite", QUEUE_FILE_STORE).put({ id, file, savedAt: Date.now() }));
  };

  loadQueueFile = async function scaledLoadQueueFile(id) {
    if (!state.queueDb) return null;
    const record = await requestToPromiseSafe(queueStore("readonly", QUEUE_FILE_STORE).get(id));
    return record?.file || null;
  };

  removeQueueFileFromDb = async function scaledRemoveQueueFileFromDb(id) {
    if (!state.queueDb) return;
    await requestToPromiseSafe(queueStore("readwrite", QUEUE_FILE_STORE).delete(id));
  };

  persistQueueItem = async function scaledPersistQueueItem(item) {
    if (!state.queueDb) return;
    await requestToPromiseSafe(queueStore("readwrite", QUEUE_STORE).put(metadataOnly(item)));
  };

  removeQueueItemFromDb = async function scaledRemoveQueueItemFromDb(id) {
    if (!state.queueDb) return;
    await Promise.all([
      requestToPromiseSafe(queueStore("readwrite", QUEUE_STORE).delete(id)),
      requestToPromiseSafe(queueStore("readwrite", QUEUE_FILE_STORE).delete(id))
    ]);
  };

  loadQueueFromDb = async function scaledLoadQueueFromDb() {
    if (!state.queueDb) return [];
    const items = await requestToPromiseSafe(queueStore("readonly", QUEUE_STORE).getAll());
    const recovered = [];
    for (const item of items) {
      if (item.file) await persistQueueFile(item.id, item.file);
      const status = ["compressing", "uploading"].includes(item.status) ? "pending" : item.status;
      const metadata = metadataOnly({
        ...item,
        status,
        progress: ["compressing", "uploading"].includes(item.status) ? 0 : item.progress || 0,
        nextAttemptAt: 0
      });
      await persistQueueItem(metadata);
      recovered.push(metadata);
    }
    return recovered.sort((a, b) => a.createdAt - b.createdAt);
  };

  queueStats = function scaledQueueStats() {
    const total = state.uploadQueue.length;
    const uploaded = state.uploadQueue.filter((item) => item.status === "uploaded").length;
    const failed = state.uploadQueue.filter((item) => item.status === "failed").length;
    const active = state.uploadQueue.filter((item) => ["compressing", "uploading"].includes(item.status)).length;
    const pending = state.uploadQueue.filter((item) => item.status === "pending").length;
    const progress = total ? Math.round(state.uploadQueue.reduce((sum, item) => sum + (item.progress || 0), 0) / total) : 0;
    return { total, uploaded, failed, active, pending, progress };
  };

  renderUploadQueue = function scaledRenderUploadQueue() {
    const list = byId("uploadQueueList");
    if (!list) return;
    const stats = queueStats();
    byId("queueSummary").textContent = `${stats.total} / ${LARGE_MAX_QUEUE_ITEMS} queued`;
    byId("queueHint").textContent = stats.total
      ? `${stats.uploaded} uploaded, ${stats.active} active, ${stats.pending} waiting, ${stats.failed} failed.`
      : "Select device photos to begin.";
    byId("queueOverallBar").style.width = `${stats.progress}%`;
    byId("resumeUploadsButton").disabled = !stats.total || !navigator.onLine;
    byId("clearCompletedUploadsButton").disabled = !stats.uploaded;
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
      const canRetry = item.status === "failed";
      const canRemove = !state.activeUploads.has(item.id);
      const status = item.error && item.status === "failed" ? `failed: ${item.error}` : item.status;
      return `<article class="queue-item ${item.status}" data-queue-id="${item.id}">
        <div class="queue-name">
          <span class="queue-dot"></span>
          <div class="queue-title"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(status)} - ${fileSizeLabel(item.size)}</span></div>
        </div>
        <div class="queue-item-actions">
          ${canRetry ? `<button type="button" data-queue-retry="${item.id}">Retry</button>` : ""}
          ${canRemove ? `<button type="button" data-queue-remove="${item.id}">Remove</button>` : ""}
        </div>
        <div class="queue-meter"><span style="width:${item.progress || 0}%"></span></div>
      </article>`;
    }).join("") + (state.uploadQueue.length > visible.length
      ? `<div class="queue-empty">Showing ${visible.length} active or recent queue items. ${state.uploadQueue.length - visible.length} more are safely waiting in the background.</div>`
      : "");
  };

  updateQueueItem = async function scaledUpdateQueueItem(id, patch) {
    const item = state.uploadQueue.find((entry) => entry.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: Date.now() });
    await persistQueueItem(item);
    renderUploadQueue();
    return item;
  };

  async function enqueueDescriptors(descriptors, folderId, folderName, duplicateAction = null) {
    const slots = Math.max(0, LARGE_MAX_QUEUE_ITEMS - state.uploadQueue.length);
    const selected = descriptors.slice(0, slots);
    let queued = 0;
    for (let index = 0; index < selected.length; index += QUEUE_BATCH_SIZE) {
      const batch = selected.slice(index, index + QUEUE_BATCH_SIZE);
      for (const descriptor of batch) {
        const file = descriptor.file;
        const item = {
          id: createQueueId(),
          name: file.name || "photo.jpg",
          size: file.size || 0,
          type: file.type || "image/jpeg",
          folderId,
          folderName,
          status: "pending",
          progress: 0,
          retries: 0,
          error: null,
          createdAt: Date.now() + queued,
          updatedAt: Date.now(),
          nextAttemptAt: 0,
          hasFile: true,
          fileHash: descriptor.fileHash,
          originalWidth: descriptor.width,
          originalHeight: descriptor.height,
          originalLastModified: descriptor.lastModified,
          duplicateSignature: descriptor.dimensionSignature,
          duplicateAction
        };
        await persistQueueFile(item.id, file);
        state.uploadQueue.push(item);
        await persistQueueItem(item);
        queued += 1;
      }
      renderUploadQueue();
      await pauseForUi();
    }
    resumeUploadQueue();
    return queued;
  }

  addFilesToQueue = async function scaledAddFilesToQueue(files) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    const slots = Math.max(0, LARGE_MAX_QUEUE_ITEMS - state.uploadQueue.length);
    if (!slots) {
      byId("importStatus").textContent = `The queue is full at ${LARGE_MAX_QUEUE_ITEMS} photos.`;
      return;
    }
    const selected = images.slice(0, slots).map((file) => ({
      reviewId: createQueueId(),
      file,
      name: normalizeName(file.name),
      fileHash: null,
      width: 0,
      height: 0,
      size: file.size || 0,
      lastModified: file.lastModified || 0,
      dimensionSignature: `${normalizeName(file.name)}|${file.size || 0}|0x0`
    }));
    const queued = await enqueueDescriptors(selected, state.importFolderId || "default", folderName(state.importFolderId || "default"), null);
    byId("importStatus").textContent = `${queued} photo${queued === 1 ? "" : "s"} added to the upload queue.`;
  };

  nextUploadItem = function scaledNextUploadItem() {
    const now = Date.now();
    return state.uploadQueue.find((item) => {
      if (state.activeUploads.has(item.id)) return false;
      if (item.status === "pending") return true;
      return item.status === "failed" && item.retries < MAX_UPLOAD_RETRIES && (item.nextAttemptAt || 0) <= now;
    });
  };

  resumeUploadQueue = function scaledResumeUploadQueue() {
    state.queueStarted = true;
    if (!navigator.onLine) {
      byId("importStatus").textContent = "Uploads paused while offline. They will resume when the connection returns.";
      renderUploadQueue();
      return;
    }
    while (state.activeUploads.size < scaledConcurrency()) {
      const item = nextUploadItem();
      if (!item) break;
      processQueueItem(item).catch((error) => console.error(error));
    }
    renderUploadQueue();
  };

  uploadWithProgress = function scaledUploadWithProgress(item, onProgress) {
    return new Promise(async (resolve, reject) => {
      try {
        const file = item.file || await loadQueueFile(item.id);
        if (!file) throw new Error("The queued file is no longer available. Please remove it and choose it again.");
        const descriptor = item.fileHash ? item : await describeImageFile(file);
        const form = new FormData();
        form.append("folderId", item.folderId || "default");
        form.append("folderName", item.folderName || folderName(item.folderId));
        form.append("queueItemId", item.id);
        form.append("fileHash", descriptor.fileHash || "");
        form.append("duplicateSignature", descriptor.duplicateSignature || descriptor.dimensionSignature || "");
        form.append("originalLastModified", descriptor.originalLastModified || descriptor.lastModified || 0);
        form.append("originalWidth", descriptor.originalWidth || descriptor.width || 0);
        form.append("originalHeight", descriptor.originalHeight || descriptor.height || 0);
        form.append("duplicateAction", item.duplicateAction || "");
        form.append("images", file, item.name || file.name || "photo.jpg");

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.responseType = "json";
        xhr.timeout = UPLOAD_TIMEOUT_MS;
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          onProgress(Math.min(92, Math.round(22 + (event.loaded / event.total) * 68)));
        };
        xhr.onload = () => {
          const body = xhr.response || {};
          if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
          reject(new Error(body.error || `Upload failed with status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network upload failed."));
        xhr.ontimeout = () => reject(new Error("Upload timed out. It will retry."));
        xhr.onabort = () => reject(new Error("Upload was interrupted."));
        xhr.send(form);
      } catch (error) {
        reject(error);
      }
    });
  };

  processQueueItem = async function scaledProcessQueueItem(item) {
    if (state.activeUploads.has(item.id)) return;
    state.activeUploads.set(item.id, true);
    let activeItem = null;
    try {
      const file = await loadQueueFile(item.id);
      if (!file) throw new Error("The queued file is missing from recovery storage.");
      activeItem = { ...item, file };
      await updateQueueItem(item.id, { status: "compressing", progress: 12, error: null });
      await delay(80);
      await updateQueueItem(item.id, { status: "uploading", progress: 22, error: null });
      const result = await uploadWithProgress(activeItem, (progress) => updateQueueItem(item.id, { progress }));
      await updateQueueItem(item.id, { status: "uploaded", progress: 100, error: null, hasFile: false, mediaId: result.media?.[0]?.id || null });
      await removeQueueFileFromDb(item.id);
      byId("importStatus").textContent = `${item.name} uploaded.`;
      await loadData();
    } catch (error) {
      const retries = (item.retries || 0) + 1;
      const nextAttemptAt = Date.now() + Math.min(45000, 1500 * (2 ** Math.min(retries, 5)));
      await updateQueueItem(item.id, {
        status: "failed",
        progress: Math.max(0, item.progress || 0),
        retries,
        nextAttemptAt,
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

  retryQueueItem = async function scaledRetryQueueItem(id) {
    await updateQueueItem(id, { status: "pending", progress: 0, error: null, nextAttemptAt: 0 });
    resumeUploadQueue();
  };

  removeQueueItem = async function scaledRemoveQueueItem(id) {
    if (state.activeUploads.has(id)) return;
    state.uploadQueue = state.uploadQueue.filter((item) => item.id !== id);
    await removeQueueItemFromDb(id);
    renderUploadQueue();
  };

  clearCompletedUploads = async function scaledClearCompletedUploads() {
    const completedIds = state.uploadQueue.filter((item) => item.status === "uploaded").map((item) => item.id);
    state.uploadQueue = state.uploadQueue.filter((item) => item.status !== "uploaded");
    for (const id of completedIds) await removeQueueItemFromDb(id);
    renderUploadQueue();
  };

  async function describeFilesInBatches(files) {
    const descriptors = [];
    for (let index = 0; index < files.length; index += QUEUE_BATCH_SIZE) {
      const batch = files.slice(index, index + QUEUE_BATCH_SIZE);
      for (const file of batch) {
        byId("importStatus").textContent = `Checking for duplicates... ${descriptors.length + 1} / ${files.length}`;
        descriptors.push(await describeImageFile(file));
        await pauseForUi();
      }
      renderUploadQueue();
      await pauseForUi();
    }
    return descriptors;
  }

  uploadFiles = async function scaledUploadFiles(files) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    const slots = Math.max(0, LARGE_MAX_QUEUE_ITEMS - state.uploadQueue.length);
    if (!slots) {
      byId("importStatus").textContent = `The queue is full at ${LARGE_MAX_QUEUE_ITEMS} photos.`;
      return;
    }
    const selected = images.slice(0, slots);
    if (images.length > selected.length) {
      byId("importStatus").textContent = `${images.length - selected.length} photo${images.length - selected.length === 1 ? "" : "s"} skipped because the queue limit is ${LARGE_MAX_QUEUE_ITEMS}.`;
    }

    const descriptors = await describeFilesInBatches(selected);
    const known = existingDuplicateKeys();
    const duplicates = descriptors.filter((item) => isDuplicateDescriptor(item, known));
    const duplicateIds = new Set(duplicates.map((item) => item.reviewId));
    const fresh = descriptors.filter((item) => !duplicateIds.has(item.reviewId));
    let queued = 0;
    const targetFolderId = state.importFolderId || "default";
    const targetFolderName = folderName(targetFolderId);

    if (!duplicates.length) {
      queued = await enqueueDescriptors(descriptors, targetFolderId, targetFolderName, null);
      byId("importStatus").textContent = `${queued} photo${queued === 1 ? "" : "s"} added to the upload queue.`;
      return;
    }

    const decision = await askDuplicateAction(duplicates);
    if (fresh.length) queued += await enqueueDescriptors(fresh, targetFolderId, targetFolderName, null);

    if (decision.action === "duplicates") {
      const duplicateFolder = await ensureDuplicateFolder();
      queued += await enqueueDescriptors(duplicates, duplicateFolder.id, duplicateFolder.name, "duplicates");
    } else if (decision.action === "review") {
      const normal = [];
      const duplicateFolderItems = [];
      for (const item of duplicates) {
        const choice = decision.choices.get(item.reviewId) || "skip";
        if (choice === "normal") normal.push(item);
        if (choice === "duplicates") duplicateFolderItems.push(item);
      }
      if (normal.length) queued += await enqueueDescriptors(normal, targetFolderId, targetFolderName, "upload-anyway");
      if (duplicateFolderItems.length) {
        const duplicateFolder = await ensureDuplicateFolder();
        queued += await enqueueDescriptors(duplicateFolderItems, duplicateFolder.id, duplicateFolder.name, "duplicates");
      }
    }
    byId("importStatus").textContent = `${queued} photo${queued === 1 ? "" : "s"} added. ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"} reviewed.`;
  };

  async function migrateCurrentQueueIntoScaledDb() {
    const currentItems = [...(state.uploadQueue || [])];
    for (const item of currentItems) {
      if (item.file) await persistQueueFile(item.id, item.file);
      await persistQueueItem(item);
    }
  }

  async function startScaledQueue() {
    try {
      if (state.queueDb?.close) state.queueDb.close();
      state.activeUploads.clear();
      state.queueDb = await openQueueDb();
      await migrateCurrentQueueIntoScaledDb();
      state.uploadQueue = await loadQueueFromDb();
      renderUploadQueue();
      resumeUploadQueue();
    } catch (error) {
      console.error(error);
      const target = byId("importStatus");
      if (target) target.textContent = "Large upload recovery storage is unavailable in this browser.";
    }
  }

  window.setTimeout(startScaledQueue, 700);
})();
