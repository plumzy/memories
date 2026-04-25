import "dotenv/config";
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import audioRoutes from "./routes/audio.js";
import mediaRoutes from "./routes/media.js";
import photosRoutes from "./routes/photos.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!process.env.APP_PASSPHRASE) return next();
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: "Authentication required." });
}

app.get("/api/auth/status", (req, res) => {
  const hasPassphrase = !!process.env.APP_PASSPHRASE;
  res.json({ authenticated: !hasPassphrase || !!req.session?.authenticated });
});

app.post("/api/auth/login", (req, res) => {
  const passphrase = process.env.APP_PASSPHRASE;
  if (!passphrase) return res.json({ ok: true });
  if (req.body.passphrase === passphrase) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: "Incorrect passphrase." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.use("/api", requireAuth, mediaRoutes);
app.use("/api", requireAuth, photosRoutes);
app.use("/api", requireAuth, audioRoutes);
app.use(express.static(root, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("*", (_req, res) => {
  res.sendFile(path.join(root, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Unexpected server error." });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Memories app listening on ${port}`);
});
