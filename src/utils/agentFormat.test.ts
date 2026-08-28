import { describe, expect, it } from "vitest";
import {
  fileNames,
  formatDuration,
  formatSpend,
  shortPrRef,
} from "./agentFormat";

describe("formatDuration", () => {
  it("stays in seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_400)).toBe("45s");
  });

  it("zero-pads the seconds past a minute", () => {
    expect(formatDuration(63_000)).toBe("1m 03s");
    expect(formatDuration(600_000)).toBe("10m 00s");
  });

  it("never reports negative time", () => {
    expect(formatDuration(-5_000)).toBe("0s");
  });
});

describe("formatSpend", () => {
  it("prints dollars when the CLI reported a cost", () => {
    expect(formatSpend({ costUsd: 0.42, tokensUsed: 12_000 })).toBe("$0.42");
  });

  it("falls back to tokens on a subscription-billed $0 run", () => {
    expect(formatSpend({ costUsd: 0, tokensUsed: 12_400 })).toBe("12k tok");
  });
});

describe("shortPrRef", () => {
  it("drops the owner", () => {
    expect(shortPrRef("acme/widgets#128")).toBe("widgets#128");
  });

  it("leaves an unrecognized id alone", () => {
    expect(shortPrRef("widgets#128")).toBe("widgets#128");
  });
});

describe("fileNames", () => {
  it("is empty for no paths", () => {
    expect(fileNames(undefined)).toBe("");
    expect(fileNames([])).toBe("");
  });

  it("keeps only basenames", () => {
    expect(fileNames(["src/server/run.ts", "parse.ts"])).toBe(
      "run.ts · parse.ts",
    );
  });
});
