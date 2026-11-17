import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { householdMembersSchema, type Member } from "../../../../shared/household";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

const PATH = "/api/settings/household-members";

async function call(init?: { method: "PUT"; body: unknown }, signal?: AbortSignal): Promise<Member[]> {
  const res = await fetch(PATH, {
    method: init?.method ?? "GET",
    headers: init ? { "content-type": "application/json" } : undefined,
    body: init ? JSON.stringify(init.body) : undefined,
    signal,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = errorResponseSchema.safeParse(await res.json());
      if (parsed.success) message = parsed.data.error;
    } catch {
      // Not JSON.
    }
    throw new ApiError(res.status, message);
  }
  return householdMembersSchema.parse(await res.json()).members;
}

export const householdKey = ["settings", "household-members"] as const;

export const useMembers = () => useQuery({ queryKey: householdKey, queryFn: ({ signal }) => call(undefined, signal) });

export function useSaveMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (members: Member[]) => call({ method: "PUT", body: { members } }),
    onSuccess: (saved) => {
      qc.setQueryData(householdKey, saved);
      // Portions and shopping amounts follow the household.
      void qc.invalidateQueries({ queryKey: ["nutrition", "week"] });
    },
  });
}
