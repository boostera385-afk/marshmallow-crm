import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PaidLeadAccessDialog from "./PaidLeadAccessDialog";
afterEach(cleanup);

it("defaults to All time", () => {
  const onConfirm = vi.fn();
  render(<PaidLeadAccessDialog open userName="Sam CS" onCancel={vi.fn()} onConfirm={onConfirm} />);
  expect(screen.getByText("Share paid leads with Sam CS")).toBeInTheDocument();
  expect(screen.getByText(/date each lead became paid/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Share paid leads" }));
  expect(onConfirm).toHaveBeenCalledWith({ mode: "all" });
});

it("asks for both dates and a valid order before sharing a custom range", () => {
  const onConfirm = vi.fn();
  render(<PaidLeadAccessDialog open userName="Sam CS" onCancel={vi.fn()} onConfirm={onConfirm} />);
  fireEvent.click(screen.getByLabelText("Custom date range"));
  fireEvent.click(screen.getByRole("button", { name: "Share paid leads" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a start and an end date.");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Share paid leads" }));
  expect(screen.getByRole("alert")).toHaveTextContent("on or before");
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-30" } });
  fireEvent.click(screen.getByRole("button", { name: "Share paid leads" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onConfirm).toHaveBeenCalledWith({ mode: "range", start: "2026-11-01", end: "2026-11-30" });
});

it("starts from the user's current range when editing, and Cancel saves nothing", () => {
  const onConfirm = vi.fn(); const onCancel = vi.fn();
  render(<PaidLeadAccessDialog open userName="Sam CS" current={{ start_date: "2026-10-01", end_date: "2026-10-31" }} onCancel={onCancel} onConfirm={onConfirm} />);
  expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
  expect(screen.getByLabelText("To")).toHaveValue("2026-10-31");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
});
