// PR attachments — why a screenshot in a description never loaded.
//
// GitHub puts `https://github.com/user-attachments/assets/<uuid>` into the raw
// markdown `body` the API returns, and a browser can NEVER load that URL: the
// route is authenticated by a github.com SESSION COOKIE (plus SAML for an SSO
// org). An <img> from the app sends no cookie — it is cross-site, and the
// cookie is SameSite=Lax — and a PAT cannot ride on an <img> request at all.
// Unauthenticated it answers 404; with a bearer PAT it answers a sign-in page.
//
// The same asset in GitHub's own `bodyHTML` is a SIGNED
// `private-user-images.githubusercontent.com/...?jwt=` URL that needs no auth
// whatsoever — but the JWT lives 300 seconds, so it cannot be handed to a pane
// that stays open longer than that.
//
// So the two are joined by the uuid, which survives in the signed path as
// `<id>-<uuid>.<ext>`, and the markdown is rewritten to address OUR proxy
// (`/api/prs/:owner/:repo/:number/asset/:uuid`), which re-resolves the signed
// URL per request. The signed URL never leaves the server and never expires in
// anyone's hands.
import { API_PATHS } from "../api-paths";

/** What GitHub rendered the attachment AS — the one thing the markdown can't
 * say for itself. A bare attachment link on its own line is a video player or
 * an image depending on the file, and only bodyHTML knows which. */
export type AttachmentKind = "image" | "video";

export type AttachmentSource = {
  kind: AttachmentKind;
  /** Short-lived, signed, server-side only. */
  signedUrl: string;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The form that appears in raw markdown — the only form we rewrite. */
const ASSET_URL = new RegExp(
  `https?://github\\.com/user-attachments/assets/(${UUID})`,
  "gi",
);
/** A media element in bodyHTML, with the src GitHub signed. */
const MEDIA_TAG = /<(img|video|source)\b[^>]*?\bsrc="([^"]+)"/gi;
/** `/642412877-d76122d3-….mov` — the uuid, kept through the signing. */
const UUID_IN_PATH = new RegExp(`/\\d+-(${UUID})\\.`, "i");
const IS_UUID = new RegExp(`^${UUID}$`, "i");

/** Cheap bail: the substring every rewritable URL contains. */
const ASSET_MARKER = "user-attachments/assets/";

export function isAttachmentUuid(value: string): boolean {
  return IS_UUID.test(value);
}

/** Where the proxy serves this PR's attachments. */
export function attachmentProxyBase(
  owner: string,
  repo: string,
  number: number,
): string {
  return `${API_PATHS.PRS}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}/asset`;
}

/**
 * uuid → signed URL + kind, read out of one or more `bodyHTML` blobs.
 *
 * Regex rather than a parser because this reads exactly two attributes off
 * three tag names in HTML that GitHub itself generated; a DOM would also make
 * the module runtime-bound, and the server needs it as much as the client.
 */
export function attachmentSourcesFromHtml(
  html: string,
): Map<string, AttachmentSource> {
  const sources = new Map<string, AttachmentSource>();
  for (const match of html.matchAll(MEDIA_TAG)) {
    const [, tag, signedUrl] = match;
    const uuid = UUID_IN_PATH.exec(signedUrl)?.[1];
    if (!uuid) continue;
    const kind: AttachmentKind =
      tag.toLowerCase() === "img" ? "image" : "video";
    // A <video> wraps <source>; first tag wins, and it carries the kind.
    if (!sources.has(uuid.toLowerCase()))
      sources.set(uuid.toLowerCase(), { kind, signedUrl });
  }
  return sources;
}

/**
 * Point every resolvable attachment in `markdown` at the proxy.
 *
 * An attachment URL ALONE on a line is what GitHub turns into a player or an
 * embedded image, so that line becomes the element itself; anywhere else the
 * URL is substituted in place, which covers `<img src=…>` (how a pasted
 * screenshot arrives), `![alt](…)` and a plain link alike.
 *
 * A uuid missing from `sources` is left exactly as written — the proxy could
 * not resolve it either, and the untouched link still opens in a browser where
 * the reader IS signed in. That is also what makes this a no-op on a response
 * fetched without `bodyHTML`.
 */
export function rewriteAttachmentUrls(
  markdown: string,
  sources: ReadonlyMap<string, AttachmentSource>,
  proxyBase: string,
): string {
  if (sources.size === 0 || !markdown.includes(ASSET_MARKER)) return markdown;

  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      // A fence flips code on and off; inside one the URL is text the author
      // wrote and rewriting it would corrupt what the block is showing.
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;

      const bare = bareAttachmentUuid(line);
      const source = bare ? sources.get(bare) : undefined;
      if (bare && source) {
        const src = `${proxyBase}/${bare}`;
        return source.kind === "video"
          ? `<video controls src="${src}"></video>`
          : `<img src="${src}" alt="" />`;
      }
      return line.replace(ASSET_URL, (whole, uuid: string) =>
        sources.has(uuid.toLowerCase())
          ? `${proxyBase}/${uuid.toLowerCase()}`
          : whole,
      );
    })
    .join("\n");
}

/** The uuid when the line is nothing but one attachment URL, else null. */
function bareAttachmentUuid(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.includes(ASSET_MARKER)) return null;
  const match = new RegExp(`^${ASSET_URL.source}$`, "i").exec(trimmed);
  return match ? match[1].toLowerCase() : null;
}
