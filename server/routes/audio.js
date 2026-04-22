import express from "express";
import multer from "multer";
import { deleteObject, getObject, mediaKey, uploadObject } from "../services/r2.js";
import { supabase } from "../services/supabase.js";

const router = express.Router();
const AUDIO_TIMEOUT_MS = 180000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith("audio/")) return callback(null, false);
    callback(null, true);
  }
});

const userId = () => process.env.APP_USER_ID || "anniversary";

function singleAudioUpload(req, res, next) {
  req.setTimeout(AUDIO_TIMEOUT_MS);
  res.setTimeout(AUDIO_TIMEOUT_MS);
  upload.any()(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ ok: false, code: error.code, error: error.message });
    }
    next(error);
  });
}

function withAudioUrl(item) {
  return {
    ...item,
    r2_url: item.url,
    url: `/api/audio/${item.id}/stream`
  };
}

async function findAudioItem(id) {
  const { data, error } = await supabase
    .from("audio_items")
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

router.get("/audio", async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("audio_items")
      .select("*")
      .eq("user_id", userId())
      .order("created_at", { ascending: true });
    if (error) {
      if (error.code === "42P01") return res.json({ audio: [], setupRequired: true });
      throw error;
    }
    res.json({ audio: (data || []).map(withAudioUrl) });
  } catch (error) {
    next(error);
  }
});

router.get("/audio/:id/stream", async (req, res, next) => {
  try {
    const item = await findAudioItem(req.params.id);
    const object = await getObject(item.storage_key);
    streamR2Object(res, object, item.content_type || "audio/mpeg");
  } catch (error) {
    next(error);
  }
});

router.post("/audio/upload", singleAudioUpload, async (req, res, next) => {
  try {
    const file = (req.files || []).find((item) => item.mimetype.startsWith("audio/"));
    if (!file) return res.status(400).json({ ok: false, code: "NO_AUDIO", error: "No audio file was provided." });

    const key = mediaKey({ userId: userId(), folderId: "audio", fileName: file.originalname });
    const url = await uploadObject({ key, body: file.buffer, contentType: file.mimetype });
    const title = String(req.body.title || file.originalname || "Background song").replace(/\.[^.]+$/, "").slice(0, 120);

    const { data, error } = await supabase
      .from("audio_items")
      .insert({
        user_id: userId(),
        storage_key: key,
        url,
        title,
        file_name: file.originalname,
        content_type: file.mimetype,
        size: file.size,
        active: false,
        metadata: { originalName: file.originalname, size: file.size }
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ ok: true, audio: withAudioUrl(data) });
  } catch (error) {
    next(error);
  }
});

router.patch("/audio/:id", async (req, res, next) => {
  try {
    const updates = {};
    for (const key of ["title", "active", "playlist_order"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) updates[key] = req.body[key];
    }
    const { data, error } = await supabase
      .from("audio_items")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", userId())
      .select()
      .single();
    if (error) throw error;
    res.json(withAudioUrl(data));
  } catch (error) {
    next(error);
  }
});

router.delete("/audio/:id", async (req, res, next) => {
  try {
    const item = await findAudioItem(req.params.id);
    await deleteObject(item.storage_key);
    const { error } = await supabase.from("audio_items").delete().eq("id", req.params.id).eq("user_id", userId());
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
