import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UrgentAiStatusBadge } from "./UrgentAiStatusBadge";
import { urgentAiStatusClass } from "@/lib/urgent-ai-status";

describe("UrgentAiStatusBadge", () => {
  it("keeps a long label inside its column and exposes the full text on hover", () => {
    const status = "Schedule Confirmation Pending";
    render(
      <table><tbody><tr><td style={{ width: 80 }}><UrgentAiStatusBadge status={status} /></td></tr></tbody></table>,
    );
    const badge = screen.getByText(status);
    // Regression: the pill used to be inline-flex inside a nowrap cell, so it overflowed
    // into the Area column. It must be width-capped and truncate instead.
    expect(badge).toHaveClass("max-w-full", "truncate", "inline-block");
    expect(badge).not.toHaveClass("inline-flex");
    expect(badge).toHaveAttribute("title", status);
  });

  it("keeps the status colour", () => {
    render(<UrgentAiStatusBadge status="Awaiting Response" />);
    const badge = screen.getByText("Awaiting Response");
    for (const cls of urgentAiStatusClass("Awaiting Response").split(" ")) {
      expect(badge).toHaveClass(cls);
    }
  });
});
