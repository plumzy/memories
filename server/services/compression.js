import sharp from "sharp";

export async function compressImage(file) {
  const image = sharp(file.buffer, { failOn: "none" }).rotate();
  const metadata = await image.metadata();
  const format = metadata.format === "png" ? "png" : "jpeg";
  const outputType = format === "png" ? "image/png" : "image/jpeg";

  const main = format === "png"
    ? await image.clone().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).png({ quality: 68, compressionLevel: 9 }).toBuffer()
    : await image.clone().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 68, mozjpeg: true }).toBuffer();

  const thumbnail = await image.clone()
    .resize(520, 520, { fit: "cover" })
    .jpeg({ quality: 66, mozjpeg: true })
    .toBuffer();

  return {
    main,
    thumbnail,
    contentType: outputType,
    thumbnailContentType: "image/jpeg",
    metadata: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: file.size,
      originalName: file.originalname
    }
  };
}
