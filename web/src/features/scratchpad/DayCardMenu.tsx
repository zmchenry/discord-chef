import { FlaskConical } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { OverflowMenu } from "../../components/OverflowMenu";

// The day card's ⋯: open the scratch pad on that day, started from its plan.
export function DayCardMenu({ date, title }: { date: string; title: string }) {
  const navigate = useNavigate();
  return (
    <OverflowMenu
      title={title}
      items={[
        {
          label: "Try combos for this day",
          icon: FlaskConical,
          hint: "Day scratch pad",
          onSelect: () => navigate(`/plan/scratch?date=${date}`),
        },
      ]}
    />
  );
}
