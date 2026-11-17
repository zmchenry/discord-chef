import { Sparkles } from "lucide-react";
import { useState } from "react";

import { FindIdeasModal } from "./FindIdeasModal";

// The guided dinner flow's way out to new recipes: a quiet link under the
// day's ideas that opens Find ideas for that day's theme.
export function FindNewForTheme({ theme }: { theme: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full bg-transparent px-1 text-sm font-semibold text-primary"
      >
        <Sparkles size={16} aria-hidden="true" />
        Find something new for {theme}
      </button>
      <FindIdeasModal open={open} onClose={() => setOpen(false)} theme={theme} showResults />
    </>
  );
}
