import { describe, expect, it, vi } from "vitest";

type Call = { method: string; args: unknown[] };
const calls: Call[] = [];

vi.mock("jspdf", () => {
  class FakePdf {
    private pages = 1;
    constructor() { calls.length = 0; }
    private record(method: string, args: unknown[]) { calls.push({ method, args }); }
    setFont(...args: unknown[]) { this.record("setFont", args); }
    setFontSize(...args: unknown[]) { this.record("setFontSize", args); }
    setTextColor(...args: unknown[]) { this.record("setTextColor", args); }
    setFillColor(...args: unknown[]) { this.record("setFillColor", args); }
    setDrawColor(...args: unknown[]) { this.record("setDrawColor", args); }
    text(...args: unknown[]) { this.record("text", args); }
    rect(...args: unknown[]) { this.record("rect", args); }
    addPage() { this.pages += 1; this.record("addPage", []); }
    setPage(...args: unknown[]) { this.record("setPage", args); }
    getNumberOfPages() { return this.pages; }
    getTextWidth(text: string) { return text.length * 5; }
    splitTextToSize(text: string) { return [text]; }
  }
  return { default: FakePdf };
});

vi.mock("./documentation-content", () => ({
  DOC_TITLE: "T",
  DOC_SUBTITLE: "S",
  DOC_VERSION: "V",
  DOC_SECTIONS: [{
    id: "s",
    title: "1. Section",
    blocks: [
      { type: "table", headers: ["A", "B"], rows: [["a", "b"]] },
      { type: "p", text: "Paragraph after the table" },
    ],
  }],
}));

describe("documentation PDF layout", () => {
  it("starts the text after a table below the table's bottom border, not on top of it", async () => {
    const { generateDocumentationPdf } = await import("./documentation-pdf");
    generateDocumentationPdf();

    const rects = calls.filter((c) => c.method === "rect").map((c) => c.args as number[]);
    const tableBottom = Math.max(...rects.map(([, y, , h]) => y + h));
    const paragraph = calls.find((c) => c.method === "text" && c.args[0] === "Paragraph after the table");
    const baseline = paragraph?.args[2] as number;

    // An 11pt line rises about 8pt above its baseline; it must clear the border.
    expect(baseline - 11).toBeGreaterThanOrEqual(tableBottom);
  });
});
