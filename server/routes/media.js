import express from "express";
import multer from "multer";
import { compressImage } from "../services/compression.js";
import { deleteObject, getObject, mediaKey, uploadObject } from "../services/r2.js";
import { supabase } from "../services/supabase.js";

const router = express.Router();
const UPLOAD_TIMEOUT_MS = 180000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) return callback(null, false);
    callback(null, true);
  }
});

const userId = () => process.env.APP_USER_ID || "anniversary";

function singleImageUpload(req, res, next) {
  req.setTimeout(UPLOAD_TIMEOUT_MS);
  res.setTimeout(UPLOAD_TIMEOUT_MS);
  upload.any()(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_COUNT: "Upload one image per request. The app queue will continue with the next file.",
        LIMIT_FILE_SIZE: "That image is too large for one request. Try a smaller export or screenshot.",
        LIMIT_UNEXPECTED_FILE: "Unexpected upload field. Please refresh the app and retry."
      };
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ ok: false, code: error.code, error: messages[error.code] || error.message });
    }
    next(error);
  });
}

async function ensureFolder(folderId, name = "Memories") {
  const { data, error } = await supabase
    .from("folders")
    .upsert({ id: folderId, user_id: userId(), name }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findMediaItem(id) {
  const { data, error } = await supabase
    .from("media_items")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId())
    .single();
  if (error) throw error;
  return data;
}

function streamR2Object(res, object, fallbackType) {
  res.setHeader("Content-Type", object.ContentType || fallbackType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  if (object.ContentLength) res.setHeader("Content-Length", object.ContentLength);
  if (object.Body?.pipe) return object.Body.pipe(res);
  return res.end(object.Body);
}

function withApiMediaUrls(item) {
  return {
    ...item,
    r2_url: item.url,
    r2_thumbnail_url: item.thumbnail_url,
    url: `/api/media/${item.id}/content`,
    thumbnail_url: `/api/media/${item.id}/thumbnail`
  };
}

router.get("/media", async (_req, res, next) => {
  try {
    const [{ data: folders, error: folderError }, { data: media, error: mediaError }, { data: carousel, error: carouselError }] = await Promise.all([
      supabase.from("folders").select("*").eq("user_id", userId()).order("created_at", { ascending: true }),
      supabase.from("media_items").select("*").eq("user_id", userId()).order("created_at", { ascending: false }),
      supabase.from("carousel_settings").select("*").eq("user_id", userId()).order("updated_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (folderError) throw folderError;
    if (mediaError) throw mediaError;
    if (carouselError) throw carouselError;
    res.json({ folders, media: (media || []).map(withApiMediaUrls), carousel });
  } catch (error) {
    next(error);
  }
});

router.get("/media/:id/content", async (req, res, next) => {
  try {
    const item = await findMediaItem(req.params.id);
    const object = await getObject(item.storage_key);
    streamR2Object(res, object, "image/jpeg");
  } catch (error) {
    next(error);
  }
});

router.get("/media/:id/thumbnail", async (req, res, next) => {
  try {
    const item = await findMediaItem(req.params.id);
    const key = item.thumbnail_storage_key || item.storage_key;
    const object = await getObject(key);
    streamR2Object(res, object, "image/jpeg");
  } catch (error) {
    next(error);
  }
});

router.post("/folders", async (req, res, next) => {
  try {
    const name = String(req.body.name || "New Folder").trim().slice(0, 80);
    const { data, error } = await supabase
      .from("folders")
      .insert({ user_id: userId(), name })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.patch("/folders/:id", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "Folder name is required." });
    const { data, error } = await supabase
      .from("folders")
      .update({ name })
      .eq("id", req.params.id)
      .eq("user_id", userId())
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.patch("/folders/:id/rotation", async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.mediaIds) ? req.body.mediaIds.slice(0, 5).filter(Boolean) : [];
    if (ids.length) {
      const { data: validMedia, error: validError } = await supabase
        .from("media_items")
        .select("id")
        .eq("user_id", userId())
        .eq("folder_id", req.params.id)
        .in("id", ids);
      if (validError) throw validError;
      const validIds = new Set((validMedia || []).map((item) => item.id));
      const invalid = ids.filter((id) => !validIds.has(id));
      if (invalid.length) return res.status(400).json({ error: "Rotation images must belong to this folder." });
    }
    const { data, error } = await supabase
      .from("folders")
      .update({ rotation_media_ids: ids })
      .eq("id", req.params.id)
      .eq("user_id", userId())
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/upload", singleImageUpload, async (req, res, next) => {
  try {
    const folderId = req.body.folderId || "default";
    await ensureFolder(folderId, req.body.folderName || "Memories");

    const file = (req.files || []).find((item) => item.mimetype.startsWith("image/"));
    if (!file) return res.status(400).json({ ok: false, code: "NO_IMAGE", error: "No image file was provided." });

    const compressed = await compressImage(file);
    const key = mediaKey({ userId: userId(), folderId, fileName: file.originalname });
    const thumbnailKey = key.replace(/(\.[^.]+)?$/, "-thumb.jpg");
    const [url, thumbnailUrl] = await Promise.all([
      uploadObject({ key, body: compressed.main, contentType: compressed.contentType }),
      uploadObject({ key: thumbnailKey, body: compressed.thumbnail, contentType: compressed.thumbnailContentType })
    ]);

    const metadata = {
      ...compressed.metadata,
      queueItemId: req.body.queueItemId || null,
      fileHash: req.body.fileHash || null,
      duplicateSignature: req.body.duplicateSignature || null,
      originalLastModified: req.body.originalLastModified ? Number(req.body.originalLastModified) : null,
      originalWidth: req.body.originalWidth ? Number(req.body.originalWidth) : compressed.metadata.width,
      originalHeight: req.body.originalHeight ? Number(req.body.originalHeight) : compressed.metadata.height,
      duplicateAction: req.body.duplicateAction || null
    };

    const { data, error } = await supabase
      .from("media_items")
      .insert({
        user_id: userId(),
        folder_id: folderId,
        storage_key: key,
        thumbnail_storage_key: thumbnailKey,
        url,
        thumbnail_url: thumbnailUrl,
        caption: req.body.caption || null,
        author: req.body.author || null,
        metadata
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ ok: true, queueItemId: req.body.queueItemId || null, media: [withApiMediaUrls(data)] });
  } catch (error) {
    next(error);
  }
});

router.patch("/media/:id", async (req, res, next) => {
  try {
    const updates = {};
    for (const key of ["caption", "author", "included_in_carousel", "carousel_order"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) updates[key] = req.body[key];
    }
    const { data, error } = await supabase
      .from("media_items")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", userId())
      .select()
      .single();
    if (error) throw error;
    res.json(withApiMediaUrls(data));
  } catch (error) {
    next(error);
  }
});

router.delete("/media/:id", async (req, res, next) => {
  try {
    const item = await findMediaItem(req.params.id);
    await Promise.all([deleteObject(item.storage_key), deleteObject(item.thumbnail_storage_key)]);
    const { error } = await supabase.from("media_items").delete().eq("id", req.params.id).eq("user_id", userId());
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/move", async (req, res, next) => {
  try {
    const { mediaIds, folderId, folderName } = req.body;
    if (!Array.isArray(mediaIds) || !folderId) return res.status(400).json({ error: "mediaIds and folderId are required." });
    await ensureFolder(folderId, folderName || "Memories");
    const { data, error } = await supabase
      .from("media_items")
      .update({ folder_id: folderId })
      .in("id", mediaIds)
      .eq("user_id", userId())
      .select();
    if (error) throw error;
    res.json({ media: (data || []).map(withApiMediaUrls) });
  } catch (error) {
    next(error);
  }
});

router.post("/carousel", async (req, res, next) => {
  try {
    const { mode = "all", selectedIds = [], playing = true } = req.body;
    const { data, error } = await supabase
      .from("carousel_settings")
      .upsert({ user_id: userId(), mode, selected_ids: selectedIds, playing }, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
