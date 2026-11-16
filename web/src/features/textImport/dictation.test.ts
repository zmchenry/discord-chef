import { describe, expect, it } from "vitest";

import { joinText, transcriptOf } from "./dictation";

const results = (...ts: string[]) => Object.assign(ts.map((t) => ({ isFinal: true, 0: { transcript: t } })), { length: ts.length });

describe("dictation text", () => {
  it.each([
    [["chili crisp", " ingredients 1 lb beef"], "chili crisp ingredients 1 lb beef"],
    // Chrome on Android repeats earlier results in each new one.
    [["brown", "brown the", "brown the beef"], "brown the beef"],
  ])("transcriptOf(%j)", (parts, expected) => {
    expect(transcriptOf(results(...parts))).toBe(expected);
  });

  it("appends to what is already typed", () => {
    expect(joinText("Beef chili crisp.", "ingredients")).toBe("Beef chili crisp. ingredients");
    expect(joinText("", "ingredients")).toBe("ingredients");
  });
});
