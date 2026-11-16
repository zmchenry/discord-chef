import { Card, PageHeader } from "../components/ui";
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
        <Card className="p-4">
          <p className="m-0 text-muted">Stores, notifications and the Notion import arrive in later phases.</p>
        </Card>
      </div>
    </>
  );
}
