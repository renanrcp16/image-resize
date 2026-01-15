import type { Format, Mode } from "./types";
import { isMimeSupportedByCanvas, pickOutputMime } from "./canvas";
import {
  baseNameOf,
  extFromMime,
  makeId,
  mapQuality01,
  humanFileSize,
} from "./utils";

/**
 * Background is not user-configurable.
 * White is used when needed (JPEG output or pad mode).
 */
const WHITE_BG = "#ffffff";

/**
 * Describes the rectangle we take from the source (sx/sy/sw/sh)
 * and where we draw it in the output (dx/dy/dw/dh).
 */
type DrawParams = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

type TargetSizeResult = {
  outW: number;
  outH: number;
  draw: DrawParams;
};

/**
 * Computes output size and draw params based on resize mode.
 * - If targetH is null -> output is width-based with preserved aspect ratio.
 * - "inside" -> fits within the box without cropping; output may not match both dims exactly.
 * - "cover" -> crops to exactly match targetW x targetH.
 * - "pad"   -> output exactly matches targetW x targetH and centers the fitted image on white background.
 * - "fill"  -> stretches to exactly match targetW x targetH (distorts).
 */
export function computeTargetSize(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number | null,
  mode: Mode
): TargetSizeResult {
  // Width-only: preserve aspect ratio based on width
  if (targetH === null) {
    const h = Math.max(1, Math.round((targetW * srcH) / srcW));
    return {
      outW: targetW,
      outH: h,
      draw: {
        sx: 0,
        sy: 0,
        sw: srcW,
        sh: srcH,
        dx: 0,
        dy: 0,
        dw: targetW,
        dh: h,
      },
    };
  }

  // Fill: distort to exact target
  if (mode === "fill") {
    return {
      outW: targetW,
      outH: targetH,
      draw: {
        sx: 0,
        sy: 0,
        sw: srcW,
        sh: srcH,
        dx: 0,
        dy: 0,
        dw: targetW,
        dh: targetH,
      },
    };
  }

  const srcRatio = srcW / srcH;
  const dstRatio = targetW / targetH;

  // Cover: crop source to match destination ratio, then scale to exact target
  if (mode === "cover") {
    let sw = srcW;
    let sh = srcH;
    let sx = 0;
    let sy = 0;

    if (srcRatio > dstRatio) {
      // Source too wide -> crop width
      sw = Math.round(srcH * dstRatio);
      sx = Math.round((srcW - sw) / 2);
    } else {
      // Source too tall -> crop height
      sh = Math.round(srcW / dstRatio);
      sy = Math.round((srcH - sh) / 2);
    }

    return {
      outW: targetW,
      outH: targetH,
      draw: { sx, sy, sw, sh, dx: 0, dy: 0, dw: targetW, dh: targetH },
    };
  }

  // Inside: fit within the box, but output adopts the fitted size (no padding)
  if (mode === "inside") {
    const scale = Math.min(targetW / srcW, targetH / srcH);
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    return {
      outW,
      outH,
      draw: {
        sx: 0,
        sy: 0,
        sw: srcW,
        sh: srcH,
        dx: 0,
        dy: 0,
        dw: outW,
        dh: outH,
      },
    };
  }

  // Pad: output is targetW x targetH, draw fitted image centered (white padding)
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));
  const dx = Math.round((targetW - dw) / 2);
  const dy = Math.round((targetH - dh) / 2);

  return {
    outW: targetW,
    outH: targetH,
    draw: { sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh },
  };
}

/**
 * Encodes a canvas into a Blob with the requested mime.
 * If the requested mime isn't supported, we fall back to PNG.
 */
async function canvasToBlobSafe(
  canvas: HTMLCanvasElement,
  requestedMime: string,
  quality01: number
): Promise<{ blob: Blob; mime: string }> {
  const supported = await isMimeSupportedByCanvas(requestedMime);

  // If unsupported, we fall back to PNG for maximum compatibility.
  const finalMime = supported ? requestedMime : "image/png";

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), finalMime, quality01)
  );

  // If the browser still fails for any reason, try PNG as a final fallback.
  if (!blob) {
    const fallback: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png")
    );
    if (!fallback) throw new Error("Failed to encode the image.");
    return { blob: fallback, mime: "image/png" };
  }

  return { blob, mime: finalMime };
}

/**
 * Renders an ImageBitmap into an output canvas and encodes it.
 * Background rules:
 * - JPEG output -> always white background (no transparency)
 * - pad mode    -> always white background (padding fill)
 */
export async function renderAndEncode(params: {
  bitmap: ImageBitmap;
  inputName: string;
  inputMime: string;
  targetW: number;
  targetH: number | null;
  mode: Mode;
  outputFormat: Format;
  qualityScale: number;
  allowEnlarge: boolean;
}) {
  const {
    bitmap,
    inputMime,
    targetW,
    targetH,
    mode,
    outputFormat,
    qualityScale,
    allowEnlarge,
  } = params;

  const srcW = bitmap.width;
  const srcH = bitmap.height;

  // If upscaling is disabled, clamp targets to source dimensions.
  // This is a simple guard that prevents enlarging beyond the original size.
  let safeTargetW = targetW;
  let safeTargetH = targetH;

  if (!allowEnlarge) {
    safeTargetW = Math.min(safeTargetW, srcW);
    if (safeTargetH !== null) safeTargetH = Math.min(safeTargetH, srcH);
  }

  // Determine output mime based on selection.
  // "keep" uses the input mime.
  const requestedMime = pickOutputMime(inputMime, outputFormat);

  // Compute output size and draw params for the chosen mode.
  const { outW, outH, draw } = computeTargetSize(
    srcW,
    srcH,
    safeTargetW,
    safeTargetH,
    mode
  );

  // Create output canvas.
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");

  // Decide whether we must paint white background.
  // - pad mode uses white for padding
  // - JPEG uses white because it can't store alpha
  const mustPaintWhite = mode === "pad" || requestedMime === "image/jpeg";

  if (mustPaintWhite) {
    ctx.fillStyle = WHITE_BG;
    ctx.fillRect(0, 0, outW, outH);
  }

  // Draw the bitmap into the output canvas using computed draw parameters.
  ctx.drawImage(
    bitmap,
    draw.sx,
    draw.sy,
    draw.sw,
    draw.sh,
    draw.dx,
    draw.dy,
    draw.dw,
    draw.dh
  );

  // Encoder quality for lossy formats
  const q = mapQuality01(qualityScale);

  // Convert canvas to blob safely (with fallback)
  const { blob, mime } = await canvasToBlobSafe(canvas, requestedMime, q);

  return { blob, mime, outW, outH };
}

/**
 * Processes images in batches to reduce memory spikes.
 * - batchSize controls how many images run concurrently.
 * - onProgress is called before each file begins and after each file completes.
 */
export async function processFilesInBatches(params: {
  files: File[];
  options: {
    width: number;
    height: number | null;
    mode: Mode;
    format: Format;
    qualityScale: number;
    allowEnlarge: boolean;
  };
  batchSize: number;
  onProgress: (p: {
    total: number;
    done: number;
    currentFileName?: string;
  }) => void;
}) {
  const { files, options, batchSize, onProgress } = params;

  const total = files.length;
  let done = 0;

  // Initialize progress
  onProgress({ total, done, currentFileName: undefined });

  const results: Array<{
    id: string;
    filename: string;
    mime: string;
    blob: Blob;
    previewUrl: string;
    info: string;
  }> = [];

  // Walk over files in batches to limit concurrency
  for (let start = 0; start < files.length; start += batchSize) {
    const batch = files.slice(start, start + batchSize);

    // Run the batch concurrently
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        // Notify UI which file is currently being handled
        onProgress({ total, done, currentFileName: file.name });

        // Decode efficiently
        const bitmap = await createImageBitmap(file);

        try {
          const { blob, mime, outW, outH } = await renderAndEncode({
            bitmap,
            inputName: file.name,
            inputMime: file.type,
            targetW: options.width,
            targetH: options.height,
            mode: options.mode,
            outputFormat: options.format,
            qualityScale: options.qualityScale,
            allowEnlarge: options.allowEnlarge,
          });

          const ext = extFromMime(mime);
          const filename = `${baseNameOf(file.name)}_${outW}x${outH}.${ext}`;

          const previewUrl = URL.createObjectURL(blob);
          const info = `${outW}×${outH} • ${humanFileSize(blob.size)}`;

          return {
            id: makeId(),
            filename,
            mime,
            blob,
            previewUrl,
            info,
          };
        } finally {
          // Release bitmap memory
          bitmap.close();
        }
      })
    );

    // Append batch results and update completed count
    for (const r of batchResults) {
      results.push(r);
      done += 1;
      onProgress({ total, done, currentFileName: undefined });
    }
  }

  return results;
}
