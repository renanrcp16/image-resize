import type { Format } from "./types";

/**
 * Picks the desired output MIME based on selected format.
 * - "keep": preserves input MIME
 */
export function pickOutputMime(inputMime: string, format: Format): string {
  if (format === "keep") return inputMime;
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return inputMime;
}

/**
 * Tests whether the current browser can encode a canvas to the given MIME.
 * Some browsers may not support WebP encoding, for example.
 */
export async function isMimeSupportedByCanvas(mime: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  ctx.fillRect(0, 0, 1, 1);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), mime)
  );

  return !!blob;
}
