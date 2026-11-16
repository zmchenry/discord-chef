import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReasonText } from "./ReasonText";

describe("ReasonText", () => {
  it.each([
    ["Kids Music 3:30–6:30 → 25 min or less", "Kids Music 3:30–6:30 to 25 min or less", 1],
    ["Zach away → cook for 1", "Zach away to cook for 1", 1],
    ["Uses cilantro from Mon", "Uses cilantro from Mon", 0],
  ])("%s", (text, spoken, arrows) => {
    const { container } = render(<ReasonText text={text} />);
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(spoken);
    expect(container.textContent).not.toContain("→");
    expect(container.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(arrows);
  });
});
