import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Switch } from "@/components/ui/switch";
import FeatureAccessMatrix, { type AccessFeature, type AccessUser } from "./FeatureAccessMatrix";

const users: AccessUser[] = [
  { id: "admin", full_name: "Workspace Admin", role: "admin" },
  { id: "alice", full_name: "Alice Operator", role: "opr" },
  { id: "bob", full_name: "Bob Processor", role: "processor" },
];
const changed = vi.fn();
const features: AccessFeature<AccessUser>[] = Array.from({ length: 9 }, (_, index) => ({
  key: `feature-${index + 1}`, label: `Feature ${index + 1}`,
  renderControl: (user) => <Switch aria-label={`Feature ${index + 1} for ${user.full_name}`} onCheckedChange={(allowed) => changed(user.id, index + 1, allowed)} />,
}));
const table = () => within(screen.getByRole("table"));
beforeEach(() => {
  changed.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(cleanup);

describe("desktop feature access navigation", () => {
  it("pages four features at a time without losing user identities or target controls", () => {
    render(<FeatureAccessMatrix users={users} features={features} />);
    const previous = screen.getByRole("button", { name: "Previous features" });
    const next = screen.getByRole("button", { name: "Next features" });
    expect(previous).toBeDisabled();
    expect(table().getAllByRole("columnheader")).toHaveLength(5);
    expect(table().queryByText("Workspace Admin")).toBeNull();
    fireEvent.click(next);
    expect(screen.getByRole("status")).toHaveTextContent("Features 5–8 of 9");
    expect(table().queryByRole("columnheader", { name: "Feature 1" })).toBeNull();
    expect(table().getByText("Alice Operator")).toBeInTheDocument();
    fireEvent.click(table().getByRole("switch", { name: "Feature 5 for Alice Operator" }));
    expect(changed).toHaveBeenCalledWith("alice", 5, true);
    fireEvent.click(next);
    expect(next).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Features 9–9 of 9");
    fireEvent.click(previous);
    expect(table().getByRole("columnheader", { name: "Feature 5" })).toBeInTheDocument();
  });

  it("finds a feature on a later page and keeps the correct user target after filtering", () => {
    render(<FeatureAccessMatrix users={users} features={features} />);
    fireEvent.click(screen.getByRole("button", { name: "Next features" }));
    fireEvent.change(screen.getByLabelText("Find feature"), { target: { value: "Feature 9" } });
    fireEvent.change(screen.getByLabelText("Find user"), { target: { value: " alice " } });
    expect(table().queryByText("Bob Processor")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Features 1–1 of 1");
    fireEvent.click(table().getByRole("switch", { name: "Feature 9 for Alice Operator" }));
    expect(changed).toHaveBeenCalledWith("alice", 9, true);
  });

  it("filters roles and offers recovery from an empty result", () => {
    render(<FeatureAccessMatrix users={users} features={features} />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter feature access by role" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Processor" }));
    expect(table().queryByText("Alice Operator")).toBeNull();
    fireEvent.change(screen.getByLabelText("Find user"), { target: { value: "Nobody" } });
    expect(screen.getByText(/No matching users/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(table().getByText("Alice Operator")).toBeInTheDocument();
    expect(table().getByText("Bob Processor")).toBeInTheDocument();
  });

  it("clamps the page when the feature list shrinks", () => {
    const view = render(<FeatureAccessMatrix users={users} features={features} />);
    fireEvent.click(screen.getByRole("button", { name: "Next features" }));
    fireEvent.click(screen.getByRole("button", { name: "Next features" }));
    view.rerender(<FeatureAccessMatrix users={users} features={features.slice(0, 2)} />);
    expect(screen.getByRole("status")).toHaveTextContent("Features 1–2 of 2");
    expect(table().getByRole("columnheader", { name: "Feature 1" })).toBeInTheDocument();
  });
});
