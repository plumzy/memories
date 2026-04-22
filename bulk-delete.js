(() => {
  deleteIds = async function deleteIdsWithBulkEndpoint(ids) {
    const mediaIds = [...new Set((Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!mediaIds.length) return;
    if (!confirm(`Delete ${mediaIds.length} selected memory item(s)?`)) return;

    const result = await api("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaIds })
    });

    const deletedIds = new Set((result.deleted || []).map((item) => item.id));
    mediaIds.forEach((id) => state.selectedIds.delete(id));
    state.media = state.media.filter((item) => !deletedIds.has(item.id));

    if (byId("viewerDialog")?.open && deletedIds.has(state.viewerIds[state.viewerIndex])) {
      byId("viewerDialog").close();
    }

    await loadData();

    if (byId("folderDialog")?.open && state.currentFolderId) {
      renderFolderDialog(state.currentFolderId);
    }
  };
})();
