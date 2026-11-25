import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarshmallowMark } from "./MarshmallowMark";

afterEach(cleanup);

describe("MarshmallowMark", () => {
  it("is announced as Marshmallow when nothing nearby names the app", () => {
    render(<MarshmallowMark />);
    expect(screen.getByRole("img", { name: "Marshmallow" })).toBeInTheDocument();
  });

  it("is hidden from screen readers when the heading beside it already says Marshmallow", () => {
    const { container } = render(<MarshmallowMark title="" />);
    expect(screen.queryByRole("img")).toBeNull();
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("loads the bundled mark instead of a hosting-specific path", () => {
    render(<MarshmallowMark />);
    const src = screen.getByRole("img", { name: "Marshmallow" }).getAttribute("src") ?? "";
    expect(src).toMatch(/marshmallow-mark\.svg|^data:image\/svg\+xml/);
    expect(src).not.toContain("/__l5e/");
  });
});
