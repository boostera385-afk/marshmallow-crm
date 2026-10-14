import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TechUpdateRequestButton from "./TechUpdateRequestButton";

const mocks = vi.hoisted(() => ({ role: "customer_service", create: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("@/lib/cx-update-requests", () => ({ createUpdateRequest: mocks.create }));
vi.mock("@/hooks/useCxUpdates", () => ({ UPDATE_QUERY_KEY: ["lead-update-requests"] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const mount = () => render(<QueryClientProvider client={new QueryClient()}><TechUpdateRequestButton leadId="lead" customerName="Synthetic Customer" /></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => { mocks.role = "customer_service"; mocks.create.mockReset(); });

it("is offered only to Customer Service roles", () => {
  for (const role of ["customer_service", "cs_admin"]) { mocks.role = role; const view = mount(); expect(screen.getByRole("button", { name: "Get Tech Update" })).toBeInTheDocument(); view.unmount(); }
  for (const role of ["admin", "processor", "opr"]) { mocks.role = role; const view = mount(); expect(screen.queryByRole("button", { name: "Get Tech Update" })).toBeNull(); view.unmount(); }
});

it("sends a typed tech request through the shared endpoint", async () => {
  mocks.create.mockResolvedValue({ saved: true });
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "00000000-0000-4000-8000-000000000001" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Get Tech Update" }));
  fireEvent.change(screen.getByLabelText("Required technician update"), { target: { value: "Confirm technician ETA" } });
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.create).toHaveBeenCalledWith("tech", "lead", "00000000-0000-4000-8000-000000000001", "Confirm technician ETA");
});
