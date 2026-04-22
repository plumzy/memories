(() => {
  const CAROUSEL_LIMIT = 60;
  const PICKER_PAGE_SIZE = 160;
  const FOLDER_PAGE_SIZE = 180;
  const folderVisibleLimits = new Map();
  const pickerVisibleLimits = new Map();
  let carouselNoticeTimer = null;
  let deferredInstallPrompt = null;

  const icons = {
    import: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v10"></path><path d="m8 11 4 4 4-4"></path><path d="M5 19h14"></path></svg>`,
    gallery: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"></rect><path d="m8 15 3-3 2 2 3-4 2 5"></path></svg>`,
    install: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"></path><path d="m7 10 5 5 5-5"></path><path d="M5 20h14"></path></svg>`,
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"></path></svg>`
  };

  function folderCount(folder) {
    const count = Number(folder?.media_count ?? folder?.mediaCount);
    if (Number.isFinite(count) && count >= 0) return count;
    return folderMedia(folder?.id).length;
  }

  function isCarouselSelected(item) {
    return Boolean(item?.included_in_carousel || state.carousel?.selected_ids?.includes(item?.id));
  }

  function selectedCarouselItems() {
    return state.media.filter(isCarouselSelected);
  }

  function selectedCarouselCount() {
    return selectedCarouselItems().length;
  }

  function carouselFolderId() {
    const preferred = state.carouselPickerFolderId || state.currentFolderId || state.folders[0]?.id || "all";
    if (preferred === "all" || state.folders.some((folder) => folder.id === preferred)) return preferred;
    return state.folders[0]?.id || "all";
  }

  function carouselFolderItems() {
    const folderId = carouselFolderId();
    if (folderId === "all") return state.media;
    return folderMedia(folderId);
  }

  function setCarouselNotice(message) {
    const notice = byId("carouselLimitNotice");
    if (notice) {
      notice.textContent = message || "";
      notice.classList.toggle("show", Boolean(message));
    }
    if (message) showAppToast(message);
    window.clearTimeout(carouselNoticeTimer);
    if (message && notice) {
      carouselNoticeTimer = window.setTimeout(() => {
        notice.textContent = "";
        notice.classList.remove("show");
      }, 2800);
    }
  }

  function showAppToast(message) {
    let toast = byId("appToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "appToast";
      toast.className = "app-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function renderModeControls() {
    byId("modeControls").innerHTML = [["all", "All Photos"], ["folders", "Folder Cycle"], ["selected", "Selected"]]
      .map(([id, label]) => `<button class="${state.carousel.mode === id ? "active" : ""}" data-mode="${id}" type="button">${label}</button>`)
      .join("");
  }

  function renderFolderCycleControls() {
    byId("folderCycleControls").hidden = state.carousel.mode !== "folders";
    byId("folderSourceList").innerHTML = state.folders.map((folder) => {
      const active = state.currentFolderId === folder.id ? "active" : "";
      return `<button class="${active}" data-source-folder="${folder.id}" type="button">${escapeHtml(folder.name)} <span>${folderCount(folder)}</span></button>`;
    }).join("");
  }

  function renderCarouselPicker() {
    const section = byId("selectedControls");
    const grid = byId("selectedPhotoGrid");
    if (!section || !grid) return;

    section.hidden = state.carousel.mode !== "selected";
    const selectedCount = selectedCarouselCount();
    const activeFolder = carouselFolderId();
    const limit = pickerVisibleLimits.get(activeFolder) || PICKER_PAGE_SIZE;
    const items = carouselFolderItems();
    const visibleItems = items.slice(0, limit);
    const hasMore = visibleItems.length < items.length;

    let filter = byId("carouselFolderPicker");
    if (!filter) {
      filter = document.createElement("div");
      filter.id = "carouselFolderPicker";
      filter.className = "carousel-picker-shell";
      section.insertBefore(filter, grid);
    }

    filter.innerHTML = `<div class="carousel-picker-summary">
      <div><strong>${selectedCount} / ${CAROUSEL_LIMIT} selected</strong><span>Selections stay saved while you switch folders.</span></div>
      <p id="carouselLimitNotice" class="carousel-limit-notice"></p>
    </div>
    <div class="carousel-folder-filter" aria-label="Filter carousel picker by folder">
      <button class="${activeFolder === "all" ? "active" : ""}" type="button" data-carousel-folder-filter="all">All <span>${state.media.length}</span></button>
      ${state.folders.map((folder) => `<button class="${activeFolder === folder.id ? "active" : ""}" type="button" data-carousel-folder-filter="${folder.id}">${escapeHtml(folder.name)} <span>${folderCount(folder)}</span></button>`).join("")}
    </div>`;

    if (!items.length) {
      grid.innerHTML = `<div class="carousel-picker-empty"><strong>No photos in this folder yet</strong><span>Choose another folder or import memories first.</span></div>`;
      return;
    }

    grid.classList.add("carousel-select-grid");
    grid.innerHTML = visibleItems.map((item) => {
      const selected = isCarouselSelected(item);
      const blocked = !selected && selectedCount >= CAROUSEL_LIMIT;
      return `<button class="select-card carousel-picker-card ${selected ? "selected" : ""} ${blocked ? "limit-blocked" : ""}" type="button" data-select-carousel="${item.id}" aria-label="${selected ? "Remove from" : "Add to"} carousel">
        <img src="${thumbUrl(item)}" alt="" loading="lazy" decoding="async">
        <span class="check-badge">${selected ? icons.check : "+"}</span>
      </button>`;
    }).join("") + (hasMore
      ? `<div class="carousel-picker-more"><button class="secondary-button" type="button" data-carousel-picker-more="${activeFolder}">Show more</button><span>Showing ${visibleItems.length} of ${items.length}</span></div>`
      : "");
  }

  function renderRotationPreviewLimited() {
    const preview = byId("rotationPreview");
    if (!preview) return;
    const items = getCarouselMedia();
    preview.innerHTML = items.map((item, index) => `<div class="preview-card"><img src="${thumbUrl(item)}" alt="" loading="lazy" decoding="async"><span class="preview-order">${index + 1}</span></div>`).join("") || `<div class="queue-empty compact">No carousel photos yet.</div>`;
  }

  const baseGetCarouselMedia = getCarouselMedia;
  getCarouselMedia = function getLimitedCarouselMedia(...args) {
    return (baseGetCarouselMedia.apply(this, args) || []).slice(0, CAROUSEL_LIMIT);
  };

  toggleCarouselItem = async function toggleCarouselItemWithLimit(id) {
    const item = mediaById(id);
    if (!item) return;
    const selected = isCarouselSelected(item);
    const count = selectedCarouselCount();
    if (!selected && count >= CAROUSEL_LIMIT) {
      setCarouselNotice(`Maximum of ${CAROUSEL_LIMIT} carousel images reached`);
      renderCarouselPicker();
      return;
    }
    await updateMedia(id, {
      included_in_carousel: !selected,
      carousel_order: selected ? item.carousel_order : item.carousel_order ?? count
    });
  };

  renderSettings = function renderSettingsWithCarouselPicker() {
    if (!byId("settingsDialog")) return;
    renderModeControls();
    renderFolderCycleControls();
    renderCarouselPicker();
    renderRotationPreviewLimited();
    byId("autoRotateInput").checked = state.carousel.playing;
    byId("showCaptionsInput").checked = state.prefs.showCaptions;
    byId("speedInput").value = state.prefs.speed;
    byId("speedValue").textContent = (state.prefs.speed / 1000).toFixed(1);
    byId("glowInput").value = state.prefs.glow;
    byId("glowValue").textContent = state.prefs.glow;
    decorateTopActions();
    updateInstallButton();
  };

  renderFolderDialog = function renderFolderDialogPaged(folderId) {
    const folder = folderById(folderId);
    const items = folderMedia(folderId);
    const limit = folderVisibleLimits.get(folderId) || FOLDER_PAGE_SIZE;
    const visibleItems = items.slice(0, limit);
    const hasMore = visibleItems.length < items.length;

    byId("folderTitle").textContent = folder?.name || "Folder";
    byId("folderSubtitle").textContent = `${items.length} ${items.length === 1 ? "memory" : "memories"}`;
    byId("batchBar").classList.toggle("show", state.selectedIds.size > 0);
    byId("batchCount").textContent = `${state.selectedIds.size} selected`;

    if (!items.length) {
      byId("mediaGrid").innerHTML = `<div class="empty-inline"><div><div class="empty-tulip"></div><h2>No memories here yet</h2><p>Import photos into this folder to start this chapter.</p></div></div>`;
      return;
    }

    byId("mediaGrid").innerHTML = visibleItems.map((item) => `<button class="media-card ${state.selectedIds.has(item.id) ? "selected" : ""}" type="button" data-media="${item.id}">
      <img src="${thumbUrl(item)}" alt="" loading="lazy" decoding="async">
      ${item.included_in_carousel ? `<span class="carousel-badge">*</span>` : ""}
      ${state.selectedIds.size ? `<span class="check-badge">${state.selectedIds.has(item.id) ? "OK" : "+"}</span>` : ""}
      <span class="media-copy">${escapeHtml(item.caption || "Add a caption")}</span>
    </button>`).join("") + (hasMore
      ? `<div class="folder-load-more-card"><button class="secondary-button" type="button" data-folder-load-more="${folderId}">Show more</button><span>Showing ${visibleItems.length} of ${items.length}</span></div>`
      : "");
  };

  function ensureSplashLayer() {
    const section = byId("heroStage")?.closest(".hero-section");
    if (!section) return null;
    let layer = byId("carouselSplashLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "carouselSplashLayer";
      layer.className = "carousel-splash-layer";
      layer.setAttribute("aria-hidden", "true");
      section.insertBefore(layer, byId("heroStage"));
    }
    return layer;
  }

  function triggerCarouselSplash() {
    if (document.body.dataset.motionReduced === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const layer = ensureSplashLayer();
    const stage = byId("heroStage");
    if (!layer || !stage || !getCarouselMedia().length) return;
    const colors = ["#caa8ff", "#a66cff", "#ff8ed0", "#71d8ff", "#ffb36a"];
    const edgePoints = [
      { x: -4, y: 18 }, { x: 103, y: 28 }, { x: 6, y: 103 }, { x: 92, y: -3 }, { x: 102, y: 82 }
    ];
    const count = 4 + Math.floor(Math.random() * 3);
    for (let index = 0; index < count; index += 1) {
      const point = edgePoints[(index + Math.floor(Math.random() * edgePoints.length)) % edgePoints.length];
      const splash = document.createElement("span");
      splash.className = "carousel-splash";
      splash.style.setProperty("--x", `${point.x + (Math.random() * 10 - 5)}%`);
      splash.style.setProperty("--y", `${point.y + (Math.random() * 10 - 5)}%`);
      splash.style.setProperty("--splash-color", colors[index % colors.length]);
      splash.style.setProperty("--splash-size", `${50 + Math.random() * 58}px`);
      splash.style.setProperty("--splash-delay", `${index * 36}ms`);
      layer.appendChild(splash);
      window.setTimeout(() => splash.remove(), 920);
    }
  }

  const baseChangeCarousel = changeCarousel;
  changeCarousel = function changeCarouselWithSplash(...args) {
    triggerCarouselSplash();
    return baseChangeCarousel.apply(this, args);
  };

  function decorateTopActions() {
    const importButton = byId("importButton");
    const settingsButton = byId("settingsButton");
    const installButton = byId("installBtn");
    if (importButton && !importButton.dataset.upgraded) {
      importButton.dataset.upgraded = "true";
      importButton.innerHTML = `${icons.import}<span>Import</span>`;
      importButton.title = "Import photos";
      importButton.setAttribute("aria-label", "Import photos");
    }
    if (settingsButton) {
      settingsButton.classList.add("carousel-action-button");
      settingsButton.innerHTML = icons.gallery;
      settingsButton.title = "Carousel controls";
      settingsButton.setAttribute("aria-label", "Carousel controls");
    }
    if (installButton) {
      installButton.classList.add("install-action");
      installButton.innerHTML = `${icons.install}<span>Install</span>`;
      installButton.title = "Install app";
      installButton.setAttribute("aria-label", "Install app");
    }
  }

  function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function updateInstallButton() {
    const button = byId("installBtn");
    if (!button) return;
    const installed = isStandalone();
    button.hidden = installed;
    button.classList.toggle("install-ready", Boolean(deferredInstallPrompt));
    button.classList.toggle("install-unavailable", !deferredInstallPrompt && !installed);
    button.setAttribute("aria-disabled", deferredInstallPrompt || installed ? "false" : "true");
    button.title = deferredInstallPrompt ? "Install app" : "Install may appear after the app finishes loading";
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallButton();
    showAppToast("App installed");
  });

  document.addEventListener("click", async (event) => {
    const filter = event.target.closest("[data-carousel-folder-filter]");
    if (filter) {
      event.preventDefault();
      state.carouselPickerFolderId = filter.dataset.carouselFolderFilter;
      if (!pickerVisibleLimits.has(state.carouselPickerFolderId)) pickerVisibleLimits.set(state.carouselPickerFolderId, PICKER_PAGE_SIZE);
      renderCarouselPicker();
      return;
    }

    const morePicker = event.target.closest("[data-carousel-picker-more]");
    if (morePicker) {
      event.preventDefault();
      const folderId = morePicker.dataset.carouselPickerMore;
      pickerVisibleLimits.set(folderId, (pickerVisibleLimits.get(folderId) || PICKER_PAGE_SIZE) + PICKER_PAGE_SIZE);
      renderCarouselPicker();
      return;
    }

    const moreFolder = event.target.closest("[data-folder-load-more]");
    if (moreFolder) {
      event.preventDefault();
      event.stopPropagation();
      const folderId = moreFolder.dataset.folderLoadMore;
      folderVisibleLimits.set(folderId, (folderVisibleLimits.get(folderId) || FOLDER_PAGE_SIZE) + FOLDER_PAGE_SIZE);
      renderFolderDialog(folderId);
    }
  });

  byId("installBtn")?.addEventListener("click", async (event) => {
    if (!deferredInstallPrompt) {
      if (!isStandalone()) showAppToast("Install will appear when your browser allows it. On iPhone, use Share then Add to Home Screen.");
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    updateInstallButton();
  }, true);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateInstallButton();
  });

  const baseRenderAll = renderAll;
  renderAll = function renderAllWithUpgrades(...args) {
    const result = baseRenderAll.apply(this, args);
    window.setTimeout(() => {
      decorateTopActions();
      updateInstallButton();
    }, 0);
    return result;
  };

  window.setTimeout(() => {
    decorateTopActions();
    updateInstallButton();
  }, 200);
})();
