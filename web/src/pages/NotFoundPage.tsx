import { LinkButton, StateMessage } from "../components/ui";

export const NotFoundPage = () => (
  <StateMessage title="Nothing here">
    <LinkButton to="/week" className="mt-2">
      Go to this week
    </LinkButton>
  </StateMessage>
);
