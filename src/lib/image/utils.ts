import { MAX_DIM, MIN_DIM } from "./types";

/**
 * Simple numeric clamp helper.
 */
export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Converts raw user input into a safe integer dimension.
 * - Keeps only digits
 * - Disallows leading zeros
 * - Returns null for empty input while typing
 * - Clamps to allowed range
 */
export function parseDimInput(raw: string): number | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;

  digits = digits.replace(/^0+/, "");
  if (digits.length === 0) return null;

  const n = Number(digits);
  if (Number.isNaN(n)) return null;

  return clamp(n, MIN_DIM, MAX_DIM);
}

/**
 * Maps quality scale (1..5) into a Canvas encoder "quality" float (0..1).
 * - Used by JPEG/WebP (PNG ignores this).
 */
export function mapQuality01(scale: number) {
  const table = { 1: 0.4, 2: 0.6, 3: 0.75, 4: 0.85, 5: 0.92 } as const;
  return table[scale as 1 | 2 | 3 | 4 | 5] ?? 0.75;
}

/**
 * Human readable file size helper.
 */
export function humanFileSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;

  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }

  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Stable unique id for React keys and list management.
 */
export function makeId() {
  return (
    crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  ).toString();
}

/**
 * MIME -> file extension helper.
 */
export function extFromMime(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "png";
}

/**
 * Removes file extension from a name.
 */
export function baseNameOf(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}
