"use client";

import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";

import type {
  Format,
  Mode,
  ProcessedItem,
  ProgressState,
} from "@/lib/image/types";
import {
  MAX_FILES,
  MAX_SIZE_PER_FILE,
  MIN_DIM,
  MAX_DIM,
} from "@/lib/image/types";
import { humanFileSize, parseDimInput } from "@/lib/image/utils";
import { processFilesInBatches } from "@/lib/image/resize";
import ProgressBar from "@/components/progress-bar";

/**
 * Batch size controls concurrency.
 * - Smaller = safer on low-memory devices
 * - Larger = faster on strong devices
 */
const DEFAULT_BATCH_SIZE = 5;

/**
 * Accepted input MIME types (client-side validation).
 */
const ACCEPTED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export default function Page() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Selected files
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Dimensions
  const [width, setWidth] = useState<number>(1000);
  const [widthText, setWidthText] = useState<string>("1000");

  const [height, setHeight] = useState<number | null>(null);
  const [heightText, setHeightText] = useState<string>("");

  // Options
  const [mode, setMode] = useState<Mode>("inside");
  const [format, setFormat] = useState<Format>("keep");
  const [qualityScale, setQualityScale] = useState<number>(3);
  const [allowEnlarge, setAllowEnlarge] = useState<boolean>(false);

  // Output
  const [items, setItems] = useState<ProcessedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Progress
  const [progress, setProgress] = useState<ProgressState>({
    phase: "idle",
    total: 0,
    done: 0,
    currentFileName: undefined,
  });

  const hasFiles = files.length > 0;
  const busy = progress.phase !== "idle";

  const ratioHint = useMemo(() => {
    if (height === null) return null;
    if (mode === "fill")
      return "Warning: “Stretch (fill)” may distort the image.";
    if (mode === "inside")
      return "Tip: “Fit inside” preserves aspect ratio and may not match both dimensions exactly.";
    if (mode === "cover")
      return "Tip: “Crop (cover)” preserves aspect ratio and crops to match the target ratio.";
    if (mode === "pad")
      return "Tip: “Pad (contain)” preserves aspect ratio and adds white padding to match the target size.";
    return null;
  }, [height, mode]);

  const backgroundInfo = useMemo(() => {
    if (format === "jpeg")
      return "JPEG does not support transparency. Transparent areas will be flattened onto white.";
    if (mode === "pad") return "Pad mode uses a white background for padding.";
    return null;
  }, [format, mode]);

  const canRun = useMemo(() => {
    if (!hasFiles) return false;
    if (!width || width < MIN_DIM || width > MAX_DIM) return false;
    if (height !== null && (height < MIN_DIM || height > MAX_DIM)) return false;
    return true;
  }, [hasFiles, width, height]);

  /**
   * Releases Object URLs to avoid memory leaks.
   */
  function revokeItemUrls(list: ProcessedItem[]) {
    for (const it of list) {
      try {
        URL.revokeObjectURL(it.previewUrl);
      } catch {
        // Ignore URL revoke issues
      }
    }
  }

  function clearAll() {
    revokeItemUrls(items);
    setFiles([]);
    setItems([]);
    setError(null);
    setProgress({
      phase: "idle",
      total: 0,
      done: 0,
      currentFileName: undefined,
    });

    if (inputRef.current) inputRef.current.value = "";
  }

  function clearResults() {
    revokeItemUrls(items);
    setItems([]);
  }

  /**
   * Validates and merges new files into current selection.
   */
  function normalizeFileList(list: FileList | File[]) {
    const arr = Array.from(list);

    const invalidType = arr.find(
      (f) => !ACCEPTED_MIMES.includes(f.type as any)
    );
    if (invalidType) {
      setError(
        `Unsupported file type: ${invalidType.name} (${invalidType.type}).`
      );
      return;
    }

    const tooBig = arr.find((f) => f.size > MAX_SIZE_PER_FILE);
    if (tooBig) {
      setError(
        `File too large: ${tooBig.name} (${humanFileSize(
          tooBig.size
        )}). Max is ${humanFileSize(MAX_SIZE_PER_FILE)}.`
      );
      return;
    }

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

  /**
   * Runs the processing pipeline in batches and updates progress.
   */
  async function generatePreview() {
    setError(null);
    clearResults();

    if (!canRun) return;

    setProgress({
      phase: "processing",
      total: files.length,
      done: 0,
      currentFileName: undefined,
    });

    try {
      const processed = await processFilesInBatches({
        files,
        batchSize: DEFAULT_BATCH_SIZE,
        options: {
          width,
          height,
          mode,
          format,
          qualityScale,
          allowEnlarge,
        },
        onProgress: ({ total, done, currentFileName }) => {
          setProgress((prev) => ({
            ...prev,
            phase: "processing",
            total,
            done,
            currentFileName,
          }));
        },
      });

      setItems(processed);
    } catch (e: any) {
      setError(e?.message ?? "Unexpected error while processing images.");
    } finally {
      setProgress({
        phase: "idle",
        total: 0,
        done: 0,
        currentFileName: undefined,
      });
    }
  }

  /**
   * Downloads a single processed item.
   */
  function downloadSingle(item: ProcessedItem) {
    const a = document.createElement("a");
    a.href = item.previewUrl;
    a.download = item.filename;
    a.click();
  }

  /**
   * Creates a ZIP from the already processed items.
   * If there are no processed items yet, it generates preview first.
   */
  async function downloadZip() {
    setError(null);

    if (!canRun) return;

    // Ensure there are processed items available
    let list = items;
    if (list.length === 0) {
      await generatePreview();
      list = items; // state updates async; user can click again after preview is ready
      if (list.length === 0) return;
    }

    setProgress({
      phase: "zipping",
      total: list.length,
      done: 0,
      currentFileName: undefined,
    });

    try {
      const zip = new JSZip();

      for (let i = 0; i < list.length; i++) {
        const it = list[i];

        // Update progress for ZIP creation
        setProgress({
          phase: "zipping",
          total: list.length,
          done: i,
          currentFileName: it.filename,
        });

        zip.file(it.filename, it.blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `images_${width}x${height ?? "auto"}_${mode}_${
        format === "keep" ? "original" : format
      }_q${qualityScale}.zip`;
      a.click();

      URL.revokeObjectURL(url);

      setProgress({
        phase: "zipping",
        total: list.length,
        done: list.length,
        currentFileName: undefined,
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate ZIP.");
    } finally {
      setProgress({
        phase: "idle",
        total: 0,
        done: 0,
        currentFileName: undefined,
      });
    }
  }

  /**
   * Builds a friendly label for the progress bar.
   */
  const progressLabel = useMemo(() => {
    if (progress.phase === "processing") {
      return progress.currentFileName
        ? `Processing: ${progress.currentFileName}`
        : "Processing images...";
    }
    if (progress.phase === "zipping") {
      return progress.currentFileName
        ? `Adding to ZIP: ${progress.currentFileName}`
        : "Creating ZIP...";
    }
    return undefined;
  }, [progress]);

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100 p-3">
      <div className="mx-auto max-w-4xl px-4 py-5">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Image Resizer
          </h1>
          <p className="mt-2 text-zinc-400">
            Resize images locally in your browser, then download individually or
            as a ZIP.
          </p>
        </header>

        {/* Progress */}
        {busy && (
          <div className="mb-6">
            <ProgressBar
              value={progress.done}
              max={progress.total}
              label={progressLabel}
            />
          </div>
        )}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Upload */}
            <div>
              <h2 className="text-lg font-semibold">Upload</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Supported: JPG, PNG, WebP • Max {MAX_FILES} files • Up to{" "}
                {humanFileSize(MAX_SIZE_PER_FILE)} each
              </p>

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
                    className="rounded-xl bg-zinc-100 px-4 py-2.5 font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                  >
                    Choose files
                  </button>

                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length)
                        normalizeFileList(e.target.files);
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-300">
                    Files ({files.length}/{MAX_FILES})
                  </p>

                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-60"
                    disabled={busy && files.length === 0}
                  >
                    Clear
                  </button>
                </div>

                {files.length > 0 ? (
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
                          className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-800 disabled:opacity-60"
                          onClick={() => removeFile(idx)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-zinc-600">
                    No files added yet.
                  </p>
                )}
              </div>
            </div>

            {/* Settings */}
            <div>
              <h2 className="text-lg font-semibold">Settings</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Processing runs locally on your device.
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
                      const normalized = digitsOnly.replace(/^0+/, "");

                      setWidthText(normalized);
                      if (parsed !== null) setWidth(parsed);
                    }}
                    onBlur={() => {
                      const parsed = parseDimInput(widthText);
                      const finalValue = parsed ?? 1000;
                      setWidth(finalValue);
                      setWidthText(String(finalValue));
                    }}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600"
                    placeholder="1000"
                    disabled={busy}
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

                      if (raw.trim() === "") {
                        setHeightText("");
                        setHeight(null);
                        return;
                      }

                      if (raw === "0") return;

                      const parsed = parseDimInput(raw);
                      const digitsOnly = raw.replace(/\D/g, "");
                      const normalized = digitsOnly.replace(/^0+/, "");

                      setHeightText(normalized);
                      if (parsed !== null) setHeight(parsed);
                    }}
                    onBlur={() => {
                      if (heightText.trim() === "") {
                        setHeight(null);
                        return;
                      }
                      const parsed = parseDimInput(heightText);
                      setHeight(parsed ?? null);
                      setHeightText(parsed === null ? "" : String(parsed));
                    }}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600"
                    placeholder="(auto)"
                    disabled={busy}
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
                    disabled={busy}
                  >
                    <option value="inside">Fit inside (preserve ratio)</option>
                    <option value="cover">Crop (cover)</option>
                    <option value="pad">
                      Pad (contain) — white background
                    </option>
                    <option value="fill">Stretch (fill)</option>
                  </select>
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
                    disabled={busy}
                  >
                    <option value="keep">Keep original</option>
                    <option value="jpeg">JPEG</option>
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                  </select>
                </div>

                {/* Quality */}
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
                    disabled={busy}
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
                      disabled={busy}
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

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={generatePreview}
                  disabled={!canRun || busy}
                  className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
                >
                  Generate preview
                </button>

                <button
                  onClick={downloadZip}
                  disabled={!canRun || busy}
                  className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-60"
                  title="Download all processed images as a ZIP"
                >
                  Download ZIP
                </button>
              </div>

              <p className="mt-3 text-xs text-zinc-500">
                For exact size with preserved ratio, use “Crop (cover)” or “Pad
                (contain)”.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Preview</h2>
              <p className="text-sm text-zinc-400">
                Generated locally. Download individually or as a ZIP.
              </p>
            </div>

            <button
              type="button"
              onClick={clearResults}
              disabled={items.length === 0 || busy}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-60"
            >
              Clear preview
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            {items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-200">
                          {it.filename}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {it.mime} • {it.info}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => downloadSingle(it)}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-800 disabled:opacity-60"
                        disabled={busy}
                      >
                        Download
                      </button>
                    </div>

                    <div className="mt-3 flex min-h-[180px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                      <img
                        src={it.previewUrl}
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
