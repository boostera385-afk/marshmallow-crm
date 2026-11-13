import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ExtensionUpdateStatus from "./ExtensionUpdateStatus";
import type { AppRole } from "@/types";

const mocks = vi.hoisted(() => ({
  role: "admin" as AppRole | null,
  releaseRead: vi.fn(),
  installedRead: vi.fn(),
  release: { name: "Donut", version: "1.5.0", releasedAt: "2026-10-10T04:00:00Z", summary: "Update notices" },
  installed: { version: "1.4.0" } as { version: string } | null,
  toast: Object.assign(vi.fn(), { dismiss: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "test-user" }, role: mocks.role, canAccess: () => true }) }));
vi.mock("@/hooks/useExtensionRelease", () => ({ useExtensionRelease: () => { mocks.releaseRead(); return { data: mocks.release }; } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => { mocks.installedRead(); return { data: mocks.installed, isPending: false }; } }));
vi.mock("@/components/leads/InstallExtensionDialog", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
beforeEach(() => { localStorage.clear(); mocks.role = "admin"; mocks.installed = { version: "1.4.0" }; mocks.release.version = "1.5.0"; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("automatic extension update notices", () => {
  it.each(["opr", "opr_admin", null] as const)("hides Donut and does no release/detection work for %s", (role) => {
    mocks.role = role;
    render(<ExtensionUpdateStatus />);
    expect(screen.queryByRole("button", { name: "Donut extension version and update instructions" })).not.toBeInTheDocument();
    expect(mocks.releaseRead).not.toHaveBeenCalled();
    expect(mocks.installedRead).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("unmounts the controls and dismisses the notice when the role becomes Operator", () => {
    const { rerender } = render(<ExtensionUpdateStatus />);
    expect(screen.getByRole("button", { name: "Donut extension version and update instructions" })).toBeVisible();
    mocks.role = "opr_admin";
    rerender(<ExtensionUpdateStatus />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.toast.dismiss).toHaveBeenCalledWith("donut-release-notice:test-user:1.5.0");
  });
  it("notifies outdated users with installed/latest versions and manual update instructions", () => {
    render(<ExtensionUpdateStatus />);
    expect(mocks.toast).toHaveBeenCalledWith("Please update your Donut extension", expect.objectContaining({
      description: expect.stringContaining("Installed: v1.4.0. Latest: v1.5.0"),
      action: expect.objectContaining({ label: "Update instructions" }),
    }));
    expect(screen.getByLabelText("Update available")).toBeInTheDocument();
  });

  it("does not nag users whose installed version is current or newer", () => {
    mocks.installed = { version: "1.6.0" };
    render(<ExtensionUpdateStatus />);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });

  it("reports unknown versions honestly and sends another notice for the next release", () => {
    mocks.installed = null;
    const first = render(<ExtensionUpdateStatus />);
    expect(mocks.toast).toHaveBeenCalledWith("A new Donut extension release is available", expect.objectContaining({
      description: expect.stringContaining("Installed version could not be detected"),
    }));
    first.unmount();
    render(<ExtensionUpdateStatus />).unmount();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    mocks.release.version = "1.6.0";
    render(<ExtensionUpdateStatus />);
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });
});
