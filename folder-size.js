(() => {
  function mediaStoredBytes(item) {
    const metadata = item?.metadata || {};
    for (const key of ["storedSize", "storageSize", "compressedSize", "mainStoredSize"]) {
      const value = Number(metadata[key] || 0);
      if (value > 0) return value;
    }
    return Number(metadata.size || 0);
  }

  function folderStorageBytes(folderId) {
    return folderMedia(folderId).reduce((total, item) => total + mediaStoredBytes(item), 0);
  }

  function folderStorageLabel(bytes) {
    return `${(Math.max(0, bytes) / 1024 / 1024).toFixed(1)} MB`;
  }

  function folderMemoryLabel(count) {
    return `${count} ${count === 1 ? "memory" : "memories"}`;
  }

  const baseRenderFolderDialog = renderFolderDialog;
  renderFolderDialog = function renderFolderDialogWithStorageSize(folderId) {
    baseRenderFolderDialog(folderId);
    const subtitle = byId("folderSubtitle");
    if (!subtitle) return;
    const items = folderMedia(folderId);
    subtitle.innerHTML = `<span>${folderMemoryLabel(items.length)}</span><span class="folder-size-pill">${folderStorageLabel(folderStorageBytes(folderId))}</span>`;
  };

  if (byId("folderDialog")?.open && state.currentFolderId) renderFolderDialog(state.currentFolderId);
})();
