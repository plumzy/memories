import express from "express";
import { randomUUID } from "crypto";
import { compressImage } from "../services/compression.js";
import { mediaKey, uploadObject } from "../services/r2.js";
import { supabase } from "../services/supabase.js";

const router = express.Router();
const userId = () => process.env.APP_USER_ID || "anniversary";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const PICKER_API = "https://photospicker.googleapis.com/v1";
const PICKER_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const DUPLICATE_FOLDER_NAME = "DUPLICATE UPLOADS";

function requireGoogleEnv() {
  const required = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    const err = new Error(`Missing Google OAuth env vars: ${missing.join(", ")}`);
    err.status = 500;
    throw err;
  }
}

async function ensureFolder(folderId, name) {
  const { data, error } = await supabase
    .from("folders")
    .upsert({ id: folderId, user_id: userId(), name }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function ensureDuplicateFolder() {
  const { data: existing, error: findError } = await supabase
    .from("folders")
    .select("*")
    .eq("user_id", userId())
    .eq("name", DUPLICATE_FOLDER_NAME)
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  const { data, error } = await supabase
    .from("folders")
    .insert({ user_id: userId(), name: DUPLICATE_FOLDER_NAME })
    .select()
    .single();
  if (error) throw error;
  return data;
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

router.post("/google-photos/session", async (req, res, next) => {
  try {
    requireGoogleEnv();
    if (req.body.accessToken) {
      const pickerRes = await fetch(`${PICKER_API}/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.body.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      if (!pickerRes.ok) throw new Error(`Google Photos Picker session failed: ${await pickerRes.text()}`);
      const session = await pickerRes.json();
      return res.json(session);
    }

    const state = Buffer.from(JSON.stringify({
      nonce: randomUUID(),
      folderId: req.body.folderId || "google-photos",
      folderName: req.body.folderName || "Google Photos"
    })).toString("base64url");

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: PICKER_SCOPE,
      state
    });
    res.json({ authUrl: `${GOOGLE_AUTH}?${params.toString()}` });
  } catch (error) {
    next(error);
  }
});

router.get("/google-photos/callback", async (req, res, next) => {
  try {
    requireGoogleEnv();
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing Google authorization code.");

    const response = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code"
      })
    });
    if (!response.ok) throw new Error(`Google token exchange failed: ${await response.text()}`);
    const token = await response.json();
    const state = req.query.state || "";
    res.send(`<!doctype html><script>
      window.opener && window.opener.postMessage(${JSON.stringify({ type: "GOOGLE_PHOTOS_TOKEN" })}, "*");
      window.opener && window.opener.postMessage({ type: "GOOGLE_PHOTOS_TOKEN_VALUE", accessToken: ${JSON.stringify(token.access_token)}, state: ${JSON.stringify(state)} }, "*");
      window.close();
    </script><p>Google Photos connected. You can close this tab.</p>`);
  } catch (error) {
    next(error);
  }
});

router.post("/google-photos/import", async (req, res, next) => {
  try {
    const {
      accessToken,
      sessionId,
      mediaItems: postedItems,
      folderId = "google-photos",
      folderName = "Google Photos",
      duplicateAction,
      duplicateIdsToImport = []
    } = req.body;
    if (!accessToken) return res.status(400).json({ error: "accessToken is required." });

    let mediaItems = postedItems;
    if (sessionId) {
      const itemsRes = await fetch(`${PICKER_API}/mediaItems?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!itemsRes.ok) throw new Error(`Google Photos media item fetch failed: ${await itemsRes.text()}`);
      const payload = await itemsRes.json();
      mediaItems = payload.mediaItems || [];
    }
    if (!Array.isArray(mediaItems)) return res.status(400).json({ error: "sessionId or mediaItems is required." });

    const { data: existingMedia, error: existingError } = await supabase
      .from("media_items")
      .select("id, folder_id, metadata")
      .eq("user_id", userId());
    if (existingError) throw existingError;
    const existingGoogleIds = new Set((existingMedia || []).map((item) => item.metadata?.googlePhotosId).filter(Boolean));
    const duplicates = mediaItems.filter((item) => item.id && existingGoogleIds.has(item.id));
    const reviewedDuplicateIds = new Set(Array.isArray(duplicateIdsToImport) ? duplicateIdsToImport : []);

    if (duplicates.length && !duplicateAction) {
      return res.status(409).json({
        code: "DUPLICATES_FOUND",
        error: "Some Google Photos selections already exist.",
        duplicates: duplicates.map((item) => ({ id: item.id, fileName: item.filename || `${item.id}.jpg` }))
      });
    }

    await ensureFolder(folderId, folderName);
    const duplicateFolder = duplicateAction === "duplicates" || (duplicateAction === "review" && reviewedDuplicateIds.size)
      ? await ensureDuplicateFolder()
      : null;
    const imported = [];
    const skipped = [];

    for (const item of mediaItems) {
      const isDuplicate = item.id && existingGoogleIds.has(item.id);
      if (isDuplicate && duplicateAction === "skip") {
        skipped.push(item.id);
        continue;
      }
      if (isDuplicate && duplicateAction === "review" && !reviewedDuplicateIds.has(item.id)) {
        skipped.push(item.id);
        continue;
      }
      const sendToDuplicateFolder = isDuplicate && duplicateFolder && (duplicateAction === "duplicates" || reviewedDuplicateIds.has(item.id));
      const targetFolderId = sendToDuplicateFolder ? duplicateFolder.id : folderId;
      const targetFolderName = sendToDuplicateFolder ? duplicateFolder.name : folderName;
      await ensureFolder(targetFolderId, targetFolderName);

      const baseUrl = item.baseUrl || item.mediaFile?.baseUrl;
      if (!baseUrl) continue;
      const photoRes = await fetch(`${baseUrl}=w2200-h2200`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!photoRes.ok) continue;
      const buffer = Buffer.from(await photoRes.arrayBuffer());
      const file = {
        buffer,
        size: buffer.length,
        mimetype: photoRes.headers.get("content-type") || "image/jpeg",
        originalname: item.filename || `${item.id || randomUUID()}.jpg`
      };
      const compressed = await compressImage(file);
      const key = mediaKey({ userId: userId(), folderId: targetFolderId, fileName: file.originalname });
      const thumbnailKey = key.replace(/(\.[^.]+)?$/, "-thumb.jpg");
      const [url, thumbnailUrl] = await Promise.all([
        uploadObject({ key, body: compressed.main, contentType: compressed.contentType }),
        uploadObject({ key: thumbnailKey, body: compressed.thumbnail, contentType: "image/jpeg" })
      ]);
      const { data, error } = await supabase
        .from("media_items")
        .insert({
          user_id: userId(),
          folder_id: targetFolderId,
          storage_key: key,
          thumbnail_storage_key: thumbnailKey,
          url,
          thumbnail_url: thumbnailUrl,
          caption: item.description || null,
          metadata: {
            ...compressed.metadata,
            googlePhotosId: item.id,
            duplicateAction: sendToDuplicateFolder ? "duplicates" : isDuplicate ? duplicateAction : null
          }
        })
        .select()
        .single();
      if (error) throw error;
      imported.push(withApiMediaUrls(data));
    }
    res.status(201).json({ media: imported, duplicates: duplicates.map((item) => item.id), skipped });
  } catch (error) {
    next(error);
  }
});

export default router;
