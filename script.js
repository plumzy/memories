const UI_PREFS_KEY = "lavender-memories-ui-v1";

const state = {
  folders: [],
  media: [],
  carousel: { mode: "all", selected_ids: [], playing: true },
  prefs: loadPrefs(),
  currentFolderId: null,
  importFolderId: "default",
  selectedIds: new Set(),
  viewerIds: [],
  viewerIndex: 0,
  carouselIndex: 0,
  timer: null,
  touchStart: 0,
  longPressTimer: null,
  longPressTriggered: false,
  googleAccessToken: null,
  googleSession: null
};

const byId = (id) => document.getElementById(id);
const api = async (path, options = {}) => {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || "Request failed.");
  }
  return response.json();
};

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}");
    return { showCaptions: saved.showCaptions !== false, speed: saved.speed || 5200, glow: saved.glow || 76 };
  } catch {
    return { showCaptions: true, speed: 5200, glow: 76 };
  }
}

function savePrefs() {
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify(state.prefs));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function mediaUrl(item) { return item.url; }
function thumbUrl(item) { return item.thumbnail_url || item.url; }
function folderById(id) { return state.folders.find((folder) => folder.id === id); }
function mediaById(id) { return state.media.find((item) => item.id === id); }
function folderMedia(folderId) { return state.media.filter((item) => item.folder_id === folderId); }
function folderName(id) { return folderById(id)?.name || "Memories"; }

async function loadData() {
  const data = await api("/api/media");
  state.folders = data.folders.length ? data.folders : [{ id: "default", name: "Memories" }];
  state.media = data.media;
  state.carousel = data.carousel || state.carousel;
  state.importFolderId = state.importFolderId || state.folders[0]?.id || "default";
  if (!state.currentFolderId && state.folders[0]) state.currentFolderId = state.folders[0].id;
  renderAll();
}

function getCarouselMedia() {
  if (state.carousel.mode === "selected") {
    return state.media
      .filter((item) => item.included_in_carousel || state.carousel.selected_ids?.includes(item.id))
      .sort((a, b) => (a.carousel_order ?? 9999) - (b.carousel_order ?? 9999));
  }
  if (state.carousel.mode === "folders" && state.currentFolderId) return folderMedia(state.currentFolderId);
  return state.media;
}

function renderAll() {
  renderCarousel();
  renderFolders();
  renderSummary();
  if (byId("folderDialog").open && state.currentFolderId) renderFolderDialog(state.currentFolderId);
  if (byId("settingsDialog").open) renderSettings();
  if (byId("importDialog").open) renderImport();
  if (byId("viewerDialog").open) renderViewer();
}

function renderSummary() {
  byId("photoCount").textContent = `${state.media.length} ${state.media.length === 1 ? "photo" : "photos"}`;
  byId("folderCount").textContent = `${state.folders.length} ${state.folders.length === 1 ? "folder" : "folders"}`;
  byId("carouselModeLabel").textContent = ({ all: "All Photos", folders: "Folder Cycle", selected: "Selected Photos" })[state.carousel.mode] || "All Photos";
}

function renderCarousel() {
  const items = getCarouselMedia();
  clearInterval(state.timer);
  document.documentElement.style.setProperty("--hero-glow", `rgba(181,112,255,${state.prefs.glow / 140})`);
  if (state.carouselIndex >= items.length) state.carouselIndex = 0;
  byId("emptyHero").classList.toggle("show", items.length === 0);
  byId("heroImage").hidden = items.length === 0;
  byId("heroImage").classList.toggle("active", items.length > 0);
  byId("prevHero").hidden = items.length < 2;
  byId("nextHero").hidden = items.length < 2;

  if (items.length) {
    const item = items[state.carouselIndex];
    byId("heroImage").src = mediaUrl(item);
    byId("heroImage").alt = item.caption || "Anniversary memory";
    byId("heroCaption").classList.toggle("show", state.prefs.showCaptions);
    byId("heroCaption").innerHTML = state.prefs.showCaptions
      ? `<div class="caption-author">${escapeHtml(item.author ? `${item.author} wrote` : "Memory")}</div><div class="caption-copy">${escapeHtml(item.caption || "Add a memory here...")}</div>`
      : "";
  } else {
    byId("heroCaption").classList.remove("show");
    byId("heroCaption").innerHTML = "";
  }

  byId("heroDots").innerHTML = items.map((item, index) => `<span class="${index === state.carouselIndex ? "active" : ""}" data-dot="${item.id}"></span>`).join("");
  byId("playToggle").textContent = state.carousel.playing ? "II" : "Play";
  if (state.carousel.playing && items.length > 1) state.timer = setInterval(() => changeCarousel(1), state.prefs.speed);
}

function changeCarousel(direction) {
  const items = getCarouselMedia();
  if (!items.length) return;
  state.carouselIndex = (state.carouselIndex + direction + items.length) % items.length;
  byId("heroImage").classList.remove("active");
  window.setTimeout(renderCarousel, 90);
}

function renderFolders() {
  byId("folderGrid").innerHTML = state.folders.map((folder, index) => {
    const items = folderMedia(folder.id);
    const cover = items[0];
    return `<button class="folder-card" type="button" data-folder="${folder.id}">
      ${cover ? `<img src="${thumbUrl(cover)}" alt="">` : `<div class="empty-hero show"><div><div class="empty-tulip"></div><p>No photos yet</p></div></div>`}
      ${index === 0 ? `<span class="highlight-badge">*</span>` : ""}
      <span class="folder-copy"><strong>${escapeHtml(folder.name)}</strong><span>${items.length} ${items.length === 1 ? "memory" : "memories"}</span></span>
    </button>`;
  }).join("");
}

function openFolder(folderId) {
  state.currentFolderId = folderId;
  state.selectedIds.clear();
  renderFolderDialog(folderId);
  byId("folderDialog").showModal();
}

function renderFolderDialog(folderId) {
  const folder = folderById(folderId);
  const items = folderMedia(folderId);
  byId("folderTitle").textContent = folder?.name || "Folder";
  byId("folderSubtitle").textContent = `${items.length} ${items.length === 1 ? "memory" : "memories"}`;
  byId("batchBar").classList.toggle("show", state.selectedIds.size > 0);
  byId("batchCount").textContent = `${state.selectedIds.size} selected`;
  if (!items.length) {
    byId("mediaGrid").innerHTML = `<div class="empty-inline"><div><div class="empty-tulip"></div><h2>No memories here yet</h2><p>Import photos into this folder to start this chapter.</p></div></div>`;
    return;
  }
  byId("mediaGrid").innerHTML = items.map((item) => `<button class="media-card ${state.selectedIds.has(item.id) ? "selected" : ""}" type="button" data-media="${item.id}">
    <img src="${thumbUrl(item)}" alt="">
    ${item.included_in_carousel ? `<span class="carousel-badge">*</span>` : ""}
    ${state.selectedIds.size ? `<span class="check-badge">${state.selectedIds.has(item.id) ? "OK" : "+"}</span>` : ""}
    <span class="media-copy">${escapeHtml(item.caption || "Add a caption")}</span>
  </button>`).join("");
}

function toggleSelected(id) {
  state.selectedIds.has(id) ? state.selectedIds.delete(id) : state.selectedIds.add(id);
  renderFolderDialog(state.currentFolderId);
}

function openViewer(ids, startId) {
  state.viewerIds = ids;
  state.viewerIndex = Math.max(0, ids.indexOf(startId));
  renderViewer();
  byId("viewerDialog").showModal();
}

function renderViewer() {
  const item = mediaById(state.viewerIds[state.viewerIndex]);
  if (!item) return byId("viewerDialog").close();
  byId("viewerImage").src = mediaUrl(item);
  byId("viewerImage").alt = item.caption || "Anniversary memory";
  byId("viewerCounter").textContent = `${state.viewerIndex + 1} / ${state.viewerIds.length}`;
  byId("viewerCaption").innerHTML = `<div class="caption-author">${escapeHtml(item.author ? `${item.author} wrote` : "Memory caption")}</div><div class="caption-copy">${escapeHtml(item.caption || "Add a memory here...")}</div>`;
  byId("toggleCarouselButton").textContent = item.included_in_carousel ? "Remove" : "Carousel";
}

function changeViewer(direction) {
  if (!state.viewerIds.length) return;
  state.viewerIndex = (state.viewerIndex + direction + state.viewerIds.length) % state.viewerIds.length;
  renderViewer();
}

function setProgress(active, width = 0) {
  byId("progressShell").hidden = !active;
  byId("progressBar").style.width = `${width}%`;
}

async function uploadFiles(files) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  const form = new FormData();
  form.append("folderId", state.importFolderId || "default");
  form.append("folderName", folderName(state.importFolderId));
  for (const file of images) form.append("images", file);
  byId("importStatus").textContent = "Uploading and compressing memories...";
  setProgress(true, 18);
  await api("/api/upload", { method: "POST", body: form });
  setProgress(true, 100);
  byId("importStatus").textContent = `${images.length} photo${images.length === 1 ? "" : "s"} imported.`;
  await loadData();
  window.setTimeout(() => setProgress(false), 900);
}

async function createFolder() {
  const name = byId("newFolderName").value.trim();
  if (!name) return;
  const folder = await api("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  state.importFolderId = folder.id;
  byId("newFolderName").value = "";
  await loadData();
  renderImport();
}

async function deleteIds(ids) {
  if (!ids.length || !confirm(`Delete ${ids.length} selected memory item(s)?`)) return;
  for (const id of ids) await api(`/api/media/${id}`, { method: "DELETE" });
  ids.forEach((id) => state.selectedIds.delete(id));
  await loadData();
}

async function moveIds(ids, folderId) {
  if (!ids.length) return;
  await api("/api/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaIds: ids, folderId, folderName: folderName(folderId) }) });
  state.selectedIds.clear();
  byId("moveDialog").close();
  await loadData();
}

function openMoveDialog(ids) {
  byId("moveCount").textContent = `${ids.length} selected`;
  byId("moveFolderList").innerHTML = state.folders.map((folder) => `<button data-move-folder="${folder.id}" type="button">${escapeHtml(folder.name)} · ${folderMedia(folder.id).length}</button>`).join("");
  byId("moveFolderList").dataset.ids = JSON.stringify(ids);
  byId("moveDialog").showModal();
}

async function updateMedia(id, payload) {
  await api(`/api/media/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  await loadData();
}

function openCaptionEditor(id) {
  const item = mediaById(id);
  if (!item) return;
  byId("captionDialog").dataset.mediaId = id;
  byId("captionInput").value = item.caption || "";
  byId("authorInput").value = item.author || "";
  byId("captionDialog").showModal();
}

async function saveCaption() {
  const id = byId("captionDialog").dataset.mediaId;
  await updateMedia(id, { caption: byId("captionInput").value.trim() || null, author: byId("authorInput").value.trim() || null });
  byId("captionDialog").close();
}

async function deleteCaption() {
  const id = byId("captionDialog").dataset.mediaId;
  await updateMedia(id, { caption: null, author: null });
  byId("captionDialog").close();
}

async function toggleCarouselItem(id) {
  const item = mediaById(id);
  await updateMedia(id, { included_in_carousel: !item.included_in_carousel, carousel_order: item.carousel_order ?? state.media.length });
}

async function persistCarouselSettings(overrides = {}) {
  state.carousel = { ...state.carousel, ...overrides };
  await api("/api/carousel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: state.carousel.mode,
      selectedIds: state.media.filter((item) => item.included_in_carousel).map((item) => item.id),
      playing: state.carousel.playing
    })
  });
  await loadData();
}

function renderSettings() {
  byId("modeControls").innerHTML = [["all", "All Photos"], ["folders", "Folder Cycle"], ["selected", "Selected"]].map(([id, label]) => `<button class="${state.carousel.mode === id ? "active" : ""}" data-mode="${id}" type="button">${label}</button>`).join("");
  byId("folderCycleControls").hidden = state.carousel.mode !== "folders";
  byId("selectedControls").hidden = state.carousel.mode !== "selected";
  byId("folderSourceList").innerHTML = state.folders.map((folder) => `<button class="${state.currentFolderId === folder.id ? "active" : ""}" data-source-folder="${folder.id}" type="button">${escapeHtml(folder.name)}</button>`).join("");
  byId("selectedPhotoGrid").innerHTML = state.media.map((item) => `<button class="select-card ${item.included_in_carousel ? "selected" : ""}" type="button" data-select-carousel="${item.id}"><img src="${thumbUrl(item)}" alt=""><span class="check-badge">${item.included_in_carousel ? "OK" : "+"}</span></button>`).join("");
  byId("rotationPreview").innerHTML = getCarouselMedia().map((item, index) => `<div class="preview-card"><img src="${thumbUrl(item)}" alt=""><span class="preview-order">${index + 1}</span></div>`).join("");
  byId("autoRotateInput").checked = state.carousel.playing;
  byId("showCaptionsInput").checked = state.prefs.showCaptions;
  byId("speedInput").value = state.prefs.speed;
  byId("speedValue").textContent = (state.prefs.speed / 1000).toFixed(1);
  byId("glowInput").value = state.prefs.glow;
  byId("glowValue").textContent = state.prefs.glow;
}

function renderImport() {
  byId("importFolderList").innerHTML = state.folders.map((folder) => `<button class="${state.importFolderId === folder.id ? "active" : ""}" data-import-folder="${folder.id}" type="button">${escapeHtml(folder.name)}</button>`).join("");
}

async function launchGooglePhotos() {
  if (!state.googleAccessToken) {
    const { authUrl } = await api("/api/google-photos/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: state.importFolderId, folderName: folderName(state.importFolderId) }) });
    window.open(authUrl, "googlePhotos", "width=520,height=720");
    byId("importStatus").textContent = "Complete Google sign-in in the popup.";
    return;
  }
  const session = await api("/api/google-photos/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: state.googleAccessToken }) });
  state.googleSession = session;
  window.open(session.pickerUri, "googlePhotosPicker", "width=920,height=760");
  byId("importStatus").textContent = "Choose photos, return here, then press Google Photos again to import.";
}

async function maybeImportGoogleSelection() {
  if (!state.googleAccessToken || !state.googleSession?.id) return false;
  byId("importStatus").textContent = "Importing Google Photos selection...";
  setProgress(true, 25);
  const result = await api("/api/google-photos/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: state.googleAccessToken, sessionId: state.googleSession.id, folderId: state.importFolderId, folderName: folderName(state.importFolderId) }) });
  state.googleSession = null;
  setProgress(true, 100);
  await loadData();
  byId("importStatus").textContent = `Imported ${result.media?.length || 0} Google Photos item(s).`;
  window.setTimeout(() => setProgress(false), 900);
  return true;
}

function bindEvents() {
  byId("refreshButton").addEventListener("click", loadData);
  byId("importButton").addEventListener("click", () => { state.importFolderId = state.currentFolderId || state.folders[0]?.id || "default"; renderImport(); byId("importDialog").showModal(); });
  byId("emptyImportButton").addEventListener("click", () => byId("importButton").click());
  byId("settingsButton").addEventListener("click", () => { renderSettings(); byId("settingsDialog").showModal(); });
  for (const id of ["Import", "Settings", "Folder", "Viewer", "Caption", "Move"]) {
    const button = byId(`close${id}`);
    const dialog = byId(`${id.toLowerCase()}Dialog`);
    if (button && dialog) button.addEventListener("click", () => dialog.close());
  }
  byId("prevHero").addEventListener("click", () => changeCarousel(-1));
  byId("nextHero").addEventListener("click", () => changeCarousel(1));
  byId("playToggle").addEventListener("click", () => persistCarouselSettings({ playing: !state.carousel.playing }).catch(showError));
  byId("heroStage").addEventListener("click", (event) => { if (event.target.closest("button")) return; const item = getCarouselMedia()[state.carouselIndex]; if (item) openViewer(getCarouselMedia().map((m) => m.id), item.id); });
  byId("heroStage").addEventListener("touchstart", (event) => { state.touchStart = event.touches[0].clientX; }, { passive: true });
  byId("heroStage").addEventListener("touchend", (event) => { const delta = event.changedTouches[0].clientX - state.touchStart; if (Math.abs(delta) > 40) changeCarousel(delta > 0 ? -1 : 1); });
  byId("folderGrid").addEventListener("click", (event) => { const card = event.target.closest("[data-folder]"); if (card) openFolder(card.dataset.folder); });
  byId("folderImportButton").addEventListener("click", () => { state.importFolderId = state.currentFolderId; renderImport(); byId("importDialog").showModal(); });
  byId("mediaGrid").addEventListener("click", (event) => { const card = event.target.closest("[data-media]"); if (!card) return; if (state.longPressTriggered) { state.longPressTriggered = false; return; } if (state.selectedIds.size) toggleSelected(card.dataset.media); else openViewer(folderMedia(state.currentFolderId).map((item) => item.id), card.dataset.media); });
  byId("mediaGrid").addEventListener("contextmenu", (event) => { const card = event.target.closest("[data-media]"); if (!card) return; event.preventDefault(); toggleSelected(card.dataset.media); });
  byId("mediaGrid").addEventListener("pointerdown", (event) => { const card = event.target.closest("[data-media]"); if (!card) return; clearTimeout(state.longPressTimer); state.longPressTriggered = false; state.longPressTimer = setTimeout(() => { state.longPressTriggered = true; toggleSelected(card.dataset.media); }, 520); });
  byId("mediaGrid").addEventListener("pointerup", () => clearTimeout(state.longPressTimer));
  byId("mediaGrid").addEventListener("pointerleave", () => clearTimeout(state.longPressTimer));
  byId("batchMove").addEventListener("click", () => openMoveDialog([...state.selectedIds]));
  byId("batchDelete").addEventListener("click", () => deleteIds([...state.selectedIds]).catch(showError));
  byId("batchClear").addEventListener("click", () => { state.selectedIds.clear(); renderFolderDialog(state.currentFolderId); });
  byId("viewerPrev").addEventListener("click", () => changeViewer(-1));
  byId("viewerNext").addEventListener("click", () => changeViewer(1));
  byId("editCaptionButton").addEventListener("click", () => openCaptionEditor(state.viewerIds[state.viewerIndex]));
  byId("toggleCarouselButton").addEventListener("click", () => toggleCarouselItem(state.viewerIds[state.viewerIndex]).catch(showError));
  byId("movePhotoButton").addEventListener("click", () => openMoveDialog([state.viewerIds[state.viewerIndex]]));
  byId("deletePhotoButton").addEventListener("click", async () => { await deleteIds([state.viewerIds[state.viewerIndex]]); byId("viewerDialog").close(); });
  byId("modeControls").addEventListener("click", (event) => { const button = event.target.closest("[data-mode]"); if (button) persistCarouselSettings({ mode: button.dataset.mode }).catch(showError); });
  byId("folderSourceList").addEventListener("click", (event) => { const button = event.target.closest("[data-source-folder]"); if (!button) return; state.currentFolderId = button.dataset.sourceFolder; renderSettings(); renderCarousel(); });
  byId("selectedPhotoGrid").addEventListener("click", (event) => { const button = event.target.closest("[data-select-carousel]"); if (button) toggleCarouselItem(button.dataset.selectCarousel).catch(showError); });
  byId("autoRotateInput").addEventListener("change", (event) => persistCarouselSettings({ playing: event.target.checked }).catch(showError));
  byId("showCaptionsInput").addEventListener("change", (event) => { state.prefs.showCaptions = event.target.checked; savePrefs(); renderCarousel(); renderSettings(); });
  byId("speedInput").addEventListener("input", (event) => { state.prefs.speed = Number(event.target.value); savePrefs(); renderCarousel(); renderSettings(); });
  byId("glowInput").addEventListener("input", (event) => { state.prefs.glow = Number(event.target.value); savePrefs(); renderCarousel(); renderSettings(); });
  byId("importFolderList").addEventListener("click", (event) => { const button = event.target.closest("[data-import-folder]"); if (!button) return; state.importFolderId = button.dataset.importFolder; renderImport(); });
  byId("createFolderButton").addEventListener("click", () => createFolder().catch(showError));
  byId("fileInput").addEventListener("change", (event) => uploadFiles([...event.target.files]).catch(showError));
  byId("connectGoogle").addEventListener("click", async () => { if (!(await maybeImportGoogleSelection())) await launchGooglePhotos(); });
  const dropZone = byId("dropZone");
  dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); uploadFiles([...event.dataTransfer.files]).catch(showError); });
  byId("saveCaption").addEventListener("click", () => saveCaption().catch(showError));
  byId("deleteCaption").addEventListener("click", () => deleteCaption().catch(showError));
  byId("moveFolderList").addEventListener("click", (event) => { const button = event.target.closest("[data-move-folder]"); if (!button) return; moveIds(JSON.parse(byId("moveFolderList").dataset.ids || "[]"), button.dataset.moveFolder).catch(showError); });
  window.addEventListener("message", (event) => { if (event.data?.type === "GOOGLE_PHOTOS_TOKEN_VALUE") { state.googleAccessToken = event.data.accessToken; launchGooglePhotos().catch(showError); } });
  document.addEventListener("keydown", (event) => { if (byId("viewerDialog").open && event.key === "ArrowLeft") changeViewer(-1); if (byId("viewerDialog").open && event.key === "ArrowRight") changeViewer(1); });
}

function showError(error) {
  console.error(error);
  const target = byId("importStatus");
  setProgress(false);
  if (target && byId("importDialog").open) target.textContent = error.message || "Something went wrong.";
  else alert(error.message || "Something went wrong.");
}

let deferredPrompt;
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredPrompt = event; });
byId("installBtn").addEventListener("click", async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); deferredPrompt = null; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
bindEvents();
loadData().catch(showError);
