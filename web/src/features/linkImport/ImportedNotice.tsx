import { Info } from "lucide-react";

import { Card } from "../../components/ui";
import type { ImportedDraft } from "./draft";

function host(url: string | null | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "the link";
  } catch {
    return "the link";
  }
}

// Shown above the prefilled recipe form after a link import.
export function ImportedNotice({ imported }: { imported: ImportedDraft }) {
  return (
    <Card className="flex gap-3 p-4">
      <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
      <div className="grid gap-1">
        <p className="m-0 font-semibold">Imported from {host(imported.draft.sourceUrl)}</p>
        <p className="m-0 text-sm text-muted">Check it over and fix anything that looks off, then save.</p>
        {imported.warnings.length > 0 && (
          <ul className="m-0 grid gap-1 pl-5 text-sm">
            {imported.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
