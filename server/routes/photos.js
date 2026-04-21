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

function requireGoogleEnv() {
  const required = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    const err = new Error(`Missing Google OAuth env vars: ${missing.join(", ")}`);
    err.status = 500;
    throw err;
  }
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
    const { accessToken, sessionId, mediaItems: postedItems, folderId = "google-photos", folderName = "Google Photos" } = req.body;
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

    await supabase.from("folders").upsert({ id: folderId, user_id: userId(), name: folderName }, { onConflict: "id" });
    const imported = [];
    for (const item of mediaItems) {
      const baseUrl = item.baseUrl || item.mediaFile?.baseUrl;
      if (!baseUrl) continue;
      const photoRes = await fetch(`${baseUrl}=w2200-h2200`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!photoRes.ok) continue;
      const buffer = Buffer.from(await photoRes.arrayBuffer());
      const file = {
        buffer,
        size: buffer.length,
        mimetype: photoRes.headers.get("content-type") || "image/jpeg",
        originalname: `${item.id || randomUUID()}.jpg`
      };
      const compressed = await compressImage(file);
      const key = mediaKey({ userId: userId(), folderId, fileName: file.originalname });
      const thumbnailKey = key.replace(/(\.[^.]+)?$/, "-thumb.jpg");
      const [url, thumbnailUrl] = await Promise.all([
        uploadObject({ key, body: compressed.main, contentType: compressed.contentType }),
        uploadObject({ key: thumbnailKey, body: compressed.thumbnail, contentType: "image/jpeg" })
      ]);
      const { data, error } = await supabase
        .from("media_items")
        .insert({
          user_id: userId(),
          folder_id: folderId,
          storage_key: key,
          thumbnail_storage_key: thumbnailKey,
          url,
          thumbnail_url: thumbnailUrl,
          caption: item.description || null,
          metadata: { ...compressed.metadata, googlePhotosId: item.id }
        })
        .select()
        .single();
      if (error) throw error;
      imported.push(data);
    }
    res.status(201).json({ media: imported });
  } catch (error) {
    next(error);
  }
});

export default router;
