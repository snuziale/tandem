import { describe, expect, it } from "vitest";
import { buildClaudeArgs, parseFrame, READ_ONLY_TOOLS } from "./claude";

describe("buildClaudeArgs", () => {
  it("gives a plain pass NO tools", () => {
    const args = buildClaudeArgs("claude", "sonnet");
    const i = args.indexOf("--tools");
    expect(args[i + 1]).toBe("");
    expect(args).toContain("--safe-mode");
    expect(args).not.toContain("--restricted");
    expect(args).not.toContain("--max-turns");
  });

  it("gives a checkout pass exactly the read-only set, confined and capped", () => {
    const args = buildClaudeArgs("claude", "sonnet", {
      checkout: { maxTurns: 20 },
    });
    const i = args.indexOf("--tools");
    expect(args[i + 1]).toBe("Read,Grep,Glob");
    expect(args).toContain("--restricted");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--safe-mode");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("20");
    // One --tools only: a second would be a second opinion on the toolset.
    expect(args.filter((a) => a === "--tools")).toHaveLength(1);
  });

  it("never lets the read-only set grow a writer or a shell", () => {
    for (const tool of ["Bash", "Edit", "Write", "WebFetch", "NotebookEdit"])
      expect(READ_ONLY_TOOLS).not.toContain(tool);
  });
});

describe("parseFrame", () => {
  it("reads tool calls off an assistant message", () => {
    const frame = parseFrame(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "checking" },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/w/a.ts" },
            },
          ],
        },
      }),
    );
    expect(frame).toEqual({
      kind: "tools",
      uses: [{ name: "Read", input: { file_path: "/w/a.ts" } }],
    });
  });

  it("keeps what a failed pass cost", () => {
    const frame = parseFrame(
      JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        total_cost_usd: 0.4,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    expect(frame).toEqual({
      kind: "error",
      message: "claude: max turns reached",
      tokens: 15,
      costUsd: 0.4,
    });
  });
});
