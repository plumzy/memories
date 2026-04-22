(() => {
  const ROTATION_PREFS_KEY = "lavender-memories-folder-rotation-v1";
  const THEME_PREFS_KEY = "lavender-memories-theme-v1";
  const ROTATION_LIMIT = 5;
  const ROTATION_INTERVAL = 3600;

  const themes = [
    { id: "lavender", label: "Lavender", swatch: "linear-gradient(135deg,#fbf6ff,#e6d0ff,#fff7fb)" },
    { id: "blush", label: "Blush", swatch: "linear-gradient(135deg,#fff6fb,#ffc6dc,#f6ecff)" },
    { id: "mist", label: "Mist", swatch: "linear-gradient(135deg,#f7fbff,#dff5ee,#f4ecff)" },
    { id: "romantic", label: "Romantic", swatch: "linear-gradient(135deg,#fff2f8,#eadcff,#fff8e8)" },
    { id: "aurora", label: "Aurora", swatch: "linear-gradient(135deg,#f3fffb,#cfadff,#ffeaf4)" },
    { id: "twilight", label: "Twilight", swatch: "linear-gradient(135deg,#171020,#2b1c41,#101827)" }
  ];

  let rotationPrefs = loadJson(ROTATION_PREFS_KEY, {});
  let themePrefs = loadJson(THEME_PREFS_KEY, { theme: "lavender", customImage: null });
  let folderObserver = null;
  const visibleFolders = new Set();

  function loadJson(key, fallback) {
    try {
      return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
    } catch {
      return fallback;
    }
  }

  function saveRotationPrefs() {
    localStorage.setItem(ROTATION_PREFS_KEY, JSON.stringify(rotationPrefs));
  }

  function saveThemePrefs() {
    localStorage.setItem(THEME_PREFS_KEY, JSON.stringify(themePrefs));
  }

  function applyTheme() {
    document.body.dataset.appTheme = themePrefs.theme || "lavender";
    if (themePrefs.customImage) document.body.style.setProperty("--custom-bg-url", `url(${themePrefs.customImage})`);
    else document.body.style.removeProperty("--custom-bg-url");
    renderThemeControls();
  }

  function folderRotationIdsFromDb(folderId) {
    const folder = folderById(folderId);
    return Array.isArray(folder?.rotation_media_ids) ? folder.rotation_media_ids.filter(Boolean) : [];
  }

  function selectedRotationIds(folderId) {
    const dbIds = folderRotationIdsFromDb(folderId);
    if (dbIds.length) return dbIds;
    return Array.isArray(rotationPrefs[folderId]) ? rotationPrefs[folderId].filter(Boolean) : [];
  }

  function setFolderRotationIds(folderId, ids) {
    const folder = folderById(folderId);
    if (folder) folder.rotation_media_ids = ids;
    rotationPrefs[folderId] = ids;
    saveRotationPrefs();
  }

  async function persistFolderRotation(folderId, ids) {
    setFolderRotationIds(folderId, ids);
    renderFolders();
    renderFolderRotationPicker(folderId);
    try {
      const updated = await api(`/api/folders/${folderId}/rotation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaIds: ids })
      });
      if (updated) {
        const index = state.folders.findIndex((folder) => folder.id === updated.id);
        if (index >= 0) state.folders[index] = updated;
        setFolderRotationIds(folderId, updated.rotation_media_ids || []);
        renderFolders();
        renderFolderRotationPicker(folderId);
      }
    } catch (error) {
      console.warn("Folder rotation saved locally until the database schema is updated.", error);
    }
  }

  function folderRotationItems(folderId) {
    const items = folderMedia(folderId);
    const selected = selectedRotationIds(folderId);
    if (selected.length) {
      const chosen = selected.map((id) => items.find((item) => item.id === id)).filter(Boolean);
      if (chosen.length) return chosen.slice(0, ROTATION_LIMIT);
    }
    return items.slice(0, ROTATION_LIMIT);
  }

  function countLabel(count) {
    return `${count} ${count === 1 ? "memory" : "memories"}`;
  }

  function folderMemoryCount(folder) {
    const exactCount = Number(folder?.media_count ?? folder?.mediaCount);
    if (Number.isFinite(exactCount) && exactCount >= 0) return exactCount;
    return folderMedia(folder?.id).length;
  }

  const baseRenderFolders = renderFolders;
  renderFolders = function renderRotatingFolders() {
    const grid = byId("folderGrid");
    if (!grid) return baseRenderFolders();
    if (folderObserver) folderObserver.disconnect();
    visibleFolders.clear();

    grid.innerHTML = state.folders.map((folder) => {
      const allItems = folderMedia(folder.id);
      const memoryCount = folderMemoryCount(folder);
      const rotationItems = folderRotationItems(folder.id);
      const images = rotationItems.map((item, index) => `<img class="folder-rotation-img ${index === 0 ? "active" : ""}" src="${thumbUrl(item)}" alt="" loading="lazy" decoding="async">`).join("");
      const placeholder = `<span class="folder-empty-art"><span>+</span><strong>No photos yet</strong></span>`;
      return `<button class="folder-card rotating-folder-card" type="button" data-folder="${folder.id}" data-rotation-count="${rotationItems.length}" data-rotation-index="0">
        <span class="folder-rotator" aria-hidden="true">${rotationItems.length ? images : placeholder}</span>
        <span class="folder-count-chip">${memoryCount}</span>
        <span class="folder-bottom-overlay"><strong>${escapeHtml(folder.name)}</strong><small>${countLabel(memoryCount)}</small></span>
      </button>`;
    }).join("");
    observeFolderCards();
  };

  const baseRenderFolderDialog = renderFolderDialog;
  renderFolderDialog = function renderFolderDialogWithRotation(folderId) {
    baseRenderFolderDialog(folderId);
    renderFolderRotationPicker(folderId);
  };

  const baseRenderSettings = renderSettings;
  renderSettings = function renderSettingsWithThemes() {
    baseRenderSettings();
    installThemeSettings();
    renderThemeControls();
  };

  function observeFolderCards() {
    const cards = [...document.querySelectorAll(".rotating-folder-card")];
    if (!("IntersectionObserver" in window)) {
      cards.forEach((card) => visibleFolders.add(card.dataset.folder));
      return;
    }
    folderObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const folderId = entry.target.dataset.folder;
        if (!folderId) return;
        if (entry.isIntersecting) visibleFolders.add(folderId);
        else visibleFolders.delete(folderId);
      });
    }, { rootMargin: "120px 0px", threshold: 0.18 });
    cards.forEach((card) => folderObserver.observe(card));
  }

  function escapeFolderSelector(folderId) {
    if (window.CSS?.escape) return CSS.escape(folderId);
    return String(folderId).replace(/["\\]/g, "\\$&");
  }

  function advanceVisibleFolders() {
    if (document.hidden) return;
    visibleFolders.forEach((folderId) => {
      const card = document.querySelector(`.rotating-folder-card[data-folder="${escapeFolderSelector(folderId)}"]`);
      if (!card || Number(card.dataset.rotationCount || 0) < 2) return;
      const images = [...card.querySelectorAll(".folder-rotation-img")];
      if (images.length < 2) return;
      const nextIndex = (Number(card.dataset.rotationIndex || 0) + 1) % images.length;
      card.dataset.rotationIndex = String(nextIndex);
      images.forEach((image, index) => image.classList.toggle("active", index === nextIndex));
    });
  }

  function renderFolderRotationPicker(folderId) {
    const mediaGrid = byId("mediaGrid");
    if (!mediaGrid) return;
    const folder = folderById(folderId);
    const items = folderMedia(folderId);
    let panel = byId("folderRotationPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "folderRotationPanel";
      panel.className = "control-card folder-rotation-panel";
      mediaGrid.parentNode.insertBefore(panel, mediaGrid);
    }
    if (!items.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const selected = selectedRotationIds(folderId).filter((id) => items.some((item) => item.id === id));
    const selectedSet = new Set(selected);
    const folderLabel = folder ? escapeHtml(folder.name) : "This folder";
    const modeCopy = selected.length
      ? `${selected.length} selected. Tap images to add or remove them from the folder card rotation.`
      : `Auto mode uses the first ${Math.min(ROTATION_LIMIT, items.length)} thumbnails. Tap any image below to customize.`;
    panel.innerHTML = `<div class="folder-rotation-head">
      <div><label>Folder thumbnail rotation</label><p>${folderLabel} shows the full folder library here. ${modeCopy}</p></div>
      <button class="secondary-button" type="button" data-folder-rotation-auto="${folderId}">Auto</button>
    </div>
    <div class="folder-rotation-grid" aria-label="Choose folder rotation images">
      ${items.map((item) => {
        const order = selected.indexOf(item.id) + 1;
        return `<button class="folder-rotation-choice ${selectedSet.has(item.id) ? "active" : ""}" type="button" data-folder-rotation-toggle="${item.id}" data-folder-id="${folderId}" data-order="${order > 0 ? order : ""}" aria-label="${selectedSet.has(item.id) ? "Remove from" : "Add to"} folder rotation"><img src="${thumbUrl(item)}" alt="" loading="lazy" decoding="async"></button>`;
      }).join("")}
    </div>`;
  }

  async function toggleFolderRotation(folderId, mediaId) {
    const selected = selectedRotationIds(folderId).filter((id) => mediaById(id));
    const index = selected.indexOf(mediaId);
    if (index >= 0) selected.splice(index, 1);
    else if (selected.length < ROTATION_LIMIT) selected.push(mediaId);
    else {
      selected.shift();
      selected.push(mediaId);
    }
    await persistFolderRotation(folderId, selected);
  }

  async function resetFolderRotation(folderId) {
    delete rotationPrefs[folderId];
    saveRotationPrefs();
    await persistFolderRotation(folderId, []);
  }

  function installThemeSettings() {
    const settingsList = document.querySelector("#settingsDialog .settings-list");
    if (!settingsList || byId("themeControls")) return;
    const section = document.createElement("section");
    section.className = "control-card theme-card";
    section.id = "themeControls";
    section.innerHTML = `<label>App background</label>
      <div class="theme-grid" id="themeGrid"></div>
      <div class="inline-create">
        <button class="secondary-button" type="button" id="customBackgroundButton">Use custom background image</button>
        <button class="secondary-button" type="button" id="clearCustomBackgroundButton">Clear custom image</button>
        <input id="customBackgroundInput" type="file" accept="image/*" hidden>
      </div>`;
    settingsList.insertAdjacentElement("afterend", section);
    byId("customBackgroundButton").addEventListener("click", () => byId("customBackgroundInput").click());
    byId("clearCustomBackgroundButton").addEventListener("click", () => {
      themePrefs.customImage = null;
      themePrefs.theme = "lavender";
      saveThemePrefs();
      applyTheme();
    });
    byId("customBackgroundInput").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        themePrefs.customImage = await makeBackgroundDataUrl(file);
        themePrefs.theme = "custom-image";
        saveThemePrefs();
        applyTheme();
      } catch (error) {
        showError(error);
      }
    });
  }

  function renderThemeControls() {
    const grid = byId("themeGrid");
    if (!grid) return;
    grid.innerHTML = themes.map((theme) => `<button class="theme-swatch ${themePrefs.theme === theme.id ? "active" : ""}" type="button" data-theme-choice="${theme.id}" style="--swatch:${theme.swatch}">${theme.label}</button>`).join("");
  }

  function makeBackgroundDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) return reject(new Error("Choose an image file for the background."));
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        if (dataUrl.length > 4500000) return reject(new Error("That background image is too large to save locally."));
        resolve(dataUrl);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that background image."));
      };
      image.src = url;
    });
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-folder-rotation-toggle]");
    if (toggle) {
      toggleFolderRotation(toggle.dataset.folderId, toggle.dataset.folderRotationToggle).catch(showError);
      return;
    }
    const reset = event.target.closest("[data-folder-rotation-auto]");
    if (reset) {
      resetFolderRotation(reset.dataset.folderRotationAuto).catch(showError);
      return;
    }
    const themeButton = event.target.closest("[data-theme-choice]");
    if (themeButton) {
      themePrefs.theme = themeButton.dataset.themeChoice;
      saveThemePrefs();
      applyTheme();
    }
  });

  window.setInterval(advanceVisibleFolders, ROTATION_INTERVAL);
  applyTheme();
  installThemeSettings();
  if (state.folders.length) renderFolders();
})();
