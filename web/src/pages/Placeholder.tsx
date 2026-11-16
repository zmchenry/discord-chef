import type { ReactNode } from "react";

import { Card, PageHeader } from "../components/ui";

// Week, Shop and More are placeholders until their phases land.
export function PlaceholderPage({ title, phase, children }: { title: string; phase: string; children: ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="px-4">
        <Card className="p-4">
          <p className="m-0">{children}</p>
          <p className="m-0 mt-2 text-sm text-muted">Coming in {phase}.</p>
        </Card>
      </div>
    </>
  );
}

export const WeekPage = () => (
  <PlaceholderPage title="This week" phase="phase 3">
    Breakfast, lunch and dinner for seven days, filled by hand or automatically.
  </PlaceholderPage>
);

export const ShopPage = () => (
  <PlaceholderPage title="Shopping" phase="phase 4">
    The week's shopping list, sorted by aisle for your store.
  </PlaceholderPage>
);
