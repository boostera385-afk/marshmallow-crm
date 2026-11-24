import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

const state = vi.hoisted(() => ({ pendingStep: null as null | "mfa" | "access_code" }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {}, functions: {} } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  session: null, markFullyAuthenticated: vi.fn(), pendingStep: state.pendingStep, pendingUserId: null,
  pendingMfaFactorId: null, startPendingAccessCode: vi.fn(), startPendingMfa: vi.fn(), clearPendingAuth: vi.fn(),
  hasAlternativeMfa: false, hasAlternativeAccessCode: false,
}) }));
vi.mock("@/assets/marshmallow-logo.png.asset.json", () => ({ default: { url: "/logo.png" } }));

afterEach(() => { cleanup(); state.pendingStep = null; });

describe("Login copyright notice", () => {
  it.each([null, "mfa", "access_code"] as const)("shows exactly one Pastry Marketing notice (step: %s)", (step) => {
    state.pendingStep = step;
    render(<Login />);
    const footers = screen.getAllByRole("contentinfo");
    expect(footers).toHaveLength(1);
    expect(footers[0]).toHaveTextContent(/© \d{4} Pastry Marketing\. All rights reserved\./);
    // The left panel no longer carries a second, conflicting © line.
    expect(screen.queryByText(/© \d{4} Marshmallow/)).toBeNull();
  });

  it.each([
    [null, "Sign In"],
    ["mfa", "Verify"],
    ["access_code", "Verify Code"],
  ] as const)("uses the Pastry brand colours, not the app's default blue (step: %s)", (step, button) => {
    state.pendingStep = step;
    const { container } = render(<Login />);
    const action = screen.getByRole("button", { name: new RegExp(`^${button}`) });
    expect(action).toHaveClass("bg-pastry-lime", "text-pastry-navy");
    // The old blue/purple theme is gone from every sign-in screen.
    expect(container.innerHTML).not.toMatch(/animated-gradient|260,75%,58%|text-primary-foreground/);
    if (step === null) {
      expect(container.querySelector(".pastry-panel")).not.toBeNull();
      expect(screen.getByText("precision.")).toHaveClass("text-pastry-lime");
    }
  });
});
