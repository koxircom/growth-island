import sharp from "sharp";
import { HttpError } from "./http";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export async function normalizePhoto(input: Buffer) {
 if (!input.length || input.length > MAX_PHOTO_BYTES) throw new HttpError(413,"photo_too_large");
 try {
  const source=sharp(input,{limitInputPixels:24000000,failOn:"warning"});
  const meta=await source.metadata();
  if(!["jpeg","png","webp"].includes(meta.format||"") || (meta.pages||1)>1) throw new Error();
  // Re-encoding removes EXIF/GPS and never keeps active content or the original file name.
  return await source.rotate().resize(512,512,{fit:"cover"}).webp({quality:85}).toBuffer();
 } catch {throw new HttpError(400,"invalid_photo");}
}
