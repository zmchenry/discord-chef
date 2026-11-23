import { Card, PageHeader } from "../components/ui";
import { SettingsLink } from "../features/planning/SettingsLink";
import { useMe } from "../lib/queries";

export function MorePage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="More" />
      <div className="grid gap-3 px-4">
        <Card className="p-4">
          <h2 className="m-0 text-lg">Signed in</h2>
          <p className="m-0 mt-1 break-words text-muted">
            {me.isPending ? "Checking…" : me.isError ? "Not signed in" : me.data.email}
          </p>
        </Card>
        <SettingsLink to="/more/pantry" title="Pantry" hint="What's already in the house" />
        <SettingsLink to="/more/notifications" title="Notifications" hint="Reminders and what's cooking" />
        <SettingsLink to="/more/breakfast-lunch" title="Breakfast & lunch" hint="Breakfast rotation and lunch staples" />
        <SettingsLink to="/more/themes" title="Day themes" hint="Taco Tuesday and friends" />
        <SettingsLink to="/more/calendar" title="Calendar" hint="Family calendar and household" />
        <SettingsLink to="/plan/scratch" title="Day scratch pad" hint="Try meal combos against your macros" />
        <SettingsLink to="/more/goals" title="Goals" hint="Daily calories and protein for each of you" />
        <SettingsLink to="/more/appearance" title="Appearance" hint="Tomato Diner or Sage, light or dark" />
      </div>
    </>
  );
}
