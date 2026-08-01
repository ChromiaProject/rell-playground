# CLAUDE.md

## Tooling

The frontend package manager is **pnpm**: `web/pnpm-lock.yaml` is the canonical
lockfile and Gradle drives the frontend via `PnpmTask`. In `web/`, always use
`pnpm run <script>` / `pnpm exec <bin>` — never `npx` or `npm run`, which risk
creating a stray `package-lock.json`.

## Snippet-link format (backward-compatibility contract)

The playground shares code via the URL fragment only — the site is static, links are
never stored server-side, so **every snippet link ever handed out must keep decoding
in all future versions**. Treat the format below as frozen wire format, not an
implementation detail.

Format (implemented in `web/src/util/share.ts`, consumed in `web/src/main.ts`):

```
https://<origin><path>#<payload>
payload = base64url( gzip( UTF-8 bytes of the editor buffer ) )
```

- The fragment after `#` is the payload, optionally preceded by a mode envelope:
  a `sql:` prefix targets the SQL dry-run mode (`#sql:<payload>`). A **bare**
  payload (no prefix) is always a Run-mode share — that is the original v1 format
  and every pre-prefix link in the wild.
- base64url alphabet: standard base64 with `+`→`-`, `/`→`_`, and `=` padding
  **stripped**. The decoder re-pads and must keep accepting unpadded input.
- Compression is gzip via the browser's `CompressionStream("gzip")` /
  `DecompressionStream("gzip")` — any spec-compliant gzip stream must decode.
- The payload carries the raw program text and nothing else (no filename, mode, or
  Rell version — mode lives in the envelope prefix, outside the payload). A decoded
  link seeds the buffer of the mode its envelope targets (Run when bare).
- Decode is fail-soft: an undecodable hash is silently ignored and the editor falls
  back to the localStorage buffer. Preserve that — old or corrupt links must never
  break page load.

Rules when touching this code:

1. `decode()` must forever accept the format above, byte-for-byte as specified.
2. Never change what `encode()` emits in a way `decode()` from this section can't
   read, unless you introduce a **new, distinguishable** envelope (e.g. a prefixed
   scheme like `#v2:` that cannot collide with base64url) *and* keep the legacy
   path: a bare base64url payload is always treated as the v1 gzip format.
3. Any metadata additions (Rell version, mode, multiple files) go into a new
   envelope per rule 2 — do not try to smuggle them into the gzip payload, since
   old payloads are plain source text and new decoders can't tell them apart.
4. Changes to `web/src/util/share.ts` need round-trip tests covering: fresh links,
   a hard-coded legacy link fixture (to catch accidental format drift), unpadded
   base64url, and garbage input returning `null`.
