const state = {
  folders: [],
  media: [],
  carousel: { mode: "all", selected_ids: [], playing: true },
  currentFolder: "all",
  selected: new Set(),
  slide: 0,
  viewerIndex: 0,
  timer: null,
  touchStart: null,
  googleAccessToken: null,
  googleSession: null
};

const $ = (id) => document.getElementById(id);
const api = async (path, options = {}) => {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || "Request failed.");
  }
  return response.json();
};

function visibleMedia() {
  if (state.currentFolder === "all") return state.media;
  return state.media.filter((item) => item.folder_id === state.currentFolder);
}

function carouselMedia() {
  if (state.carousel.mode === "selected") {
    return state.media
      .filter((item) => item.included_in_carousel || state.carousel.selected_ids?.includes(item.id))
      .sort((a, b) => (a.carousel_order ?? 9999) - (b.carousel_order ?? 9999));
  }
  if (state.carousel.mode === "folders" && state.currentFolder !== "all") return visibleMedia();
  return state.media;
}

function folderName(id) {
  return state.folders.find((folder) => folder.id === id)?.name || "Memories";
}

async function loadData() {
  const data = await api("/api/media");
  state.folders = data.folders.length ? data.folders : [{ id: "default", name: "Memories", user_id: "anniversary" }];
  state.media = data.media;
  state.carousel = data.carousel || state.carousel;
  render();
}

function render() {
  renderFolders();
  renderFolderSelect();
  renderGallery();
  renderCarousel();
  $("countBadge").textContent = `${state.media.length} photos`;
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.carousel.mode));
  $("playBtn").textContent = state.carousel.playing ? "Pause" : "Play";
}

function renderFolderSelect() {
  $("folderSelect").innerHTML = state.folders.map((folder) => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`).join("");
}

function renderFolders() {
  const allCard = folderCard({ id: "all", name: "All Photos" }, state.media.length);
  $("foldersGrid").innerHTML = allCard + state.folders.map((folder) => {
    const count = state.media.filter((item) => item.folder_id === folder.id).length;
    return folderCard(folder, count);
  }).join("");
  document.querySelectorAll(".folder-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.currentFolder = card.dataset.id;
      state.slide = 0;
      render();
    });
  });
}

function folderCard(folder, count) {
  return `<button class="folder-card ${state.currentFolder === folder.id ? "active" : ""}" data-id="${folder.id}">
    <strong>${escapeHtml(folder.name)}</strong>
    <span>${count} ${count === 1 ? "memory" : "memories"}</span>
  </button>`;
}

function renderGallery() {
  const items = visibleMedia();
  $("galleryTitle").textContent = state.currentFolder === "all" ? "All Photos" : folderName(state.currentFolder);
  if (!items.length) {
    $("galleryGrid").innerHTML = $("emptyTemplate").innerHTML;
    return;
  }
  $("galleryGrid").innerHTML = items.map((item) => `<article class="media-card ${state.selected.has(item.id) ? "selected" : ""}" data-id="${item.id}">
    <input class="check" type="checkbox" ${state.selected.has(item.id) ? "checked" : ""} aria-label="Select photo">
    ${item.included_in_carousel ? "<span class=\"badge\">Glow</span>" : ""}
    <img src="${item.thumbnail_url || item.url}" alt="${escapeHtml(item.caption || "Memory photo")}">
    <p>${escapeHtml(item.caption || "Add a caption")}</p>
  </article>`).join("");
  document.querySelectorAll(".media-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      const id = card.dataset.id;
      if (event.target.classList.contains("check")) {
        toggleSelected(id);
      } else {
        state.viewerIndex = visibleMedia().findIndex((item) => item.id === id);
        openViewer();
      }
    });
  });
}

function renderCarousel() {
  const items = carouselMedia();
  clearInterval(state.timer);
  if (!items.length) {
    $("carouselTrack").innerHTML = `<div class="slide active"><div class="empty-state"><div class="tulip-mini"></div><p>Your first memory will bloom here.</p></div></div>`;
    $("carouselCaption").textContent = "Upload your first favorite memory.";
    $("carouselAuthor").textContent = "";
    return;
  }
  state.slide = ((state.slide % items.length) + items.length) % items.length;
  $("carouselTrack").innerHTML = items.map((item, index) => `<div class="slide ${index === state.slide ? "active" : ""}">
    <img src="${item.url}" alt="${escapeHtml(item.caption || "Memory photo")}">
  </div>`).join("");
  const active = items[state.slide];
  $("carouselCaption").textContent = active.caption || "A quiet little moment worth keeping.";
  $("carouselAuthor").textContent = active.author ? `by ${active.author}` : "";
  if (state.carousel.playing && items.length > 1) {
    state.timer = setInterval(() => changeSlide(1), 5200);
  }
}

function changeSlide(delta) {
  const items = carouselMedia();
  if (!items.length) return;
  state.slide = (state.slide + delta + items.length) % items.length;
  renderCarousel();
}

function toggleSelected(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  renderGallery();
}

async function uploadFiles(files) {
  if (!files.length) return;
  const folderId = state.currentFolder === "all" ? ($("folderSelect").value || "default") : state.currentFolder;
  const form = new FormData();
  form.append("folderId", folderId);
  form.append("folderName", folderName(folderId));
  for (const file of files) form.append("images", file);
  await api("/api/upload", { method: "POST", body: form });
  await loadData();
}

async function deleteIds(ids) {
  if (!ids.length || !confirm(`Delete ${ids.length} selected memory item(s)?`)) return;
  for (const id of ids) await api(`/api/media/${id}`, { method: "DELETE" });
  ids.forEach((id) => state.selected.delete(id));
  await loadData();
}

async function moveIds(ids) {
  if (!ids.length) return alert("Select at least one photo first.");
  const folderId = $("folderSelect").value;
  await api("/api/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaIds: ids, folderId, folderName: folderName(folderId) })
  });
  state.selected.clear();
  await loadData();
}

function openViewer() {
  const item = visibleMedia()[state.viewerIndex];
  if (!item) return;
  $("viewerImage").src = item.url;
  $("captionInput").value = item.caption || "";
  $("authorInput").value = item.author || "";
  $("toggleCarouselBtn").textContent = item.included_in_carousel ? "Remove Glow" : "Add Glow";
  $("viewer").showModal();
}

function viewerStep(delta) {
  const items = visibleMedia();
  state.viewerIndex = (state.viewerIndex + delta + items.length) % items.length;
  openViewer();
}

async function saveCaption(event) {
  event.preventDefault();
  const item = visibleMedia()[state.viewerIndex];
  if (!item) return;
  await api(`/api/media/${item.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption: $("captionInput").value.trim() || null, author: $("authorInput").value.trim() || null })
  });
  await loadData();
  openViewer();
}

async function toggleCarouselItem() {
  const item = visibleMedia()[state.viewerIndex];
  await api(`/api/media/${item.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ included_in_carousel: !item.included_in_carousel, carousel_order: item.carousel_order ?? state.media.length })
  });
  await loadData();
  openViewer();
}

async function createFolder() {
  const name = prompt("Folder name");
  if (!name) return;
  const folder = await api("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  state.currentFolder = folder.id;
  await loadData();
}

async function saveCarouselMode(mode) {
  state.carousel.mode = mode;
  await api("/api/carousel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      selectedIds: state.media.filter((item) => item.included_in_carousel).map((item) => item.id),
      playing: state.carousel.playing
    })
  });
  render();
}

async function launchGooglePhotos() {
  if (!state.googleAccessToken) {
    const { authUrl } = await api("/api/google-photos/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: "google-photos", folderName: "Google Photos" })
    });
    window.open(authUrl, "googlePhotos", "width=520,height=720");
    return;
  }
  const session = await api("/api/google-photos/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken: state.googleAccessToken })
  });
  state.googleSession = session;
  window.open(session.pickerUri, "googlePhotosPicker", "width=920,height=760");
  alert("Choose photos in the Google picker, then return here and press Google Photos again to import.");
}

async function maybeImportGoogleSelection() {
  if (!state.googleAccessToken || !state.googleSession?.id) return false;
  const result = await api("/api/google-photos/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accessToken: state.googleAccessToken,
      sessionId: state.googleSession.id,
      folderId: "google-photos",
      folderName: "Google Photos"
    })
  });
  if (result.media?.length) {
    state.googleSession = null;
    await loadData();
    alert(`Imported ${result.media.length} Google Photos item(s).`);
    return true;
  }
  return false;
}

function bindEvents() {
  $("fileInput").addEventListener("change", (event) => uploadFiles([...event.target.files]));
  $("refreshBtn").addEventListener("click", loadData);
  $("newFolderBtn").addEventListener("click", createFolder);
  $("moveBtn").addEventListener("click", () => moveIds([...state.selected]));
  $("deleteSelectedBtn").addEventListener("click", () => deleteIds([...state.selected]));
  $("clearSelectionBtn").addEventListener("click", () => { state.selected.clear(); renderGallery(); });
  $("prevBtn").addEventListener("click", () => changeSlide(-1));
  $("nextBtn").addEventListener("click", () => changeSlide(1));
  $("playBtn").addEventListener("click", async () => {
    state.carousel.playing = !state.carousel.playing;
    await saveCarouselMode(state.carousel.mode);
  });
  document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => saveCarouselMode(button.dataset.mode)));
  $("closeViewer").addEventListener("click", () => $("viewer").close());
  $("viewerPrev").addEventListener("click", () => viewerStep(-1));
  $("viewerNext").addEventListener("click", () => viewerStep(1));
  $("captionForm").addEventListener("submit", saveCaption);
  $("toggleCarouselBtn").addEventListener("click", toggleCarouselItem);
  $("viewerDeleteBtn").addEventListener("click", async () => {
    const item = visibleMedia()[state.viewerIndex];
    $("viewer").close();
    await deleteIds([item.id]);
  });
  $("viewerMoveBtn").addEventListener("click", async () => {
    const item = visibleMedia()[state.viewerIndex];
    await moveIds([item.id]);
    $("viewer").close();
  });
  $("googleBtn").addEventListener("click", async () => {
    if (!(await maybeImportGoogleSelection())) await launchGooglePhotos();
  });
  $("carouselTrack").addEventListener("touchstart", (event) => { state.touchStart = event.touches[0].clientX; }, { passive: true });
  $("carouselTrack").addEventListener("touchend", (event) => {
    if (state.touchStart == null) return;
    const delta = event.changedTouches[0].clientX - state.touchStart;
    if (Math.abs(delta) > 40) changeSlide(delta > 0 ? -1 : 1);
    state.touchStart = null;
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "GOOGLE_PHOTOS_TOKEN_VALUE") {
      state.googleAccessToken = event.data.accessToken;
      launchGooglePhotos().catch(showError);
    }
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function showError(error) {
  console.error(error);
  alert(error.message || "Something went wrong.");
}

let deferredPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  $("installBtn").hidden = false;
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
bindEvents();
loadData().catch(showError);
