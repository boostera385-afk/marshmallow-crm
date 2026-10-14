import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CxUpdateRequestButton from "./CxUpdateRequestButton";
const mocks = vi.hoisted(() => ({ role: "processor", create: vi.fn(), success: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("@/lib/cx-update-requests", () => ({ createCxRequest: mocks.create }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
const mount = () => render(<QueryClientProvider client={new QueryClient()}><CxUpdateRequestButton leadId="lead" customerName="Synthetic Customer" /></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => { mocks.role = "processor"; mocks.create.mockReset(); mocks.success.mockReset(); Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "00000000-0000-4000-8000-000000000001" }); });
it("does not offer requests to CS or Operators", () => {
  for (const role of ["customer_service", "cs_admin", "opr", "opr_admin"]) { mocks.role = role; const view = mount(); expect(screen.queryByRole("button", { name: "Get CX Update" })).toBeNull(); view.unmount(); }
});
it("requires text, blocks double submission, and closes only after save acknowledgement", async () => {
  let finish: () => void;
  mocks.create.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  mount(); fireEvent.click(screen.getByRole("button", { name: "Get CX Update" }));
  expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Required customer update"), { target: { value: " Confirm Friday " } });
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledWith("lead", "00000000-0000-4000-8000-000000000001", "Confirm Friday");
  finish(); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.success).toHaveBeenCalledTimes(1);
});
it("keeps the same ID and text after uncertain failure for a safe retry", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ saved: true });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Get CX Update" }));
  fireEvent.change(screen.getByLabelText("Required customer update"), { target: { value: "Confirm Friday" } });
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  await screen.findByRole("alert"); expect(mocks.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry request" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
});
