// The compiled binary's main process (src/server/app.ts) calls
// `webview.init("window.__TANDEM_HOST__='native'")` before navigation so this
// flag is set before any React code runs. Absent in a regular browser tab.
export function isNativeApp(): boolean {
  return (
    (globalThis as { __TANDEM_HOST__?: string }).__TANDEM_HOST__ === "native"
  );
}
