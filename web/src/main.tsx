import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { ApiError } from "./lib/api";
import "./index.css";
import { applyAppearance, readAppearance } from "./lib/appearance";
import { installFriendlyContractErrors, onContractError, startFreshnessChecks } from "./lib/freshness";

installFriendlyContractErrors();

const queryClient = new QueryClient({
  // An old app reading a newer API: load the new app (see lib/freshness).
  queryCache: new QueryCache({ onError: (err) => void onContractError(err) }),
  mutationCache: new MutationCache({ onError: (err) => void onContractError(err) }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 4xx will not fix itself on retry.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// Production only: in dev the service worker's caching would fight Vite HMR.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.error("service worker registration failed", err));
  });
  startFreshnessChecks();
}

// Re-apply the saved palette (index.html already did) and sync the status bar colour.
applyAppearance(readAppearance());
