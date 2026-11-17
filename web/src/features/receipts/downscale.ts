// Phone photos are 3-12 MB. A receipt reads fine at about 1600px on the long
// edge, so the photo is redrawn on a canvas at that size as a JPEG before it
// is uploaded: a few hundred KB instead of megabytes.

export const LONG_EDGE = 1600;

export async function downscaleImage(file: Blob, longEdge = LONG_EDGE, quality = 0.85): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // browsers apply the photo's EXIF rotation here
    const scale = Math.min(1, longEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
