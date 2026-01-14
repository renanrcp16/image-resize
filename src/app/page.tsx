"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Frontend constraints (mirror backend rules).
 */
const MIN_DIM = 1;
const MAX_DIM = 8000;

const MAX_FILES = 20;
const MAX_SIZE_PER_FILE = 15 * 1024 * 1024; // 15MB

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Numeric input parser:
 * - Strips non-digits
 * - Disallows leading zero
 * - Returns null for empty typing
 * - Clamps to allowed range
 */
function parseDimInput(raw: string): number | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;

  if (digits[0] === "0") {
    digits = digits.replace(/^0+/, "");
    if (digits.length === 0) return null;
  }

  const n = Number(digits);
  if (Number.isNaN(n)) return null;

  return clamp(n, MIN_DIM, MAX_DIM);
}

type Mode = "inside" | "cover" | "pad" | "fill";
type Format = "keep" | "jpeg" | "png" | "webp" | "avif";

type PreviewItem = {
  filename: string;
  mime: string;
  dataUrl: string;
};

export default function Page() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Selected files
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Required width
  const [width, setWidth] = useState<number>(1000);
  const [widthText, setWidthText] = useState<string>("1000");

  // Optional height (null => auto)
  const [height, setHeight] = useState<number | null>(null);
  const [heightText, setHeightText] = useState<string>("");

  // Options
  const [mode, setMode] = useState<Mode>("inside");
  const [format, setFormat] = useState<Format>("keep");
  const [qualityScale, setQualityScale] = useState<number>(3);
  const [allowEnlarge, setAllowEnlarge] = useState<boolean>(false);

  // Outputs
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingZip, setLoadingZip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasFiles = files.length > 0;

  /**
   * Friendly hints about aspect ratio behavior when height is set.
   */
  const ratioHint = useMemo(() => {
    if (height === null) return null;

    if (mode === "fill")
      return "Warning: “Stretch (fill)” may distort the image.";
    if (mode === "inside")
      return "Tip: “Fit inside” preserves aspect ratio and may not reach both width & height exactly.";
    if (mode === "cover")
      return "Tip: “Crop (cover)” preserves aspect ratio and will crop to match the target ratio.";
    if (mode === "pad")
      return "Tip: “Pad (contain)” preserves aspect ratio and adds white padding to match the target size.";

    return null;
  }, [height, mode]);

  /**
   * If output is JPEG, remind that transparency becomes white.
   * Also in pad mode, padding is always white.
   */
  const backgroundInfo = useMemo(() => {
    if (format === "jpeg") {
      return "Note: JPEG does not support transparency. Any transparent areas will be flattened onto white.";
    }
    if (mode === "pad") {
      return "Note: Pad (contain) mode uses a white background for padding.";
    }
    return null;
  }, [format, mode]);

  function humanFileSize(bytes: number) {
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
   * Merge new files into existing list while enforcing client-side limits.
   * Backend still validates as the source of truth.
   */
  function normalizeFileList(list: FileList | File[]) {
    const arr = Array.from(list);

    // Validate type
    const invalidType = arr.find(
      (f) =>
        !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
          f.type
        )
    );
    if (invalidType) {
      setError(
        `Unsupported file type: ${invalidType.name} (${invalidType.type})`
      );
      return;
    }

    // Validate size
    const tooBig = arr.find((f) => f.size > MAX_SIZE_PER_FILE);
    if (tooBig) {
      setError(
        `File too large: ${tooBig.name} (${humanFileSize(
          tooBig.size
        )}). Max is 15 MB.`
      );
      return;
    }

    // Validate count
    const merged = [...files, ...arr];
    if (merged.length > MAX_FILES) {
      setError(`Too many files. Max is ${MAX_FILES} per batch.`);
      return;
    }

    setError(null);
    setFiles(merged);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function clearAll() {
    setFiles([]);
    setItems([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /**
   * Build FormData for our backend route.
   * Notice: no background is sent anymore.
   */
  function buildFormData(download: "zip" | "json") {
    const fd = new FormData();

    fd.append("width", String(width));
    if (height !== null) fd.append("height", String(height));

    fd.append("mode", mode);
    fd.append("download", download);

    fd.append("qualityScale", String(qualityScale));
    fd.append("allowEnlarge", String(allowEnlarge));

    // Only send format when user explicitly chooses it.
    if (format !== "keep") fd.append("format", format);

    // Attach files
    for (const f of files) fd.append("files", f);

    return fd;
  }

  function getZipName() {
    const h = height === null ? "auto" : String(height);
    const fmt = format === "keep" ? "original" : format;
    return `images_${width}x${h}_${mode}_${fmt}_q${qualityScale}.zip`;
  }

  /**
   * Call backend to generate preview images (download=json).
   */
  async function generatePreview() {
    setLoadingPreview(true);
    setError(null);
    setItems([]);

    try {
      if (!hasFiles) throw new Error("Please add at least one image.");

      const res = await fetch("/api/resize", {
        method: "POST",
        body: buildFormData("json"),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          payload?.fieldErrors?.width?.[0] ??
          payload?.fieldErrors?.height?.[0] ??
          payload?.issues?.[0]?.message ??
          payload?.message ??
          "Failed to resize images";
        throw new Error(msg);
      }

      setItems((payload?.items ?? []) as PreviewItem[]);
    } catch (e: any) {
      setError(e?.message ?? "Unexpected error");
    } finally {
      setLoadingPreview(false);
    }
  }

  /**
   * Call backend to generate a ZIP (download=zip) and trigger browser download.
   */
  async function downloadZip() {
    setLoadingZip(true);
    setError(null);

    try {
      if (!hasFiles) throw new Error("Please add at least one image.");

      const res = await fetch("/api/resize", {
        method: "POST",
        body: buildFormData("zip"),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const msg =
          payload?.fieldErrors?.width?.[0] ??
          payload?.fieldErrors?.height?.[0] ??
          payload?.issues?.[0]?.message ??
          payload?.message ??
          "Failed to generate ZIP";
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = getZipName();
      a.click();

      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "Unexpected error");
    } finally {
      setLoadingZip(false);
    }
  }

  /**
   * Download a single preview item (dataUrl).
   */
  function downloadSingle(item: PreviewItem) {
    const a = document.createElement("a");
    a.href = item.dataUrl;
    a.download = item.filename;
    a.click();
  }

  /**
   * Simple "can run" rules for UI.
   * Backend still enforces the real validation.
   */
  const canRun = useMemo(() => {
    if (!hasFiles) return false;
    if (!width || width < MIN_DIM || width > MAX_DIM) return false;
    if (height !== null && (height < MIN_DIM || height > MAX_DIM)) return false;
    return true;
  }, [hasFiles, width, height]);

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100 p-3">
      <div className="mx-auto max-w-4xl px-4 py-5">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Image Resizer
          </h1>
          <p className="mt-2 text-zinc-400">
            Resize one or many images, preview results, and download
            individually or as a ZIP.
          </p>
        </header>

        {/* Main card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Upload section */}
            <div>
              <h2 className="text-lg font-semibold">Upload</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Supported: JPG, PNG, WebP, AVIF • Max {MAX_FILES} files • Up to
                15 MB each
              </p>

              {/* Drag and drop area */}
              <div
                className={[
                  "mt-4 rounded-2xl border border-dashed p-5 transition",
                  dragOver
                    ? "border-zinc-500 bg-zinc-950/70"
                    : "border-zinc-800 bg-zinc-950/40",
                ].join(" ")}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length)
                    normalizeFileList(e.dataTransfer.files);
                }}
              >
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">Drag & drop images here</p>
                    <p className="text-sm text-zinc-400">or click to browse</p>
                  </div>

                  <button
                    type="button"
                    className="rounded-xl bg-zinc-100 px-4 py-2.5 font-medium text-zinc-950 hover:bg-white"
                    onClick={() => inputRef.current?.click()}
                  >
                    Choose files
                  </button>

                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length)
                        normalizeFileList(e.target.files);
                    }}
                  />
                </div>
              </div>

              {/* File list */}
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-300">
                    Files ({files.length}/{MAX_FILES})
                  </p>

                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-60"
                    disabled={!hasFiles && items.length === 0 && !error}
                    title="Clear files and preview"
                  >
                    Clear
                  </button>
                </div>

                {hasFiles ? (
                  <ul className="mt-3 space-y-2">
                    {files.map((f, idx) => (
                      <li
                        key={`${f.name}-${f.size}-${idx}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-zinc-200">
                            {f.name}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {f.type} • {humanFileSize(f.size)}
                          </p>
                        </div>

                        <button
                          type="button"
                          className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-800"
                          onClick={() => removeFile(idx)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-zinc-600">
                    No files added yet. Drop images above or click “Choose
                    files”.
                  </p>
                )}
              </div>
            </div>

            {/* Settings section */}
            <div>
              <h2 className="text-lg font-semibold">Settings</h2>
              <p className="mt-1 text-sm text-zinc-400">
                If you only set width, the aspect ratio is preserved
                automatically.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {/* Width */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300">
                    Width (px) <span className="text-zinc-500">(required)</span>
                  </label>

                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={widthText}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "0") return;

                      const parsed = parseDimInput(raw);

                      const digitsOnly = raw.replace(/\D/g, "");
                      const normalizedText = digitsOnly.replace(/^0+/, "");

                      setWidthText(normalizedText);
                      if (parsed !== null) setWidth(parsed);
                    }}
                    onBlur={() => {
                      // On blur, normalize to a real number (fallback to 1000)
                      const parsed = parseDimInput(widthText);
                      const finalValue = parsed ?? 1000;
                      setWidth(finalValue);
                      setWidthText(String(finalValue));
                    }}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600"
                    placeholder="1000"
                  />

                  <p className="mt-2 text-xs text-zinc-500">
                    Between {MIN_DIM} and {MAX_DIM}. Leading zero is not
                    allowed.
                  </p>
                </div>

                {/* Height */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300">
                    Height (px){" "}
                    <span className="text-zinc-500">(optional)</span>
                  </label>

                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={heightText}
                    onChange={(e) => {
                      const raw = e.target.value;

                      // Empty => auto height
                      if (raw.trim() === "") {
                        setHeightText("");
                        setHeight(null);
                        return;
                      }

                      if (raw === "0") return;

                      const parsed = parseDimInput(raw);

                      const digitsOnly = raw.replace(/\D/g, "");
                      const normalizedText = digitsOnly.replace(/^0+/, "");

                      setHeightText(normalizedText);
                      if (parsed !== null) setHeight(parsed);
                    }}
                    onBlur={() => {
                      // If empty, keep null
                      if (heightText.trim() === "") {
                        setHeight(null);
                        return;
                      }

                      // Normalize numeric
                      const parsed = parseDimInput(heightText);
                      setHeight(parsed ?? null);
                      setHeightText(parsed === null ? "" : String(parsed));
                    }}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600"
                    placeholder="(auto)"
                  />

                  <p className="mt-2 text-xs text-zinc-500">
                    Leave empty to keep aspect ratio from width.
                  </p>
                </div>

                {/* Mode */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300">
                    Resize mode
                  </label>

                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as Mode)}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-600"
                  >
                    <option value="inside">Fit inside (preserve ratio)</option>
                    <option value="cover">Crop (cover)</option>
                    <option value="pad">
                      Pad (contain) — white background
                    </option>
                    <option value="fill">Stretch (fill)</option>
                  </select>

                  <p className="mt-2 text-xs text-zinc-500">
                    If you set both width and height, mode controls aspect ratio
                    handling.
                  </p>
                </div>

                {/* Format */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300">
                    Output format
                  </label>

                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as Format)}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-600"
                  >
                    <option value="keep">Keep original</option>
                    <option value="jpeg">JPEG</option>
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                    <option value="avif">AVIF</option>
                  </select>
                </div>

                {/* Quality scale */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-zinc-300">
                    Quality ({qualityScale}/5)
                  </label>

                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={qualityScale}
                    onChange={(e) => setQualityScale(Number(e.target.value))}
                    className="mt-3 w-full"
                  />

                  <div className="mt-2 flex justify-between text-xs text-zinc-500">
                    <span>Smaller</span>
                    <span>Balanced</span>
                    <span>Sharper</span>
                  </div>
                </div>

                {/* Allow enlarge */}
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allowEnlarge}
                      onChange={(e) => setAllowEnlarge(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <div>
                      <p className="text-sm font-medium text-zinc-200">
                        Allow upscaling
                      </p>
                      <p className="text-xs text-zinc-500">
                        If disabled, images won’t be enlarged beyond their
                        original size.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Helpful hints */}
              {ratioHint && (
                <div className="mt-4 rounded-xl border border-amber-900/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                  {ratioHint}
                </div>
              )}

              {backgroundInfo && (
                <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-200">
                  {backgroundInfo}
                </div>
              )}

              {/* Actions */}
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={generatePreview}
                  disabled={!canRun || loadingPreview || loadingZip}
                  className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
                >
                  {loadingPreview
                    ? "Generating preview..."
                    : "Generate preview"}
                </button>

                <button
                  onClick={downloadZip}
                  disabled={!canRun || loadingPreview || loadingZip}
                  className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-60"
                  title="Download all resized images as a ZIP"
                >
                  {loadingZip ? "Preparing ZIP..." : "Download ZIP"}
                </button>
              </div>

              <p className="mt-3 text-xs text-zinc-500">
                Pro tip: if you set both width and height, “Crop (cover)” is
                usually the best-looking choice.
              </p>
            </div>
          </div>

          {/* Error box */}
          {error && (
            <div className="mt-5 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Preview card */}
        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Preview</h2>
              <p className="text-sm text-zinc-400">
                Preview is generated via API (download=json). For big batches,
                prefer ZIP.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setItems([])}
              disabled={items.length === 0}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-60"
              title="Clear preview"
            >
              Clear preview
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            {items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((it, idx) => (
                  <div
                    key={`${it.filename}-${idx}`} // ✅ Fix: unique key even for duplicate filenames
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-200">
                          {it.filename}
                        </p>
                        <p className="text-xs text-zinc-500">{it.mime}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => downloadSingle(it)}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-800"
                      >
                        Download
                      </button>
                    </div>

                    <div className="mt-3 flex min-h-[180px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                      <img
                        src={it.dataUrl}
                        alt={it.filename}
                        className="h-auto max-h-[220px] max-w-full rounded-lg"
                        loading="lazy"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950">
                <p className="text-zinc-600">
                  Generate a preview to see resized images here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer (kept consistent with example project style) */}
      <footer className="text-center text-sm text-zinc-500">
        <p>
          Built by{" "}
          <a
            href="https://renan-rcp.vercel.app/"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline hover:text-white"
          >
            Renan Corrêa Pedroso
          </a>
          {" • "}
          <a
            href="https://github.com/renanrcp16"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline hover:text-white"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
