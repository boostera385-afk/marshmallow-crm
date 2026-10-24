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

describe("full per-user feature access view", () => {
  it("shows every feature together and targets the selected user without paging", () => {
    render(<FeatureAccessMatrix users={users} features={features} />);
    expect(table().getAllByRole("columnheader")).toHaveLength(10);
    expect(table().queryByText("Workspace Admin")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next features" })).toBeNull();
    expect(screen.getByRole("region", { name: "Feature permissions table" })).toHaveAttribute("tabindex", "0");
    fireEvent.click(table().getByRole("switch", { name: "Feature 9 for Alice Operator" }));
    expect(changed).toHaveBeenCalledExactlyOnceWith("alice", 9, true);
    expect(table().getByRole("columnheader", { name: "Feature 1" })).toBeInTheDocument();
  });

  it("finds a feature and keeps the correct user target after filtering", () => {
    render(<FeatureAccessMatrix users={users} features={features} />);
    fireEvent.change(screen.getByLabelText("Find feature"), { target: { value: "Feature 9" } });
    fireEvent.change(screen.getByLabelText("Find user"), { target: { value: " alice " } });
    expect(table().queryByText("Bob Processor")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("1 users · 1 of 9 features");
    fireEvent.click(table().getByRole("switch", { name: "Feature 9 for Alice Operator" }));
    expect(changed).toHaveBeenCalledWith("alice", 9, true);
  });

  it("filters roles and restores all features after clearing filters", () => {
    render(<FeatureAccessMatrix users={users} features={features} />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter feature access by role" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Processor" }));
    expect(table().queryByText("Alice Operator")).toBeNull();
    fireEvent.change(screen.getByLabelText("Find user"), { target: { value: "Nobody" } });
    expect(screen.getByText(/No matching users/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(table().getByText("Alice Operator")).toBeInTheDocument();
    expect(table().getByText("Bob Processor")).toBeInTheDocument();
    expect(table().getAllByRole("columnheader")).toHaveLength(10);
  });

  it("updates the complete view when features change", () => {
    const view = render(<FeatureAccessMatrix users={users} features={features} />);
    view.rerender(<FeatureAccessMatrix users={users} features={features.slice(0, 2)} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 users · 2 of 2 features");
    expect(table().getAllByRole("columnheader")).toHaveLength(3);
    expect(table().queryByRole("switch", { name: "Feature 9 for Alice Operator" })).toBeNull();
  });
});
