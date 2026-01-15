# Image Resizer

A fast, privacy-friendly image resizer that runs **entirely in your browser**.  
Resize **multiple images at once**, preview results, and download images **individually** or as a **ZIP** — without uploading files to a server.

## Features

- **Client-side processing** (no uploads, avoids server payload limits)
- Batch resize multiple images at once
- Download:
  - **Single image**
  - **All images as ZIP**
- Resize modes (when both width and height are provided):
  - **Fit inside** (preserve ratio, no crop)
  - **Crop (cover)** (preserve ratio, crop to match target ratio)
  - **Pad (contain)** (preserve ratio, add white padding)
  - **Stretch (fill)** (distort to match exact size)
- **Quality scale (1–5)** for lossy formats
- **Progress bar** + batch processing to reduce memory spikes

## How it works

This project uses the browser’s native image pipeline:

- `createImageBitmap()` for efficient decoding
- `<canvas>` rendering for resizing
- `canvas.toBlob()` for encoding (JPEG/PNG/WebP)
- `JSZip` for ZIP creation

## Tech stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- JSZip (client-side ZIP creation)

## Getting started

### 1) Install dependencies

```bash
npm install
```

### 2) Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

### 3) Build

```bash
npm run build
npm start
```

## Usage

1. Upload one or more images (JPG, PNG, WebP)
2. Choose:
   - Width (required)
   - Height (optional)
   - Resize mode
   - Output format (keep / JPEG / PNG / WebP)
   - Quality (1–5)
3. Click **Generate preview**
4. Download:
   - Individual images
   - Or **Download ZIP**

## Limits & performance notes

Client-side resizing depends on the user’s device:

- Large images and large batches can use significant RAM.
- The app processes images in **batches** (default: 5 at a time) to reduce memory spikes.
- If you want to tune performance:
  - Adjust the batch size constant in `src/app/page.tsx`

## Project structure

```txt
src/
  app/
    page.tsx
  components/
    ProgressBar.tsx
  lib/
    image/
      types.ts
      utils.ts
      canvas.ts
      resize.ts
```

## License

MIT (or your preferred license)
