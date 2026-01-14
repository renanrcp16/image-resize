import { NextResponse } from "next/server";
import { z } from "zod";
import sharp from "sharp";
import JSZip from "jszip";

/**
 * Important:
 * - sharp requires Node.js runtime in Next.js route handlers.
 */
export const runtime = "nodejs";

/**
 * We do NOT allow users to choose background color.
 * Whenever a background is needed (JPEG output or pad mode),
 * we always use WHITE.
 */
const DEFAULT_BACKGROUND = "#ffffff";

/**
 * Max limits to protect your server.
 */
const MAX_FILES = 20;
const MAX_SIZE_PER_FILE = 15 * 1024 * 1024; // 15MB

/**
 * Allowed input file MIME types.
 * We keep it strict to avoid surprises and reduce risk.
 */
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

/**
 * Helper: Convert Zod errors into a UI-friendly shape.
 * This mirrors the "nice validation output" style used in many example projects.
 */
function zodErrorToResponse(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }

  return {
    message: "Validation error",
    issues: error.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    })),
    fieldErrors,
  };
}

/**
 * Helper: Treat empty string as undefined
 * (e.g. height="" should behave like "not provided").
 */
const emptyToUndefined = (v: unknown) =>
  v === "" || v === null ? undefined : v;

/**
 * Helper: Parse boolean reliably from FormData.
 * Avoid z.coerce.boolean() pitfalls (Boolean("false") === true).
 */
const parseBool = (v: unknown) => {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
};

/**
 * Request schema (FormData fields).
 * Note: background is intentionally NOT part of the schema anymore.
 */
const schema = z.object({
  width: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(8000)
  ),
  height: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(8000).optional()
  ),

  /**
   * "inside": keep aspect ratio, fit within (may not match both dims exactly)
   * "cover": crop to fill the target area
   * "pad": contain + pad with background (we always use white)
   * "fill": stretch (distort) to match exactly
   */
  mode: z.enum(["inside", "cover", "pad", "fill"]).default("inside"),

  /**
   * Output format:
   * - if omitted -> keep original format
   */
  format: z.enum(["jpeg", "png", "webp", "avif"]).optional(),

  /**
   * Quality 1..5 (mapped to numeric quality for encoders that support it).
   */
  qualityScale: z.coerce.number().int().min(1).max(5).default(3),

  /**
   * "zip": returns application/zip
   * "json": returns base64 data URLs (preview)
   */
  download: z.enum(["zip", "json"]).default("zip"),

  /**
   * If false, we do not upscale images beyond their original size.
   */
  allowEnlarge: z.preprocess(parseBool, z.boolean().default(false)),
});

/**
 * Quality mapping: 1..5 -> encoder quality.
 * This affects jpeg/webp/avif.
 */
function mapQuality(scale: number) {
  const table = { 1: 40, 2: 60, 3: 75, 4: 85, 5: 92 } as const;
  return table[scale as 1 | 2 | 3 | 4 | 5] ?? 75;
}

/**
 * Choose output extension based on requested output format,
 * otherwise keep input format.
 */
function outputExtension(format?: string, inputMime?: string) {
  if (format) return format === "jpeg" ? "jpg" : format;

  if (inputMime === "image/jpeg") return "jpg";
  if (inputMime === "image/png") return "png";
  if (inputMime === "image/webp") return "webp";
  if (inputMime === "image/avif") return "avif";

  // Fallback (should not happen due to allowed mimes)
  return "png";
}

/**
 * Derive response MIME from extension.
 */
function outputMimeFromExt(ext: string) {
  return ext === "jpg" ? "image/jpeg" : (`image/${ext}` as const);
}

export async function POST(request: Request) {
  try {
    // Read multipart/form-data
    const form = await request.formData();

    // Validate + parse params
    const parsed = schema.safeParse({
      width: form.get("width"),
      height: form.get("height"),
      mode: form.get("mode") ?? undefined,
      format: form.get("format") ?? undefined,
      qualityScale: form.get("qualityScale"),
      download: form.get("download") ?? undefined,
      allowEnlarge: form.get("allowEnlarge"),
    });

    if (!parsed.success) {
      return NextResponse.json(zodErrorToResponse(parsed.error), {
        status: 400,
      });
    }

    const {
      width,
      height,
      mode,
      format,
      qualityScale,
      download,
      allowEnlarge,
    } = parsed.data;

    // Grab all files: FormData field must be "files"
    const files = form.getAll("files").filter(Boolean) as File[];

    // Validate file list
    if (files.length === 0) {
      return NextResponse.json(
        { message: "No images received. Please attach at least one file." },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { message: `Too many files. Max is ${MAX_FILES} per batch.` },
        { status: 400 }
      );
    }

    const encoderQuality = mapQuality(qualityScale);

    /**
     * We'll store processed outputs here.
     * - For ZIP: we’ll add them as files.
     * - For JSON: we’ll convert them to base64 data URLs.
     */
    const results: Array<{
      filename: string;
      mime: string;
      buffer: Buffer;
    }> = [];

    for (const file of files) {
      // Validate file type
      if (!ALLOWED_MIMES.has(file.type)) {
        return NextResponse.json(
          { message: `Unsupported file type: ${file.type}` },
          { status: 400 }
        );
      }

      // Validate file size
      if (file.size > MAX_SIZE_PER_FILE) {
        return NextResponse.json(
          { message: `File too large: ${file.name}. Max is 15MB per file.` },
          { status: 400 }
        );
      }

      // Read file into a Node Buffer
      const input = Buffer.from(await file.arrayBuffer());

      /**
       * Safety: limitInputPixels protects against decompression bombs
       * (images claiming gigantic dimensions).
       */
      const transformer = sharp(input, { limitInputPixels: 80_000_000 });

      /**
       * Map our "mode" to sharp fit modes:
       * - inside -> "inside"
       * - cover  -> "cover"
       * - pad    -> "contain" + background fill
       * - fill   -> "fill"
       */
      const fit =
        mode === "inside"
          ? "inside"
          : mode === "cover"
          ? "cover"
          : mode === "fill"
          ? "fill"
          : "contain"; // mode === "pad"

      /**
       * Build resize pipeline.
       * Background is only used when fit=contain (pad mode).
       * Since background selection is removed, we always use WHITE.
       */
      let pipeline = transformer.resize({
        width,
        height,
        fit,
        position: "center",
        background: DEFAULT_BACKGROUND,
        withoutEnlargement: !allowEnlarge,
      });

      // Decide output format
      const ext = outputExtension(format, file.type);
      const outMime = outputMimeFromExt(ext);

      /**
       * Encode output:
       * - JPEG does NOT support transparency, so we ALWAYS flatten onto WHITE.
       * - PNG keeps alpha.
       * - WebP/AVIF can keep alpha; we don't force flatten there.
       */
      if (ext === "jpg") {
        pipeline = pipeline
          .flatten({ background: DEFAULT_BACKGROUND })
          .jpeg({ quality: encoderQuality });
      } else if (ext === "png") {
        pipeline = pipeline.png({ compressionLevel: 9 });
      } else if (ext === "webp") {
        pipeline = pipeline.webp({ quality: encoderQuality });
      } else if (ext === "avif") {
        pipeline = pipeline.avif({ quality: encoderQuality });
      }

      // Execute pipeline
      const outBuffer = await pipeline.toBuffer();

      /**
       * Output filename:
       * We keep original base name and append target dimensions.
       * Note: duplicates can still occur if inputs are identical,
       * but ZIP allows duplicates in some tools; if you want to enforce unique,
       * we can suffix _2, _3, etc. later.
       */
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const outName = `${baseName}_${width}x${height ?? "auto"}.${ext}`;

      results.push({
        filename: outName,
        mime: outMime,
        buffer: outBuffer,
      });
    }

    /**
     * ZIP download mode:
     * Return application/zip with Content-Disposition.
     */
    if (download === "zip") {
      const zip = new JSZip();
      for (const r of results) zip.file(r.filename, r.buffer);

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      // Convert Node Buffer -> Uint8Array (compatible with BodyInit)
      const body = new Uint8Array(zipBuffer);

      return new Response(body, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="images_${width}x${
            height ?? "auto"
          }.zip"`,
        },
      });
    }

    /**
     * JSON preview mode:
     * Convert each output to a base64 dataUrl.
     * Best used for small batches / preview UI.
     */
    const json = results.map((r) => ({
      filename: r.filename,
      mime: r.mime,
      dataUrl: `data:${r.mime};base64,${r.buffer.toString("base64")}`,
    }));

    return NextResponse.json({ items: json });
  } catch {
    return NextResponse.json(
      { message: "Failed to resize images." },
      { status: 500 }
    );
  }
}
