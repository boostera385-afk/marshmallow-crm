import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PaymentDialog from "./PaymentDialog";

afterEach(cleanup);

describe("payment confirmation outcomes", () => {
  for (const requestType of ["paid", "partial_paid"] as const) {
    const label = requestType === "paid" ? "Paid" : "Partial Paid";
    it(`requires a positive amount and sends ${label} approval context`, () => {
      const onConfirm = vi.fn();
      render(<PaymentDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} mode="request" requestType={requestType} />);
      expect(screen.getByRole("dialog", { name: `Request ${label} Approval` })).toBeInTheDocument();
      const submit = screen.getByRole("button", { name: "Send request" });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "25.50" } });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Deposit received  " } });
      fireEvent.click(submit);
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(25.5, null, "Deposit received");
      expect(screen.getByRole("spinbutton")).toHaveValue(25.5);
      expect(screen.getByRole("textbox")).toHaveValue("  Deposit received  ");
    });

    it(`shows the Admin's direct ${label} confirmation without request comments`, () => {
      const onConfirm = vi.fn();
      render(<PaymentDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} requestType={requestType} />);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "50" } });
      fireEvent.click(screen.getByRole("button", { name: `Confirm ${label}` }));
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(50, null, undefined);
    });
  }

  it("disables submission while saving", () => {
    render(<PaymentDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} loading requestType="partial_paid" mode="request" />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "50" } });
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("clears the draft only when the dialog closes", () => {
    const props = { onOpenChange: vi.fn(), onConfirm: vi.fn(), mode: "request" as const };
    const { rerender } = render(<PaymentDialog {...props} open />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "25" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Deposit" } });
    rerender(<PaymentDialog {...props} open={false} />);
    rerender(<PaymentDialog {...props} open />);
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
