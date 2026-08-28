// Which modifier the app PRINTS. The dispatchers all accept `metaKey ||
// ctrlKey` already, so this changes no binding — it only stops a Windows or
// Linux user reading "⌘↵" for a key their keyboard does not have. Resolved
// once at module load: nobody changes platform mid-session.
//
// `navigator.platform` is deprecated but is the only synchronous signal that
// works in both a browser tab and the WKWebView/WebView2 host; userAgentData
// is Chromium-only and the UA string is the documented fallback for it.
function detectMac(): boolean {
  const nav: Navigator | undefined = globalThis.navigator;
  if (!nav) return false;
  const hinted = (nav as { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const source = hinted ?? nav.platform ?? nav.userAgent ?? "";
  return /mac/i.test(source);
}

export const IS_MAC = detectMac();

/** The command modifier, as printed. ⌘ on macOS, Ctrl everywhere else. */
export const MOD = IS_MAC ? "⌘" : "Ctrl+";

/** The option/alt modifier, as printed. Same key, two names. */
export const ALT = IS_MAC ? "⌥" : "Alt+";
