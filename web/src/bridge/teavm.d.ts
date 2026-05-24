// Type declaration for the TeaVM-generated bridge module loaded at runtime from
// /public/teavm/. Vite refuses a static `import` of /public assets, so worker.ts uses a
// dynamic `import(/* @vite-ignore */ "/teavm/...")` to bypass static analysis. The
// declaration below is purely to keep TypeScript's type checker quiet — the runtime
// resolution is handled by the browser's native ESM loader against the URL.

declare module "/teavm/rell-playground-bridge.js" {
  export function version(): string;
  export function runFile(code: string): string;
  export function runModule(code: string): string;
  export function replCreate(): number;
  export function replExecute(sessionId: number, command: string): string;
  export function replDispose(sessionId: number): void;
}
