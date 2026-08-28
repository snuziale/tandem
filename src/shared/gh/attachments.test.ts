import { describe, expect, it } from "vitest";
import {
  attachmentProxyBase,
  attachmentSourcesFromHtml,
  isAttachmentUuid,
  rewriteAttachmentUrls,
} from "./attachments";

// Shapes lifted from live PRs (UiPath/flow-workbench#3394, UiPath/Agents#6086,
// UiPath/PO.Frontend#6904) — a signed URL keeps the uuid in its path.
const VIDEO_UUID = "d76122d3-e47f-4d32-8a1c-fab5f684fa55";
const IMAGE_UUID = "2c13a3d3-f781-463b-b12f-cb6caae4195d";
const VIDEO_SIGNED = `https://private-user-images.githubusercontent.com/27439433/642412877-${VIDEO_UUID}.mov?jwt=abc.def.ghi`;
const IMAGE_SIGNED = `https://private-user-images.githubusercontent.com/300803397/640284898-${IMAGE_UUID}.png?jwt=abc.def.ghi`;

const HTML = `
<details><summary>Screen.Recording.mov</summary>
  <video src="${VIDEO_SIGNED}" data-canonical-src="${VIDEO_SIGNED}" controls></video>
</details>
<a href="${IMAGE_SIGNED}"><img width="3840" alt="image" src="${IMAGE_SIGNED}" /></a>
`;

const BASE = attachmentProxyBase("UiPath", "flow-workbench", 3394);

describe("attachmentProxyBase", () => {
  it("addresses the PR the attachment belongs to", () => {
    expect(BASE).toBe("/api/prs/UiPath/flow-workbench/3394/asset");
  });

  it("encodes a repo name that needs it", () => {
    expect(attachmentProxyBase("o", "a b", 1)).toBe("/api/prs/o/a%20b/1/asset");
  });
});

describe("isAttachmentUuid", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(isAttachmentUuid(VIDEO_UUID)).toBe(true);
    expect(isAttachmentUuid("../../etc/passwd")).toBe(false);
    expect(isAttachmentUuid("")).toBe(false);
  });
});

describe("attachmentSourcesFromHtml", () => {
  it("joins uuid to signed URL and records what GitHub rendered", () => {
    const sources = attachmentSourcesFromHtml(HTML);
    expect(sources.get(VIDEO_UUID)).toEqual({
      kind: "video",
      signedUrl: VIDEO_SIGNED,
    });
    expect(sources.get(IMAGE_UUID)).toEqual({
      kind: "image",
      signedUrl: IMAGE_SIGNED,
    });
  });

  it("ignores an href — only a media src is the asset itself", () => {
    expect(
      attachmentSourcesFromHtml(`<a href="${IMAGE_SIGNED}">x</a>`).size,
    ).toBe(0);
  });

  it("is empty for html without attachments", () => {
    expect(attachmentSourcesFromHtml("<p>no media</p>").size).toBe(0);
  });
});

describe("rewriteAttachmentUrls", () => {
  const sources = attachmentSourcesFromHtml(HTML);
  const rewrite = (md: string) => rewriteAttachmentUrls(md, sources, BASE);

  it("turns a bare video link into a player", () => {
    expect(
      rewrite(
        `## Demo\n\nhttps://github.com/user-attachments/assets/${VIDEO_UUID}\n`,
      ),
    ).toBe(`## Demo\n\n<video controls src="${BASE}/${VIDEO_UUID}"></video>\n`);
  });

  it("turns a bare image link into an image", () => {
    expect(
      rewrite(`https://github.com/user-attachments/assets/${IMAGE_UUID}`),
    ).toBe(`<img src="${BASE}/${IMAGE_UUID}" alt="" />`);
  });

  it("substitutes the src of a pasted screenshot in place", () => {
    const md = `<img width="3840" alt="image" src="https://github.com/user-attachments/assets/${IMAGE_UUID}" />`;
    expect(rewrite(md)).toBe(
      `<img width="3840" alt="image" src="${BASE}/${IMAGE_UUID}" />`,
    );
  });

  it("substitutes inside markdown image and link syntax", () => {
    const url = `https://github.com/user-attachments/assets/${IMAGE_UUID}`;
    expect(rewrite(`![shot](${url}) and [a link](${url})`)).toBe(
      `![shot](${BASE}/${IMAGE_UUID}) and [a link](${BASE}/${IMAGE_UUID})`,
    );
  });

  it("leaves an unresolvable uuid exactly as written", () => {
    const md =
      "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000";
    expect(rewrite(md)).toBe(md);
  });

  it("leaves a fenced block alone — that URL is what the code says", () => {
    const url = `https://github.com/user-attachments/assets/${IMAGE_UUID}`;
    const md = `before\n\`\`\`sh\ncurl ${url}\n${url}\n\`\`\`\nafter ${url}`;
    expect(rewrite(md)).toBe(
      `before\n\`\`\`sh\ncurl ${url}\n${url}\n\`\`\`\nafter ${BASE}/${IMAGE_UUID}`,
    );
  });

  it("is a no-op with no sources — a response fetched without bodyHTML", () => {
    const md = `https://github.com/user-attachments/assets/${VIDEO_UUID}`;
    expect(rewriteAttachmentUrls(md, new Map(), BASE)).toBe(md);
  });

  it("is a no-op on markdown with no attachments", () => {
    expect(rewrite("plain **body**")).toBe("plain **body**");
  });
});
