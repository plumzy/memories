(() => {
  const DUPLICATE_FOLDER_NAME = "DUPLICATE UPLOADS";
  const AUDIO_PREFS_KEY = "lavender-memories-audio-v1";
  const audioPrefs = loadAudioPrefs();

  const audioState = {
    tracks: [],
    index: 0,
    playing: false,
    mode: audioPrefs.mode,
    volume: audioPrefs.volume,
    element: new Audio()
  };
  audioState.element.volume = audioState.volume;

  function loadAudioPrefs() {
    try {
      return { mode: "loop", volume: 0.72, ...JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY) || "{}") };
    } catch {
      return { mode: "loop", volume: 0.72 };
    }
  }

  function saveAudioPrefs() {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify({ mode: audioState.mode, volume: audioState.volume }));
  }

  function normalizeName(name = "") {
    return String(name).trim().toLowerCase();
  }

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

  async function describeImageFile(file) {
    const [fileHash, dimensions] = await Promise.all([hashFile(file), imageDimensions(file)]);
    const name = normalizeName(file.name);
    return {
      reviewId: createQueueId(),
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

  async function enqueueEnhancedFiles(descriptors, folderId, folderName, duplicateAction = null) {
    const slots = Math.max(0, 500 - state.uploadQueue.length);
    const selected = descriptors.slice(0, slots);
    for (const descriptor of selected) {
      const file = descriptor.file;
      const item = {
        id: createQueueId(),
        file,
        name: file.name || "photo.jpg",
        size: file.size || 0,
        type: file.type || "image/jpeg",
        folderId,
        folderName,
        status: "pending",
        progress: 0,
        retries: 0,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nextAttemptAt: 0,
        fileHash: descriptor.fileHash,
        originalWidth: descriptor.width,
        originalHeight: descriptor.height,
        originalLastModified: descriptor.lastModified,
        duplicateSignature: descriptor.dimensionSignature,
        duplicateAction
      };
      state.uploadQueue.push(item);
      await persistQueueItem(item);
    }
    renderUploadQueue();
    resumeUploadQueue();
    return selected.length;
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

  function duplicateFileName(item) {
    return item.file?.name || item.fileName || item.id || "Photo";
  }

  function duplicateFileSize(item) {
    return item.file?.size ? ` · ${fileSizeLabel(item.file.size)}` : "";
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
        if (action === "finish-review") {
          settle({ action: "review", choices });
          return;
        }
        if (action !== "review") {
          settle({ action });
          return;
        }
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

  uploadFiles = async function enhancedUploadFiles(files) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    byId("importStatus").textContent = "Checking for duplicates...";
    const descriptors = await Promise.all(images.slice(0, 500).map(describeImageFile));
    const known = existingDuplicateKeys();
    const duplicates = descriptors.filter((item) => isDuplicateDescriptor(item, known));
    const fresh = descriptors.filter((item) => !duplicates.includes(item));
    let queued = 0;
    const targetFolderId = state.importFolderId || "default";
    const targetFolderName = folderName(targetFolderId);

    if (!duplicates.length) {
      queued = await enqueueEnhancedFiles(descriptors, targetFolderId, targetFolderName, null);
      byId("importStatus").textContent = `${queued} photo${queued === 1 ? "" : "s"} added to the upload queue.`;
      return;
    }

    const decision = await askDuplicateAction(duplicates);
    if (fresh.length) queued += await enqueueEnhancedFiles(fresh, targetFolderId, targetFolderName, null);

    if (decision.action === "duplicates") {
      const duplicateFolder = await ensureDuplicateFolder();
      queued += await enqueueEnhancedFiles(duplicates, duplicateFolder.id, duplicateFolder.name, "duplicates");
    } else if (decision.action === "review") {
      const normal = [];
      const duplicateFolderItems = [];
      for (const item of duplicates) {
        const choice = decision.choices.get(item.reviewId) || "skip";
        if (choice === "normal") normal.push(item);
        if (choice === "duplicates") duplicateFolderItems.push(item);
      }
      if (normal.length) queued += await enqueueEnhancedFiles(normal, targetFolderId, targetFolderName, "upload-anyway");
      if (duplicateFolderItems.length) {
        const duplicateFolder = await ensureDuplicateFolder();
        queued += await enqueueEnhancedFiles(duplicateFolderItems, duplicateFolder.id, duplicateFolder.name, "duplicates");
      }
    }
    byId("importStatus").textContent = `${queued} photo${queued === 1 ? "" : "s"} added. ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"} reviewed.`;
  };

  uploadWithProgress = function enhancedUploadWithProgress(item, onProgress) {
    return new Promise(async (resolve, reject) => {
      const descriptor = item.fileHash ? item : await describeImageFile(item.file);
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
      form.append("images", item.file, item.name);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.responseType = "json";
      xhr.timeout = 180000;
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
    });
  };

  maybeImportGoogleSelection = async function enhancedMaybeImportGoogleSelection() {
    if (!state.googleAccessToken || !state.googleSession?.id) return false;
    byId("importStatus").textContent = "Importing Google Photos selection...";
    setProgress(true, 25);
    const body = {
      accessToken: state.googleAccessToken,
      sessionId: state.googleSession.id,
      folderId: state.importFolderId,
      folderName: folderName(state.importFolderId)
    };
    let response = await fetch("/api/google-photos/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let result = await response.json().catch(() => ({}));
    if (response.status === 409 && result.code === "DUPLICATES_FOUND") {
      const googleDuplicates = (result.duplicates || []).map((item) => ({
        reviewId: item.id || createQueueId(),
        id: item.id,
        fileName: item.fileName || item.id || "Google Photos item"
      }));
      const decision = await askDuplicateAction(googleDuplicates, { allowNormal: false });
      if (decision.action === "skip") body.duplicateAction = "skip";
      if (decision.action === "duplicates") body.duplicateAction = "duplicates";
      if (decision.action === "review") {
        body.duplicateAction = "review";
        body.duplicateIdsToImport = googleDuplicates
          .filter((item) => decision.choices.get(item.reviewId) === "duplicates")
          .map((item) => item.id)
          .filter(Boolean);
      }
      response = await fetch("/api/google-photos/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      result = await response.json().catch(() => ({}));
    }
    if (!response.ok) throw new Error(result.error || "Google Photos import failed.");
    state.googleSession = null;
    setProgress(true, 100);
    await loadData();
    byId("importStatus").textContent = `Imported ${result.media?.length || 0} Google Photos item(s).`;
    window.setTimeout(() => setProgress(false), 900);
    return true;
  };

  function createAudioPanel() {
    if (document.getElementById("audioSection")) return;
    const folderGrid = document.getElementById("folderGrid");
    const section = document.createElement("section");
    section.className = "audio-section";
    section.id = "audioSection";
    section.innerHTML = `<div class="audio-top">
      <div><h2>Carousel music</h2><p>Upload songs and choose the background playlist for your rotating memories.</p></div>
      <div class="audio-actions">
        <label class="primary-button">Upload audio<input id="audioInput" type="file" accept="audio/*" multiple hidden></label>
      </div>
    </div>
    <div class="audio-controls">
      <div class="audio-actions">
        <button class="audio-pill" id="audioPrev" type="button">Prev</button>
        <button class="audio-pill active" id="audioPlayPause" type="button">Play</button>
        <button class="audio-pill" id="audioNext" type="button">Next</button>
        <button class="audio-pill" id="audioMode" type="button">Loop playlist</button>
      </div>
      <input class="audio-volume" id="audioVolume" type="range" min="0" max="1" step="0.01" value="${audioState.volume}">
    </div>
    <p class="audio-now" id="audioNow">No song selected yet.</p>
    <div class="audio-list" id="audioList"></div>`;
    folderGrid.insertAdjacentElement("afterend", section);
    document.body.appendChild(audioState.element);
    bindAudioEvents();
  }

  function activeTracks() {
    return audioState.tracks.filter((track) => track.active);
  }

  function renderAudio() {
    const list = document.getElementById("audioList");
    if (!list) return;
    const active = activeTracks();
    document.getElementById("audioMode").textContent = audioState.mode === "repeat" ? "Repeat song" : "Loop playlist";
    document.getElementById("audioPlayPause").textContent = audioState.playing ? "Pause" : "Play";
    document.getElementById("audioNow").textContent = active[audioState.index]?.title ? `Playing: ${active[audioState.index].title}` : "Choose songs to activate the carousel playlist.";
    if (!audioState.tracks.length) {
      list.innerHTML = `<div class="queue-empty">No audio uploaded yet. Add a song to create a background playlist.</div>`;
      return;
    }
    list.innerHTML = audioState.tracks.map((track) => `<article class="track-row ${track.active ? "active" : ""}">
      <div class="track-name"><strong>${escapeHtml(track.title || track.file_name || "Song")}</strong><span class="track-meta">${fileSizeLabel(Number(track.size || 0))}</span></div>
      <div class="audio-actions">
        <button class="audio-pill ${track.active ? "active" : ""}" data-audio-active="${track.id}" type="button">${track.active ? "Active" : "Use"}</button>
        <button class="audio-pill" data-audio-play="${track.id}" type="button">Play</button>
        <button class="audio-pill" data-audio-delete="${track.id}" type="button">Delete</button>
      </div>
    </article>`).join("");
  }

  async function loadAudio() {
    try {
      const data = await api("/api/audio");
      audioState.tracks = data.audio || [];
      renderAudio();
    } catch (error) {
      const list = document.getElementById("audioList");
      if (list) list.innerHTML = `<div class="queue-empty">Audio setup needs the latest Supabase schema before songs can be saved.</div>`;
      console.error(error);
    }
  }

  async function uploadAudio(files) {
    for (const file of files.filter((item) => item.type.startsWith("audio/"))) {
      const form = new FormData();
      form.append("audio", file, file.name);
      await api("/api/audio/upload", { method: "POST", body: form });
    }
    await loadAudio();
  }

  function playTrackByIndex(index) {
    const tracks = activeTracks();
    if (!tracks.length) return;
    audioState.index = (index + tracks.length) % tracks.length;
    audioState.element.src = tracks[audioState.index].url;
    audioState.element.play().then(() => {
      audioState.playing = true;
      renderAudio();
    }).catch(() => {
      audioState.playing = false;
      renderAudio();
    });
  }

  async function playTrackById(id) {
    let tracks = activeTracks();
    let index = tracks.findIndex((item) => item.id === id);
    if (index < 0) {
      const track = audioState.tracks.find((item) => item.id === id);
      if (track && !track.active) {
        await api(`/api/audio/${track.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: true }) });
        await loadAudio();
        tracks = activeTracks();
        index = tracks.findIndex((item) => item.id === id);
      }
    }
    if (index >= 0) playTrackByIndex(index);
  }

  function toggleAudioPlayback() {
    if (audioState.playing) {
      audioState.element.pause();
      audioState.playing = false;
      renderAudio();
      return;
    }
    playTrackByIndex(audioState.index);
  }

  function bindAudioEvents() {
    document.getElementById("audioInput").addEventListener("change", (event) => {
      uploadAudio([...event.target.files]).catch(showError);
      event.target.value = "";
    });
    document.getElementById("audioPlayPause").addEventListener("click", toggleAudioPlayback);
    document.getElementById("audioNext").addEventListener("click", () => playTrackByIndex(audioState.index + 1));
    document.getElementById("audioPrev").addEventListener("click", () => playTrackByIndex(audioState.index - 1));
    document.getElementById("audioMode").addEventListener("click", () => {
      audioState.mode = audioState.mode === "repeat" ? "loop" : "repeat";
      saveAudioPrefs();
      renderAudio();
    });
    document.getElementById("audioVolume").addEventListener("input", (event) => {
      audioState.volume = Number(event.target.value);
      audioState.element.volume = audioState.volume;
      saveAudioPrefs();
    });
    document.getElementById("audioList").addEventListener("click", async (event) => {
      const active = event.target.closest("[data-audio-active]");
      const play = event.target.closest("[data-audio-play]");
      const remove = event.target.closest("[data-audio-delete]");
      if (active) {
        const track = audioState.tracks.find((item) => item.id === active.dataset.audioActive);
        if (track) await api(`/api/audio/${track.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !track.active }) });
        await loadAudio();
      }
      if (play) await playTrackById(play.dataset.audioPlay);
      if (remove && confirm("Delete this song from carousel music?")) {
        await api(`/api/audio/${remove.dataset.audioDelete}`, { method: "DELETE" });
        await loadAudio();
      }
    });
    audioState.element.addEventListener("ended", () => {
      if (audioState.mode === "repeat") playTrackByIndex(audioState.index);
      else playTrackByIndex(audioState.index + 1);
    });
  }

  createAudioPanel();
  loadAudio();
})();
