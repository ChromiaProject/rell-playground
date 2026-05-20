/// <reference lib="webworker" />

// CheerpJ-backed worker. Loads the CheerpJ runtime + the bridge fat JAR,
// then invokes static methods on com.chromia.rellplayground.PlaygroundBridge
// from JS. Output is batched per call (Rell synchronously fills the
// BufferedReplChannel before returning), so we receive a JSON envelope and
// forward each event back to the main thread.

import type { WorkerEvent, WorkerRequest } from "./protocol.ts";

// CheerpJ ships its types globally on `self` after `loader.js` runs.
declare const cheerpjInit: (opts?: { version?: number; status?: string } & Record<string, unknown>) => Promise<void>;
declare const cheerpjRunLibrary: (cp: string) => Promise<Lib>;
declare const cheerpOSAddStringFile: (path: string, data: Uint8Array) => Promise<void>;

// CheerpJ exposes Java packages as nested JS objects; method calls return
// Promises of (boxed) primitives.
type Lib = {
  com: {
    chromia: {
      rellplayground: {
        PlaygroundBridge: {
          version(): Promise<string>;
          runFile(code: string): Promise<string>;
          replCreate(): Promise<number>;
          replExecute(id: number, command: string): Promise<string>;
          replDispose(id: number): Promise<void>;
        };
      };
    };
  };
};

type ReplEvent =
  | { type: "stdout"; text: string }
  | { type: "value"; text: string }
  | { type: "control"; code: string; message: string }
  | { type: "compiler"; severity: string; code: string; message: string; pos?: string }
  | { type: "runtimeError"; message: string; stack?: string };

type Envelope = { ok: boolean; events: ReplEvent[] };

declare const self: DedicatedWorkerGlobalScope & { [k: string]: unknown };

// CheerpJ is loaded from Leaning Technologies' CDN by default. To self-host
// (offline, no third-party requests), mirror cjrtnc.leaningtech.com/4.2/ under
// web/public/cheerpj/ at build time and change this URL to "/cheerpj/loader.js".
// The fetch-cheerpj.ts script has a starting point.
const CHEERPJ_LOADER = "https://cjrtnc.leaningtech.com/4.2/loader.js";
// We ship the bridge JAR gzip-compressed (jar.gz, ~25 MB on the wire vs
// ~89 MB raw). The worker pulls .jar.gz, decodes via DecompressionStream("gzip"),
// and mounts the resulting Uint8Array into CheerpJ's /str/ virtual filesystem.
// Brotli would compress further (~14 MB) but DecompressionStream("br") isn't
// universally supported in browsers yet.
const BRIDGE_JAR_GZ_URL = "/jvm/rell-playground-bridge-all.jar.gz";
const BRIDGE_JAR = "/str/rell-playground-bridge.jar";

function post(event: WorkerEvent): void {
  self.postMessage(event);
}

// Capture JVM-side errors (printStackTrace, uncaught exceptions, etc.) so they
// surface in the output panel instead of dying silently. CheerpJ writes its
// internal status lines via console.log too, so we filter to lines that look
// like Java exception output or stack frames.
const workerConsole = self.console as Console;
const origConsoleLog = workerConsole.log.bind(workerConsole);
const origConsoleError = workerConsole.error.bind(workerConsole);

function looksLikeJvmError(s: string): boolean {
  return (
    /^\s*at /.test(s) ||
    /Exception|Throwable|Caused by|NoSuchMethod|NoClassDef|StackOverflowError|OutOfMemoryError/.test(s)
  );
}

workerConsole.log = (...a: unknown[]) => {
  origConsoleLog(...a);
  const s = a.map((x) => String(x)).join(" ");
  if (progressRequestId && looksLikeJvmError(s)) {
    post({ kind: "stdout", requestId: progressRequestId, text: "[jvm] " + s.slice(0, 1500) });
  }
};
workerConsole.error = (...a: unknown[]) => {
  origConsoleError(...a);
  const s = a.map((x) => String(x)).join(" ");
  if (progressRequestId && looksLikeJvmError(s)) {
    post({ kind: "stdout", requestId: progressRequestId, text: "[jvm-err] " + s.slice(0, 1500) });
  }
};

// Active request id for progress events. Set by `self.onmessage` for the call
// that triggers the first bridge load (typically `init`), then cleared.
let progressRequestId = 0;

// Wrap fetch to surface byte-level download progress for CheerpJ runtime
// chunks (cj3.wasm) and the bridge JAR. Only the *initial* GET of each tracked
// URL is wrapped — CheerpJ then issues lots of Range requests against the JAR,
// and wrapping those breaks its internal blob handling. We use a one-shot
// flag per URL so a single label is reported once and then the original fetch
// is used for everything else.
const wrappedUrls = new Set<string>();
const originalFetch = self.fetch.bind(self);
self.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const label = labelForUrl(url);
  const hasRange =
    !!init?.headers && hasRangeHeader(init.headers) ||
    (input instanceof Request && input.headers.has("range"));
  if (!progressRequestId || !label || hasRange || wrappedUrls.has(url)) {
    return originalFetch(input as RequestInfo, init);
  }
  wrappedUrls.add(url);
  const res = await originalFetch(input as RequestInfo, init);
  if (!res.body || res.status !== 200) return res;
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? parseInt(totalHeader, 10) : 0;
  const rid = progressRequestId;
  post({ kind: "progress", requestId: rid, label, loaded: 0, total, done: false });
  const reader = res.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let loaded = 0;
      let lastPost = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.byteLength;
          controller.enqueue(value);
          const now = Date.now();
          if (now - lastPost > 100) {
            post({ kind: "progress", requestId: rid, label, loaded, total, done: false });
            lastPost = now;
          }
        }
        post({ kind: "progress", requestId: rid, label, loaded, total, done: false });
      } catch (e) {
        controller.error(e);
        return;
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: res.headers, status: res.status, statusText: res.statusText });
}) as typeof fetch;

function hasRangeHeader(h: HeadersInit): boolean {
  if (h instanceof Headers) return h.has("range");
  if (Array.isArray(h)) return h.some(([k]) => k.toLowerCase() === "range");
  return Object.keys(h).some((k) => k.toLowerCase() === "range");
}

function labelForUrl(url: string): string | null {
  if (url.includes("cj3.wasm")) return "Loading CheerpJ runtime (wasm)…";
  // The bridge JAR comes in via fetchBrotliJar (manual fetch); CheerpJ's own
  // range-fetches against /str/ never hit network, so no other URL is tracked.
  return null;
}

type Bridge = Lib["com"]["chromia"]["rellplayground"]["PlaygroundBridge"];
let bridge: Bridge | null = null;
let loadPromise: Promise<Bridge> | null = null;

function loadBridge(): Promise<Bridge> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    self.importScripts(CHEERPJ_LOADER);
    // version: 17 — bridge JAR is built at Java 17 bytecode (CheerpJ 4.x max).
    await cheerpjInit({ version: 17, status: "none" });
    const jarBytes = await fetchCompressedJar(BRIDGE_JAR_GZ_URL);
    await cheerpOSAddStringFile(BRIDGE_JAR, jarBytes);
    const lib = await cheerpjRunLibrary(BRIDGE_JAR);
    // CheerpJ exposes packages as lazy thenable proxies (not real Promises).
    // The first await on a class chain forces CheerpJ to actually load the
    // class + bind static methods onto the JS object. The cast is needed
    // because the typed shape declares the methods directly, hiding the
    // async resolution step.
    bridge = (await (lib.com.chromia.rellplayground.PlaygroundBridge as unknown as PromiseLike<Bridge>));
    return bridge;
  })();
  return loadPromise;
}

// Fetch the precompressed bridge JAR + pipe through DecompressionStream so
// the wire transfer stays small (~25 MB vs ~89 MB raw). Progress events
// report compressed bytes since that's the wire reality the user is waiting
// on.
async function fetchCompressedJar(url: string): Promise<Uint8Array> {
  const rid = progressRequestId;
  const label = "Loading Rell bridge JAR…";
  const res = await originalFetch(url);
  if (!res.ok || !res.body) throw new Error(`bridge fetch failed: ${res.status}`);
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? parseInt(totalHeader, 10) : 0;
  if (rid) post({ kind: "progress", requestId: rid, label, loaded: 0, total, done: false });

  // Tee the response so we can both count compressed bytes for progress AND
  // feed the same bytes through the Brotli decoder.
  const [counting, decoding] = res.body.tee();
  let loaded = 0;
  let lastPost = 0;
  const countDone = (async () => {
    const reader = counting.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      const now = Date.now();
      if (rid && now - lastPost > 100) {
        post({ kind: "progress", requestId: rid, label, loaded, total, done: false });
        lastPost = now;
      }
    }
  })();

  const decompressed = decoding.pipeThrough(new DecompressionStream("gzip"));
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = decompressed.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await countDone;
  if (rid) post({ kind: "progress", requestId: rid, label, loaded, total, done: false });

  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function forwardEnvelope(requestId: number, raw: string): boolean {
  let env: Envelope;
  try {
    env = JSON.parse(raw) as Envelope;
  } catch {
    post({
      kind: "runtimeError",
      requestId,
      message: `bridge returned non-JSON: ${raw.slice(0, 200)}`,
      stack: null,
    });
    return false;
  }
  for (const e of env.events) {
    switch (e.type) {
      case "stdout":
        post({ kind: "stdout", requestId, text: e.text });
        break;
      case "value":
        post({ kind: "value", requestId, text: e.text });
        break;
      case "control":
        post({ kind: "control", requestId, code: e.code, message: e.message });
        break;
      case "compiler":
        post({
          kind: "compiler",
          requestId,
          severity: e.severity === "warning" ? "warning" : "error",
          code: e.code,
          message: e.message,
          pos: e.pos ?? null,
        });
        break;
      case "runtimeError":
        post({
          kind: "runtimeError",
          requestId,
          message: e.message,
          stack: e.stack ?? null,
        });
        break;
    }
  }
  return env.ok;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  // Tie any in-flight fetch progress / console-captured Java logs to the
  // request that triggered them. Set per-request so JVM stderr after init
  // (e.g. from runFile) is routed back to the *current* listener.
  progressRequestId = req.requestId;
  try {
    const b = bridge ?? (await loadBridge());
    if (!b) throw new Error("CheerpJ bridge failed to load");
    switch (req.kind) {
      case "init":
        // Signal end-of-progress so the UI hides the bar.
        post({ kind: "progress", requestId: req.requestId, label: "", loaded: 0, total: 0, done: true });
        post({ kind: "done", requestId: req.requestId, ok: true });
        return;
      case "version": {
        const v = await b.version();
        post({ kind: "done", requestId: req.requestId, ok: true, result: v });
        return;
      }
      case "runFile": {
        const raw = await b.runFile(req.code);
        const ok = forwardEnvelope(req.requestId, raw);
        post({ kind: "done", requestId: req.requestId, ok });
        return;
      }
      case "replCreate": {
        const id = await b.replCreate();
        post({ kind: "done", requestId: req.requestId, ok: id >= 0, result: id });
        return;
      }
      case "replExecute": {
        const raw = await b.replExecute(req.sessionId, req.command);
        const ok = forwardEnvelope(req.requestId, raw);
        post({ kind: "done", requestId: req.requestId, ok });
        return;
      }
      case "replDispose": {
        await b.replDispose(req.sessionId);
        post({ kind: "done", requestId: req.requestId, ok: true });
        return;
      }
    }
  } catch (e) {
    post({
      kind: "runtimeError",
      requestId: req.requestId,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    post({ kind: "done", requestId: req.requestId, ok: false });
  }
};
