import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import StatusBadge from "./StatusBadge";

afterEach(() => cleanup());

describe("StatusBadge", () => {
  it("keeps its natural, untruncated width by default", () => {
    render(<StatusBadge status="scheduled" size="sm" />);
    const label = screen.getByText("Scheduled");
    expect(label).toHaveClass("whitespace-nowrap");
    expect(label).not.toHaveClass("truncate");
    expect(label.parentElement).not.toHaveClass("max-w-full");
    expect(label.parentElement).not.toHaveAttribute("title");
  });

  it("fits a narrow cell when asked to truncate, keeping the full label on hover", () => {
    render(<StatusBadge status="waiting_customer_response" size="sm" truncate />);
    const label = screen.getByText("Waiting Customer Response");
    expect(label).toHaveClass("truncate", "min-w-0");
    expect(label.parentElement).toHaveClass("max-w-full");
    expect(label.parentElement).toHaveAttribute("title", "Waiting Customer Response");
  });
});
