// Share-via-URL. We gzip + base64url the buffer into the location hash
// so the playground stays static-only. CompressionStream is available
// in every modern browser; no fallback.
//
// Wire format (see /CLAUDE.md — frozen backward-compat contract): the hash is
// base64url(gzip(utf8 source)), optionally preceded by a mode envelope. `sql:`
// targets SQL dry-run; a bare payload is a Run-mode share. The prefix can never
// collide with a payload because `:` is outside the base64url alphabet.

export type ShareMode = "file" | "sql";

const SQL_PREFIX = "sql:";

export async function encodeShare(text: string, mode: ShareMode): Promise<string> {
  const prefix = mode === "sql" ? SQL_PREFIX : "";
  return prefix + (await encode(text));
}

export async function decodeShare(
  hash: string,
): Promise<{ text: string; mode: ShareMode } | null> {
  let mode: ShareMode = "file";
  let payload = hash;
  if (hash.startsWith(SQL_PREFIX)) {
    mode = "sql";
    payload = hash.slice(SQL_PREFIX.length);
  }
  const text = await decode(payload);
  return text === null ? null : { text, mode };
}

export async function encode(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const stream = new Blob([enc as unknown as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return toBase64Url(compressed);
}

export async function decode(hash: string): Promise<string | null> {
  const raw = fromBase64Url(hash);
  if (!raw) return null;
  try {
    const stream = new Blob([raw as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
