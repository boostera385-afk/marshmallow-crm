import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { format } from "date-fns";
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

it("asks for both dates, and only lets To be on or after From", () => {
  const onConfirm = vi.fn();
  render(<PaidLeadAccessDialog open userName="Sam CS" onCancel={vi.fn()} onConfirm={onConfirm} />);
  fireEvent.click(screen.getByLabelText("Custom date range"));
  expect(document.querySelector('input[type="date"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Share paid leads" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a start and an end date.");

  const now = new Date();
  const iso = (d: number) => format(new Date(now.getFullYear(), now.getMonth(), d), "yyyy-MM-dd");
  const pick = (n: string) => within(screen.getAllByRole("dialog").at(-1)!).getAllByRole("gridcell", { name: n })
    .find((cell) => !cell.className.includes("day-outside"))!;
  fireEvent.click(screen.getByLabelText("From"));
  fireEvent.click(pick("15"));
  fireEvent.click(screen.getByLabelText("To"));
  expect(pick("14")).toBeDisabled();
  fireEvent.click(pick("16"));
  fireEvent.click(screen.getByRole("button", { name: "Share paid leads" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onConfirm).toHaveBeenCalledWith({ mode: "range", start: iso(15), end: iso(16) });
});

it("starts from the user's current range when editing, and Cancel saves nothing", () => {
  const onConfirm = vi.fn(); const onCancel = vi.fn();
  render(<PaidLeadAccessDialog open userName="Sam CS" current={{ start_date: "2026-10-01", end_date: "2026-10-31" }} onCancel={onCancel} onConfirm={onConfirm} />);
  expect(screen.getByLabelText("From")).toHaveTextContent("Oct 1, 2026");
  expect(screen.getByLabelText("To")).toHaveTextContent("Oct 31, 2026");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
});
