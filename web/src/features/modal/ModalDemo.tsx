import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Modal, MultiStepModal, type ModalStep } from "../../components/Modal";
import { Button, PageHeader } from "../../components/ui";

// Dev-only page (mounted under import.meta.env.DEV) to look at the modal
// layouts. ?show=additional|plain|steps|many opens one straight away.
type Which = "additional" | "plain" | "steps" | "many" | null;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const steps: ModalStep[] = [
  { id: "sun", label: "Sun", title: "Sunday dinner", description: "Pick something for Sunday.", render: () => <Lorem n={2} /> },
  {
    id: "mon",
    label: "Mon",
    title: "Monday dinner",
    description: "A quick one: you're both home late.",
    render: ({ index, count }) => (
      <div className="grid gap-3">
        <p className="m-0">
          Step {index + 1} of {count}. Going back keeps what you picked.
        </p>
        <Lorem n={3} />
      </div>
    ),
    onNext: () => wait(600),
    additional: [{ label: "Skip", onClick: () => {} }],
  },
  { id: "bl", label: "B & L", title: "Breakfast and lunch", render: () => <Lorem n={2} /> },
  { id: "review", label: "Review", title: "Review the week", description: "Check it over, then save.", render: () => <Lorem n={1} /> },
];

const many: ModalStep[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "B & L", "Review"].map((label) => ({
  id: label,
  label,
  title: label === "Review" ? "Review the week" : `${label} dinner`,
  render: () => <Lorem n={1} />,
}));

export function ModalDemo() {
  const [params] = useSearchParams();
  const [which, setWhich] = useState<Which>((params.get("show") as Which) ?? null);
  const close = () => setWhich(null);

  return (
    <div className="grid gap-3 px-4">
      <PageHeader title="Modal demo" />
      <Button onClick={() => setWhich("additional")}>With additional actions</Button>
      <Button variant="secondary" onClick={() => setWhich("plain")}>
        Without additional actions
      </Button>
      <Button variant="secondary" onClick={() => setWhich("steps")}>
        Multi-step
      </Button>

      <Modal
        open={which === "additional"}
        onClose={close}
        title="Replan this week?"
        description="Auto-fill picks new meals around the ones you keep, using your calendar and themes."
        primary={{ label: "Replan", onClick: () => wait(800).then(close) }}
        secondary={{ label: "Cancel", onClick: close }}
        additional={[{ label: "Keep only locked", onClick: close }]}
      >
        <Lorem n={1} />
      </Modal>

      <Modal
        open={which === "plain"}
        onClose={close}
        size="sm"
        title="Delete “Chicken tikka masala”?"
        description="It will disappear from your recipes."
        primary={{ label: "Delete", icon: Trash2, destructive: true, onClick: close }}
        secondary={{ label: "Cancel", onClick: close }}
      />

      <MultiStepModal
        open={which === "steps"}
        onClose={close}
        steps={steps}
        finishLabel="Save the week"
        onFinish={close}
      />
      <MultiStepModal open={which === "many"} onClose={close} steps={many} onFinish={close} />
    </div>
  );
}

function Lorem({ n }: { n: number }) {
  return (
    <div className="grid gap-2 text-muted">
      {Array.from({ length: n }, (_, i) => (
        <p key={i} className="m-0">
          Sheet-pan gnocchi with sausage and peppers, or a big pot of chili that covers Tuesday lunch too. Leftovers count
          as a meal.
        </p>
      ))}
    </div>
  );
}
