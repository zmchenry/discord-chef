import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { tagLabel } from "../../../../shared/normalize";
import { findTechniques, TECHNIQUES, type Flavor } from "../../../../shared/recipeStructure";
import { Modal } from "../../components/Modal";
import { cx } from "../../lib/cx";

// The small pills on recipe screens: flavor roles, tags and technique words.

// A fixed flavor -> tint mapping (tints are pill fills only, tokens.css).
// Fat and crunchy are outlined: they are about texture and richness more
// than taste.
const FLAVOR_TINT: Record<Flavor, string> = {
  spicy: "bg-tint-red text-tint-red-ink",
  umami: "bg-tint-orange text-tint-orange-ink",
  sour: "bg-tint-yellow text-tint-yellow-ink",
  fresh: "bg-tint-green text-tint-green-ink",
  bitter: "bg-tint-teal text-tint-teal-ink",
  salty: "bg-tint-blue text-tint-blue-ink",
  pungent: "bg-tint-purple text-tint-purple-ink",
  sweet: "bg-tint-pink text-tint-pink-ink",
  creamy: "bg-surface-2 text-text",
  fat: "bg-transparent text-muted shadow-[inset_0_0_0_1px_currentColor]",
  crunchy: "bg-transparent text-tint-orange-ink shadow-[inset_0_0_0_1px_currentColor]",
};

export function FlavorPill({ flavor }: { flavor: Flavor }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-bold uppercase leading-none tracking-wider",
        FLAVOR_TINT[flavor],
      )}
    >
      {flavor}
    </span>
  );
}

// Tag pills are outlined, their border colour picked from the tag itself so
// a tag looks the same on every screen.
const TAG_BORDERS = [
  "border-tint-red-ink",
  "border-tint-blue-ink",
  "border-tint-green-ink",
  "border-tint-purple-ink",
  "border-tint-orange-ink",
  "border-tint-teal-ink",
];

function tagBorder(tag: string): string {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_BORDERS[h % TAG_BORDERS.length]!;
}

export function TagPill({ tag, size = "md" }: { tag: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full border-[1.5px] font-bold uppercase leading-none tracking-wider text-text",
        size === "sm" ? "px-2 py-[3px] text-[10.5px]" : "px-3 py-1.5 text-xs",
        tagBorder(tag),
      )}
    >
      {tagLabel(tag)}
    </span>
  );
}

// A tag that opens the recipe list filtered by it.
export function TagLink({ tag }: { tag: string }) {
  return (
    <Link to={`/recipes?tag=${encodeURIComponent(tag)}`} className="pressable inline-flex min-h-11 items-center no-underline">
      <TagPill tag={tag} />
    </Link>
  );
}

// Step text with each technique word as an outlined pill; a tap explains it.
export function TechniqueText({ text }: { text: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const spans = findTechniques(text);
  if (!spans.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  spans.forEach((s, n) => {
    if (s.start > at) parts.push(text.slice(at, s.start));
    parts.push(
      <button
        key={n}
        type="button"
        onClick={() => setOpen(s.key)}
        aria-haspopup="dialog"
        data-inline-target
        className="pressable relative mx-px inline rounded-full border border-border bg-transparent px-1.5 py-px align-baseline text-[0.95em] font-semibold leading-snug text-text after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-['']"
      >
        {s.term}
      </button>,
    );
    at = s.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  const t = open ? TECHNIQUES[open] : undefined;
  return (
    <>
      {parts}
      <Modal
        open={!!t}
        size="sm"
        onClose={() => setOpen(null)}
        title={t?.label}
        description={t?.definition}
        primary={{ label: "Got it", onClick: () => setOpen(null) }}
      />
    </>
  );
}
