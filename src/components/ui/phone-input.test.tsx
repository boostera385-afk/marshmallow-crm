import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhoneInput } from "./phone-input";

afterEach(cleanup);

function Harness(props: { initial?: string; error?: string | null; readOnly?: boolean; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <PhoneInput
      aria-label="Phone"
      value={value}
      error={props.error}
      readOnly={props.readOnly}
      onValueChange={(next) => {
        setValue(next);
        props.onValue?.(next);
      }}
    />
  );
}

const input = () => screen.getByLabelText("Phone") as HTMLInputElement;

describe("PhoneInput", () => {
  it("has no maxLength, so a long paste is not truncated before formatting", () => {
    render(<Harness />);
    expect(input()).not.toHaveAttribute("maxLength");
    fireEvent.change(input(), { target: { value: "+1 (305) 555-0123" } });
    expect(input().value).toBe("(305) 555-0123");
  });

  it("normalizes a pasted number with spaces", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(input(), { target: { value: " 305 555 0123 " } });
    expect(onValue).toHaveBeenLastCalledWith("(305) 555-0123");
    expect(input()).toHaveAttribute("type", "tel");
  });

  it("shows no error while typing, then flags an incomplete number on blur", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "30555" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(input());
    expect(screen.getByRole("alert")).toHaveTextContent("Phone number is incomplete — enter all 10 digits (5 entered)");
    expect(input()).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the error once the number is complete", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "30555" } });
    fireEvent.blur(input());
    fireEvent.change(input(), { target: { value: "3055550123" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input()).not.toHaveAttribute("aria-invalid");
  });

  it("does not flag an empty optional field", () => {
    render(<Harness />);
    fireEvent.blur(input());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a parent-supplied error", () => {
    render(<Harness error="Phone number is required" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Phone number is required");
  });

  it("does not validate a read-only field", () => {
    render(<Harness initial="(305) 55" readOnly />);
    fireEvent.blur(input());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
