import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import QuoteBreakdownFields from "./QuoteBreakdownFields";
import type { QuoteFormValue } from "@/lib/quote-breakdown";
afterEach(cleanup);
const value: QuoteFormValue = { terms: "quoted", laborAmount: "200", materialAmount: "60", includesMaterials: true };
function Editable() {
  const [quote, setQuote] = useState(value);
  return <QuoteBreakdownFields value={quote} onChange={setQuote} />;
}
it("shows separate labor and materials inputs and removes the charge when No is chosen", () => {
  render(<Editable />);
  expect(screen.getByLabelText("Customer Labor ($)")).toHaveValue(200);
  expect(screen.getByLabelText("Parts/Materials ($)")).toHaveValue(60);
  fireEvent.click(screen.getByRole("combobox", { name: "Parts/Materials charges?" }));
  fireEvent.click(screen.getByRole("option", { name: "No" }));
  expect(screen.queryByLabelText("Parts/Materials ($)")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "Parts/Materials charges?" }));
  fireEvent.click(screen.getByRole("option", { name: "Yes" }));
  expect(screen.getByLabelText("Parts/Materials ($)")).toHaveValue(null);
});
it("lets CS read customer-facing quote details without internal editing controls", () => {
  render(<QuoteBreakdownFields value={value} onChange={() => { throw new Error("Read-only must not edit"); }} readOnly />);
  expect(screen.getByText("Labor Section")).toBeVisible();
  expect(screen.getByText("$200.00")).toBeVisible();
  expect(screen.getByText("Parts/Materials Section")).toBeVisible();
  expect(screen.getByText("$60.00")).toBeVisible();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
it("mentions no parts/materials in a read-only No-materials quote", () => {
  render(<QuoteBreakdownFields value={{ ...value, materialAmount: "", includesMaterials: false }} onChange={() => {}} readOnly />);
  expect(screen.getByRole("region", { name: "Quote breakdown" })).not.toHaveTextContent(/parts|materials/i);
});
