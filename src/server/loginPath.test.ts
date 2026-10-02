import { describe, expect, it } from "vitest";
import { mergePath, parseShellPath } from "./loginPath";

describe("mergePath", () => {
  it("puts the login shell's order first and only ever adds entries", () => {
    expect(
      mergePath("/usr/bin:/bin:/opt/extra", "/Users/me/.local/bin:/usr/bin"),
    ).toBe("/Users/me/.local/bin:/usr/bin:/bin:/opt/extra");
  });

  it("survives an empty current PATH and stray separators", () => {
    expect(mergePath(undefined, "/a::/b:")).toBe("/a:/b");
  });
});

describe("parseShellPath", () => {
  it("reads the PATH after the marker, ignoring rc-file noise", () => {
    expect(
      parseShellPath(
        "Welcome to zsh!\n__TANDEM_PATH__/a:/b\nlast login: today\n",
      ),
    ).toBe("/a:/b");
  });

  it("is null when the shell printed no marker", () => {
    expect(parseShellPath("command not found")).toBeNull();
    expect(parseShellPath("__TANDEM_PATH__\n")).toBeNull();
  });
});
