import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Renders `ui` at `path` inside a router and a fresh QueryClient (no
// retries, so error states show immediately).
export function renderAt(ui: ReactElement, { path = "/", route = "*" }: { path?: string; route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={ui} />
          <Route path="*" element={<p>other page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
