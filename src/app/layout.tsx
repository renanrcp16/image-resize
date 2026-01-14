import type { Metadata } from "next";
import "@/app/globals.css";

// Human-friendly site name used across metadata (title, OG, etc.)
const siteName = "Image Resizer";

// Short description used for SEO snippets + social previews
const siteDescription =
  "Resize one or many images, preview results, and download individually or as a ZIP..";

/**
 * Resolve the "base URL" of the site.
 *
 * Why we need this:
 * - Some metadata (like Open Graph images) works best with absolute URLs.
 * - Next can build absolute URLs when `metadataBase` is provided.
 *
 * Priority order:
 * 1) NEXT_PUBLIC_SITE_URL (recommended when you have a custom domain)
 * 2) VERCEL_URL (auto-provided by Vercel on deployments, no protocol included)
 * 3) localhost fallback for local development
 */
function getSiteUrl() {
  // `NEXT_PUBLIC_SITE_URL` should include protocol, e.g. https://yourdomain.com
  // `VERCEL_URL` is something like "my-app.vercel.app", so we add "https://"
  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  // Final fallback for local development
  return envUrl || "http://localhost:3000";
}

// Compute once and reuse in metadata
const siteUrl = getSiteUrl();

/**
 * Next.js Metadata API (App Router)
 *
 * This object generates the <title>, <meta>, and <link> tags for SEO + sharing.
 * Docs: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
 */
export const metadata: Metadata = {
  /**
   * Base URL used to resolve relative metadata URLs.
   *
   * Example:
   * - openGraph.images: "/og.png" becomes "https://your-domain.com/og.png"
   * - alternates.canonical: "/" becomes "https://your-domain.com/"
   */
  metadataBase: new URL(siteUrl),

  /**
   * Title behavior:
   * - default: used for the home page and pages that don't override the title
   * - template: used when a page sets its own title (e.g. "About • QR Code Generator")
   */
  title: {
    default: siteName,
    template: `%s • ${siteName}`,
  },

  /**
   * Main meta description (used by search engines + can be reused by link previews)
   */
  description: siteDescription,

  /**
   * Extra app-ish metadata (optional, but nice to have)
   */
  applicationName: siteName,
  generator: "Next.js",

  /**
   * Controls how the browser sends referrer info when navigating away.
   * "origin-when-cross-origin" is a reasonable privacy-friendly default.
   */
  referrer: "origin-when-cross-origin",

  /**
   * Keywords are not as important for modern SEO,
   * but they're harmless and can help describe the project.
   */
  keywords: [
    "Image Resizer",
    "Resize Image",
    "Photo Resizer",
    "Change Image Size",
    "Resize Images Online",
    "Free Image Resizer",
  ],

  /**
   * Robots meta tag: tells search engines whether to index/follow.
   * - index: allow indexing in search results
   * - follow: allow following links
   * googleBot options give Google-specific guidance about preview/snippet limits.
   */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  /**
   * Canonical URL helps avoid duplicate content issues.
   * Using "/" makes it relative; metadataBase will convert it to absolute.
   */
  alternates: {
    canonical: "/",
  },

  /**
   * Open Graph metadata:
   * Used by WhatsApp, Telegram, LinkedIn, Facebook, iMessage, etc.
   */
  openGraph: {
    type: "website",
    title: siteName,
    description: siteDescription,

    // Relative URL; metadataBase resolves it.
    url: "/",
    siteName,

    // OG image shown in link previews.
    // Put this file at: /public/og.png (1200x630)
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: `${siteName} preview`,
      },
    ],
  },

  /**
   * Twitter/X Card metadata (separate from OG).
   * "summary_large_image" gives a big preview card.
   */
  twitter: {
    card: "summary_large_image",
    title: siteName,
    description: siteDescription,
    images: ["/og.png"],
  },

  /**
   * Icons used by browsers, bookmarks, mobile home screen, etc.
   * These paths refer to files inside /public.
   */
  icons: {
    // Browser tab icon / bookmarks
    icon: [{ url: "/favicon.ico" }, { url: "/icon.png", type: "image/png" }],

    // iOS "Add to Home Screen" icon
    apple: [{ url: "/apple-touch-icon.png" }],
  },

  /**
   * Web App Manifest:
   * Enables "Install app" / PWA-like behavior and provides app icon + theme colors.
   * Put the file at: /public/site.webmanifest
   */
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `lang="en"` helps accessibility + SEO by declaring the document language
    <html lang="en">
      {/* Root body wrapper for all pages */}
      <body>{children}</body>
    </html>
  );
}
