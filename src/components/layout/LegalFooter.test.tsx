import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegalFooter } from "./LegalFooter";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("LegalFooter", () => {
  it("credits Pastry Marketing with an all-rights-reserved notice", () => {
    render(<LegalFooter year={2026} />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("© 2026 Pastry Marketing. All rights reserved.");
  });

  it("shows the Pastry logo without repeating the name to screen readers", () => {
    const { container } = render(<LegalFooter year={2026} />);
    const logo = container.querySelector("footer svg");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("uses the current year by default so the notice never goes stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-01T12:00:00Z"));
    render(<LegalFooter />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("© 2027 Pastry Marketing");
  });
});
