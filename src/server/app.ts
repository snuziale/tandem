import { Webview, SizeHint } from "webview-bun";
import { COMPILED_WORKER_PATH, isCompiledBun } from "./runtime";

// webview-bun requires the OS native webview to own the main thread. We host
// Bun.serve in a worker and wait for it to postMessage its bound port before
// opening the window.
const workerUrl = isCompiledBun()
  ? COMPILED_WORKER_PATH
  : new URL("./worker.ts", import.meta.url).href;

const worker = new Worker(workerUrl);

const webview = new Webview();
webview.title = "Tandem";
webview.size = { width: 1520, height: 960, hint: SizeHint.NONE };

function openExternalUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const cmd =
      process.platform === "darwin"
        ? ["open", url.href]
        : process.platform === "win32"
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
// webview-bun does not create a macOS application menu, so its usual Quit
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
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'q') return;
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
