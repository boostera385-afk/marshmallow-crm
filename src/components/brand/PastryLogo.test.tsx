import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PastryLogo } from "./PastryLogo";

afterEach(() => cleanup());

describe("PastryLogo", () => {
  it("is an image named Pastry Marketing by default", () => {
    render(<PastryLogo />);
    expect(screen.getByRole("img", { name: "Pastry Marketing" })).toBeInTheDocument();
  });

  it("can be decorative when the name is already in nearby text", () => {
    const { container } = render(<PastryLogo title="" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("title")).toBeNull();
  });
});
