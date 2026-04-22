import sharp from "sharp";

export const IMAGE_COMPRESSION_QUALITY = 63;
export const THUMBNAIL_COMPRESSION_QUALITY = 48;

export async function compressImage(file) {
  const image = sharp(file.buffer, { failOn: "none" }).rotate();
  const metadata = await image.metadata();
  const format = metadata.format === "png" ? "png" : "jpeg";
  const outputType = format === "png" ? "image/png" : "image/jpeg";

  const main = format === "png"
    ? await image.clone().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).png({ quality: IMAGE_COMPRESSION_QUALITY, compressionLevel: 9 }).toBuffer()
    : await image.clone().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: IMAGE_COMPRESSION_QUALITY, mozjpeg: true }).toBuffer();

  const thumbnail = await image.clone()
    .resize(520, 520, { fit: "cover" })
    .jpeg({ quality: THUMBNAIL_COMPRESSION_QUALITY, mozjpeg: true })
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
      storedSize: main.length,
      thumbnailStoredSize: thumbnail.length,
      compressionQuality: IMAGE_COMPRESSION_QUALITY,
      thumbnailCompressionQuality: THUMBNAIL_COMPRESSION_QUALITY,
      originalName: file.originalname
    }
  };
}
