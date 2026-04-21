import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
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

app.use("/api", mediaRoutes);
app.use("/api", photosRoutes);
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
