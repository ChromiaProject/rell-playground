// Vendors the CheerpJ runtime into web/public/cheerpj/ so the SPA can serve
// it from the same origin (required for GitLab Pages and CORS-safe Worker
// scripts). Idempotent: skips download if loader.js already exists.
//
// CheerpJ is distributed by Leaning Technologies under their own license.
// For commercial use, see https://leaningtech.com/cheerpj/. The runtime
// files are not vendored in source control; fetched fresh in CI.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TARGET = join(ROOT, "public", "cheerpj");
const VERSION = process.env["CHEERPJ_VERSION"] ?? "4.2";
const LOADER_URL = `https://cjrtnc.leaningtech.com/${VERSION}/loader.js`;

if (existsSync(join(TARGET, "loader.js"))) {
  console.log(`CheerpJ already vendored at ${TARGET}. Skipping.`);
  process.exit(0);
}

mkdirSync(TARGET, { recursive: true });

console.log(`Fetching ${LOADER_URL} → ${TARGET}/loader.js`);
const res = await fetch(LOADER_URL);
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const text = await res.text();

// CheerpJ's loader bootstraps additional resources from the same origin it
// was loaded from. Patch the embedded base URL so resources load from
// /cheerpj/ on our domain rather than cjrtnc.leaningtech.com. The exact
// constant name depends on the CheerpJ version — adjust if loader.js
// shape changes.
const patched = text.replace(
  /https:\/\/cjrtnc\.leaningtech\.com\/[0-9.]+\//g,
  "/cheerpj/",
);
writeFileSync(join(TARGET, "loader.js"), patched);
console.log(`Wrote ${TARGET}/loader.js (${patched.length} bytes)`);
console.log(
  "Note: on first SPA load the runtime will fetch additional files from the patched /cheerpj/ path. " +
    "If you self-host without a CDN passthrough, mirror the rest of the runtime under web/public/cheerpj/ as well.",
);
