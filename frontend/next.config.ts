import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy. Kept pragmatic for Next.js (there is no nonce
// pipeline yet): 'unsafe-inline' is required for Next's inline bootstrap and
// injected styles, and dev additionally needs 'unsafe-eval' + websockets for
// Turbopack HMR. The high-value protections that hold in every mode are
// frame-ancestors (clickjacking), object-src/base-uri lockdown, and a tight
// img/connect allow-list.
//
// accounts.google.com is deliberately absent from script/style/frame/connect:
// Google sign-in is a top-level navigation to its own tab now, which CSP does
// not govern, so nothing of Google's is loaded into this document. Only
// lh3.googleusercontent.com stays, for account profile photos.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://api.dishy.pro https://lh3.googleusercontent.com https://images.unsplash.com http://localhost:8080 http://127.0.0.1:8080",
  "font-src 'self' data:",
  `connect-src 'self' https://api.dishy.pro${isDev ? " http://localhost:8080 http://127.0.0.1:8080 ws: wss:" : ""}`,
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // geolocation=(self): the geofence setup (settings) and customer geofence check
  // call navigator.geolocation, which the browser blocks outright (no prompt) when
  // this policy is empty. Allow it for our own origin only.
  // identity-credentials-get is deliberately NOT delegated any more. It existed
  // only for the Google Identity Services button, a cross-origin iframe that
  // called FedCM itself; Google sign-in is a plain OAuth redirect in its own tab
  // now and never touches FedCM. Restore the delegation to accounts.google.com if
  // GIS ever comes back - without it that iframe fails silently and the sign-in
  // dialog never opens except in browsers with FedCM off.
  // The geolocation allowlist stays narrower than the browser default;
  // camera/microphone stay fully disabled since nothing uses them.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework (DISHY-01: drop x-powered-by).
  poweredByHeader: false,
  devIndicators: false,
  allowedDevOrigins: ["dishy.pro", "www.dishy.pro"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    // The built-in Next MCP writes .next/dev/logs/next-development.log.
    // Project tooling keeps runtime logs in the root logs/ directory instead.
    mcpServer: false,
    // Next 16 keeps Turbopack's dev build on disk (.next/dev) between runs.
    // Tailwind's output depends on class names scanned out of every source
    // file, which that cache does not track, so it kept serving an old
    // stylesheet: new utilities (a w-[250px] rail, bg-white/82 headers) never
    // reached the page, even across restarts, and the cache grew to 4.2 GB
    // with a dev server near 5 GB (2026-09-22). Rebuilding on each start costs
    // a few seconds and keeps the CSS true to the source.
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    // Public docs and the backend AI embed import the same catalog from the
    // repository. Allow Turbopack to resolve that one shared file without a
    // generated frontend copy that could drift.
    root: path.resolve(__dirname, ".."),
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "8080",
        pathname: "/uploads/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "8080",
        pathname: "/uploads/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
