import { describe, expect, it } from "vitest";
import { parseSiteDate, resolveDay, todayInIsrael } from "../src/dates.js";

// Tuesday 29/09/2026, 22:00 in Israel
const now = new Date("2026-09-29T19:00:00Z");

describe("dates", () => {
  it("parses the site's dd/MM/yyyy dates", () => {
    expect(parseSiteDate("01/10/2026")).toBe("2026-10-01");
  });

  it("uses Israel's calendar day", () => {
    expect(todayInIsrael(new Date("2026-09-29T22:30:00Z"))).toBe("2026-09-30");
  });

  it.each(["thursday", "Thursday", "next thursday", "thu", "חמישי", "יום חמישי"])("resolves %s to the next two Thursdays", input => {
    expect(resolveDay(input, now)).toEqual(["2026-10-01", "2026-10-08"]);
  });

  it("never resolves a weekday to today", () => {
    expect(resolveDay("tuesday", now)).toEqual(["2026-10-06", "2026-10-13"]);
  });

  it("passes explicit dates through", () => {
    expect(resolveDay("2026-10-08", now)).toEqual(["2026-10-08"]);
    expect(resolveDay("8/10/2026", now)).toEqual(["2026-10-08"]);
  });

  it("rejects unknown input", () => {
    expect(() => resolveDay("someday", now)).toThrow(/Unrecognized day/);
  });

  it.each(["constructor", "toString"])("rejects the inherited property name %s", name => {
    expect(() => resolveDay(name, now)).toThrow(expect.objectContaining({ code: "BAD_DATE" }));
  });
});
