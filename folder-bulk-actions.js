(() => {
  function currentFolderIds() {
    return folderMedia(state.currentFolderId).map((item) => item.id);
  }

  function selectedInCurrentFolderCount() {
    const ids = new Set(currentFolderIds());
    return [...state.selectedIds].filter((id) => ids.has(id)).length;
  }

  function setBulkSelectionMode(active) {
    state.bulkSelectionMode = active;
    if (!active) state.selectedIds.clear();
    if (state.currentFolderId) renderFolderDialog(state.currentFolderId);
  }

  function selectAllCurrentFolder() {
    state.bulkSelectionMode = true;
    currentFolderIds().forEach((id) => state.selectedIds.add(id));
    renderFolderDialog(state.currentFolderId);
  }

  function renderBulkToolbar(folderId) {
    const batchBar = byId("batchBar");
    if (!batchBar) return;
    const items = folderMedia(folderId);
    let toolbar = byId("bulkSelectToolbar");
    if (!toolbar) {
      toolbar = document.createElement("section");
      toolbar.id = "bulkSelectToolbar";
      toolbar.className = "bulk-select-toolbar";
      batchBar.parentNode.insertBefore(toolbar, batchBar);
    }

    if (!items.length) {
      toolbar.hidden = true;
      return;
    }

    const selectedCount = selectedInCurrentFolderCount();
    const allSelected = selectedCount === items.length;
    toolbar.hidden = false;
    toolbar.innerHTML = `<div class="bulk-select-copy">
      <strong>Bulk actions</strong>
      <span>${selectedCount ? `${selectedCount} selected` : "Select photos to move or delete together."}</span>
    </div>
    <div class="bulk-select-actions">
      <button class="secondary-button ${state.bulkSelectionMode ? "active" : ""}" type="button" data-bulk-select-mode>${state.bulkSelectionMode ? "Selecting" : "Select"}</button>
      <button class="secondary-button" type="button" data-bulk-select-all>${allSelected ? "All selected" : "Select all"}</button>
      <button class="secondary-button" type="button" data-bulk-clear ${selectedCount ? "" : "disabled"}>Clear</button>
    </div>`;

    batchBar.classList.toggle("show", selectedCount > 0);
    byId("batchCount").textContent = `${selectedCount} selected`;
  }

  const baseRenderFolderDialog = renderFolderDialog;
  renderFolderDialog = function renderFolderDialogWithBulkActions(folderId) {
    baseRenderFolderDialog(folderId);
    if (!state.bulkSelectionMode && state.selectedIds.size) state.bulkSelectionMode = true;
    renderBulkToolbar(folderId);
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bulk-select-mode], [data-bulk-select-all], [data-bulk-clear]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    if (button.matches("[data-bulk-select-mode]")) {
      state.bulkSelectionMode = !state.bulkSelectionMode;
      renderFolderDialog(state.currentFolderId);
      return;
    }

    if (button.matches("[data-bulk-select-all]")) {
      selectAllCurrentFolder();
      return;
    }

    if (button.matches("[data-bulk-clear]")) {
      setBulkSelectionMode(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (!state.bulkSelectionMode) return;
    const card = event.target.closest("#mediaGrid [data-media]");
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    toggleSelected(card.dataset.media);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!byId("folderDialog")?.open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAllCurrentFolder();
    }
    if (event.key === "Escape" && state.bulkSelectionMode) {
      setBulkSelectionMode(false);
    }
  });

  if (byId("folderDialog")?.open && state.currentFolderId) renderFolderDialog(state.currentFolderId);
})();
