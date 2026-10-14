import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CopilotAnswer from "./CopilotAnswer";
import { emptyCopilotResult } from "../../../supabase/functions/_shared/copilot-core";
afterEach(() => cleanup());
describe("Copilot evidence and human-only actions", () => {
  it("copies AI text only on click and keeps feedback explicitly session-only", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopilotAnswer result={{ ...emptyCopilotResult("ai"), source: "ai", text: "Draft for review" }} expanded={false} pending={false} onOpen={vi.fn()} onBrief={vi.fn()} onDraft={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" })); expect(await screen.findByText("Copied")).toBeVisible(); expect(writeText).toHaveBeenCalledWith("Draft for review");
    fireEvent.click(screen.getByRole("button", { name: "Answer was helpful" })); expect(screen.getByRole("status")).toHaveTextContent("nothing was sent or saved");
  });
  it("requests a fresh saved brief and prepares a draft instead of sending a message", () => {
    const onBrief = vi.fn(), onDraft = vi.fn(); const id = "00000000-0000-4000-8000-000000000001";
    render(<CopilotAnswer result={{ ...emptyCopilotResult("leads"), cards: [{ id, title: "MM-101", subtitle: "urgent job", href: `/leads/${id}`, fields: [{ label: "Address", value: "Test Apt 2" }] }] }} expanded pending={false} onOpen={vi.fn()} onBrief={onBrief} onDraft={onDraft}/>);
    fireEvent.click(screen.getByRole("button", { name: "Lead brief" })); expect(onBrief).toHaveBeenCalledWith(id);
    fireEvent.click(screen.getByRole("button", { name: "Draft follow-up" })); expect(onDraft).toHaveBeenCalledWith(id);
    expect(screen.queryByRole("button", { name: "Copy answer" })).not.toBeInTheDocument();
    expect(screen.getByText("Test Apt 2")).toBeVisible();
  });
});
