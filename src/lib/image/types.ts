/**
 * Shared types for image resizing logic (client-side).
 * Keeping these in one place makes refactors easier.
 */

export const MIN_DIM = 1;
export const MAX_DIM = 8000;

export const MAX_FILES = 40; // client-side: depends on device memory/CPU
export const MAX_SIZE_PER_FILE = 50 * 1024 * 1024; // 50MB per file (client-side bound)

/**
 * How aspect ratio is handled when both width and height are provided.
 */
export type Mode = "inside" | "cover" | "pad" | "fill";

/**
 * Output format selection.
 * - "keep": keep original format (if supported by the browser encoder)
 */
export type Format = "keep" | "jpeg" | "png" | "webp";

/**
 * An item produced by the client-side pipeline.
 * We store a Blob for downloads and an Object URL for preview.
 */
export type ProcessedItem = {
  id: string;
  filename: string;
  mime: string;
  blob: Blob;
  previewUrl: string;
  info: string;
};

/**
 * Progress state for UI.
 */
export type ProgressState = {
  phase: "idle" | "processing" | "zipping";
  total: number;
  done: number;
  currentFileName?: string;
};
