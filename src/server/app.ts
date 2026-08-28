import { IS_DARWIN, IS_WINDOWS } from "./platform";
import { COMPILED_WORKER_PATH, isCompiledBun } from "./runtime";

// DYNAMIC, not a static import: webview-bun `dlopen`s the native library at
// MODULE LOAD time, so a missing host webview throws before any of our code
// runs and the failure reaches the terminal as a raw FFI error. On Windows
// that host is the WebView2 runtime, which is not guaranteed to be installed —
// and since `pnpm start` is what serves /api/*, the whole dev loop dies with
// it. Catch it here and name both the cause and the way around it.
//
// `SizeHint` cannot come along: it is a `const enum`, a compile-time-only
// construct with no runtime binding to destructure off the module. Its NONE
// member is 0.
const SIZE_HINT_NONE = 0;

let Webview: typeof import("webview-bun").Webview;
try {
  ({ Webview } = await import("webview-bun"));
} catch (e) {
  const detail = e instanceof Error ? e.message : String(e);
  console.error(
    `[app] could not load the native webview: ${detail}\n` +
      (IS_WINDOWS
        ? "[app] Windows needs the WebView2 runtime: https://developer.microsoft.com/microsoft-edge/webview2/\n"
        : "") +
      "[app] `pnpm serve` runs the same server with no native window (open http://127.0.0.1:5274).",
  );
  process.exit(1);
}

// webview-bun requires the OS native webview to own the main thread. We host
// Bun.serve in a worker and wait for it to postMessage its bound port before
// opening the window.
const workerUrl = isCompiledBun()
  ? COMPILED_WORKER_PATH
  : new URL("./worker.ts", import.meta.url).href;

const worker = new Worker(workerUrl);

const webview = new Webview();
webview.title = "Tandem";
webview.size = { width: 1520, height: 960, hint: SIZE_HINT_NONE };

// Cmd on macOS, Ctrl everywhere else — the Windows key is not a shortcut
// modifier, so a meta-only binding leaves the native app with no quit key at
// all. Kept in step with keyboard/shortcuts.ts, which prints the same choice.
// The two PROPERTY NAMES are chosen here and interpolated into the init script
// below, so the generated JS tests one field instead of re-deciding a
// compile-time fact on every keystroke.
const [QUIT_KEY, QUIT_EXCLUDES] = IS_DARWIN
  ? ["metaKey", "ctrlKey"]
  : ["ctrlKey", "metaKey"];

function openExternalUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const cmd = IS_DARWIN
      ? ["open", url.href]
      : IS_WINDOWS
        ? ["cmd", "/c", "start", "", url.href]
        : ["xdg-open", url.href];
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    return true;
  } catch (e) {
    console.error(
      "[app] external open failed:",
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

webview.bind("tandemOpenExternalUrl", openExternalUrl);
// webview-bun creates no application menu on any platform, so the usual Quit
// command must be bridged from the web content.
webview.bind("tandemQuit", () => process.exit(0));

webview.init(`
  window.__TANDEM_HOST__ = 'native';
  (() => {
    const originalOpen = window.open.bind(window);
    const isExternalHttp = (href) => {
      try {
        const url = new URL(String(href), window.location.href);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== window.location.origin;
      } catch {
        return false;
      }
    };
    window.open = (url, target, features) => {
      if (isExternalHttp(url) && typeof window.tandemOpenExternalUrl === 'function') {
        void window.tandemOpenExternalUrl(String(url));
        return null;
      }
      return originalOpen(url, target, features);
    };
    document.addEventListener('click', (event) => {
      const target = event.target;
      const anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
      if (!anchor || !isExternalHttp(anchor.href) || typeof window.tandemOpenExternalUrl !== 'function') return;
      event.preventDefault();
      void window.tandemOpenExternalUrl(anchor.href);
    }, true);
    document.addEventListener('keydown', (event) => {
      if (!event.${QUIT_KEY} || event.${QUIT_EXCLUDES} || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'q') return;
      if (typeof window.tandemQuit !== 'function') return;
      event.preventDefault();
      void window.tandemQuit();
    }, true);
  })();
`);

let navigated = false;

worker.onmessage = (event: MessageEvent) => {
  const msg = event.data as { type?: string; host?: string; port?: number };
  if (msg?.type === "ready" && msg.host && msg.port && !navigated) {
    navigated = true;
    webview.navigate(`http://${msg.host}:${msg.port}`);
    webview.run();
    worker.terminate();
  }
};

worker.onerror = (event: ErrorEvent) => {
  console.error("[app] worker error:", event.message);
};
