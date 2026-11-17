const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// 1850 -> "1,850"
export const fmt = (n: number) => int.format(n);

// 1.5 -> "1.5 servings", 1 -> "1 serving"
export const servings = (n: number) => `${n} serving${n === 1 ? "" : "s"}`;

// One colour per person, in household order: tokens only.
const PERSON_FILL = ["bg-primary", "bg-accent"] as const;
export const personFill = (i: number) => PERSON_FILL[i % PERSON_FILL.length];

export const CONFIDENCE_LABEL = { high: "Good estimate", medium: "Rough estimate", low: "Very rough estimate" } as const;
