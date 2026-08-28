import { describe, expect, it } from "vitest";
import { emptyPulseCounts } from "./pulse";
import {
  dayKeyOf,
  emptyJournal,
  pruneJournal,
  recordSnapshot,
  seriesOf,
  validateJournal,
} from "./pulse-journal";

function snapshot(day: string, blockedOnYou: number) {
  return {
    day,
    total: blockedOnYou,
    counts: { ...emptyPulseCounts(), "blocked-on-you": blockedOnYou },
  };
}

describe("dayKeyOf", () => {
  it("formats a local calendar day", () => {
    expect(dayKeyOf(new Date(2026, 7, 3, 23, 30))).toBe("2026-08-03");
  });
});

describe("recordSnapshot", () => {
  it("appends a new day", () => {
    const journal = recordSnapshot(
      emptyJournal(),
      "v1",
      snapshot("2026-08-26", 3),
    );
    expect(seriesOf(journal, "v1")).toHaveLength(1);
  });

  // Every 60s poll is a better reading than the last, so the day keeps one row.
  it("replaces the same day rather than appending", () => {
    let journal = recordSnapshot(
      emptyJournal(),
      "v1",
      snapshot("2026-08-26", 3),
    );
    journal = recordSnapshot(journal, "v1", snapshot("2026-08-26", 5));
    const series = seriesOf(journal, "v1");
    expect(series).toHaveLength(1);
    expect(series[0].counts["blocked-on-you"]).toBe(5);
  });

  it("keeps days sorted and trims to the cap, oldest first", () => {
    let journal = emptyJournal();
    for (const day of ["2026-08-03", "2026-08-01", "2026-08-02"])
      journal = recordSnapshot(journal, "v1", snapshot(day, 1), 2);
    expect(seriesOf(journal, "v1").map((s) => s.day)).toEqual([
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("keeps views apart", () => {
    let journal = recordSnapshot(
      emptyJournal(),
      "v1",
      snapshot("2026-08-26", 1),
    );
    journal = recordSnapshot(journal, "v2", snapshot("2026-08-26", 9));
    expect(seriesOf(journal, "v1")[0].total).toBe(1);
    expect(seriesOf(journal, "v2")[0].total).toBe(9);
  });
});

describe("seriesOf", () => {
  it("returns the last n days when asked", () => {
    let journal = emptyJournal();
    for (const day of ["2026-08-01", "2026-08-02", "2026-08-03"])
      journal = recordSnapshot(journal, "v1", snapshot(day, 1));
    expect(seriesOf(journal, "v1", 2).map((s) => s.day)).toEqual([
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("is empty for an unknown view", () => {
    expect(seriesOf(emptyJournal(), "nope")).toEqual([]);
  });
});

describe("pruneJournal", () => {
  it("drops series for views that no longer exist", () => {
    let journal = recordSnapshot(
      emptyJournal(),
      "v1",
      snapshot("2026-08-26", 1),
    );
    journal = recordSnapshot(journal, "gone", snapshot("2026-08-26", 1));
    expect(Object.keys(pruneJournal(journal, ["v1"]).series)).toEqual(["v1"]);
  });
});

describe("validateJournal", () => {
  it("rejects junk without throwing", () => {
    expect(validateJournal(null)).toEqual(emptyJournal());
    expect(validateJournal({ series: 4 })).toEqual(emptyJournal());
  });

  it("drops rows without a real day key", () => {
    const journal = validateJournal({
      series: {
        v1: [{ day: "yesterday", counts: {} }, snapshot("2026-08-26", 2)],
      },
    });
    expect(seriesOf(journal, "v1").map((s) => s.day)).toEqual(["2026-08-26"]);
  });

  it("fills missing counts with zero and derives a missing total", () => {
    const journal = validateJournal({
      series: { v1: [{ day: "2026-08-26", counts: { rotting: 4 } }] },
    });
    const row = seriesOf(journal, "v1")[0];
    expect(row.counts).toEqual({ ...emptyPulseCounts(), rotting: 4 });
    expect(row.total).toBe(4);
  });
});
