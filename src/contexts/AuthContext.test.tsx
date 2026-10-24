import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  grants: [] as { nav_section: string; allowed: boolean }[] | null,
  grantError: null as { message: string } | null,
  grantReads: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const user = { id: "cs-user" };
  const single = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  return {
    supabase: {
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
        getSession: async () => ({ data: { session: { user } } }),
        signOut: vi.fn(),
      },
      from: (table: string) => {
        if (table === "profiles") return single({ id: "cs-user", full_name: "CS User" });
        if (table === "user_roles") return single({ role: "customer_service" });
        return { select: () => ({ eq: async () => { state.grantReads++; return { data: state.grants, error: state.grantError }; } }) };
      },
    },
  };
});

import { AuthProvider, PERMISSION_REFRESH_MS, useAuth } from "./AuthContext";

function Probe() {
  const { canAccess, profileLoaded } = useAuth();
  return <p>{profileLoaded ? `analytics:${canAccess("analytics")}` : "loading"}</p>;
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const focus = () => act(async () => { window.dispatchEvent(new Event("focus")); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  state.grants = []; state.grantError = null; state.grantReads = 0;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Tab grants for a signed-in user", () => {
  it("shows a tab Admin granted after sign-in when the user comes back to the CRM", async () => {
    mount();
    await screen.findByText("analytics:false");
    state.grants = [{ nav_section: "analytics", allowed: true }];
    later(PERMISSION_REFRESH_MS);
    await focus();
    await screen.findByText("analytics:true");
  });

  it("removes a tab Admin turned off", async () => {
    state.grants = [{ nav_section: "analytics", allowed: true }];
    mount();
    await screen.findByText("analytics:true");
    state.grants = [{ nav_section: "analytics", allowed: false }];
    later(PERMISSION_REFRESH_MS);
    await focus();
    await screen.findByText("analytics:false");
  });

  it("re-reads at most once per interval, however often the tab is focused", async () => {
    mount();
    await screen.findByText("analytics:false");
    const afterSignIn = state.grantReads;
    await focus(); await focus();
    expect(state.grantReads).toBe(afterSignIn);
    later(PERMISSION_REFRESH_MS);
    await focus(); await focus();
    await waitFor(() => expect(state.grantReads).toBe(afterSignIn + 1));
  });

  it("keeps the current grants when the re-read fails", async () => {
    state.grants = [{ nav_section: "analytics", allowed: true }];
    mount();
    await screen.findByText("analytics:true");
    state.grants = null; state.grantError = { message: "network" };
    later(PERMISSION_REFRESH_MS);
    await focus();
    await waitFor(() => expect(state.grantReads).toBe(2));
    expect(screen.getByText("analytics:true")).toBeInTheDocument();
  });
});
