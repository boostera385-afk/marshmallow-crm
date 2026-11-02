import jsPDF from "jspdf";
import { DOC_SECTIONS, DOC_SUBTITLE, DOC_TITLE, DOC_VERSION, type DocBlock } from "./documentation-content";

const MARGIN = 48;
const PAGE_W = 612; // US Letter pt
const PAGE_H = 792;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BLUE: [number, number, number] = [31, 78, 121];
const GREY: [number, number, number] = [200, 200, 200];
const HEADER_FILL: [number, number, number] = [217, 226, 243];
const TABLE_GAP_AFTER = 18;

export function generateDocumentationPdf(): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // Cover
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(...BLUE);
  doc.text(DOC_TITLE, PAGE_W / 2, y + 40, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);
  doc.setTextColor(80, 80, 80);
  doc.text(DOC_SUBTITLE, PAGE_W / 2, y + 68, { align: "center" });
  doc.setFontSize(11);
  doc.setTextColor(140, 140, 140);
  doc.text(DOC_VERSION, PAGE_W / 2, y + 90, { align: "center" });
  y += 130;

  // TOC
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...BLUE);
  doc.text("Table of Contents", MARGIN, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  DOC_SECTIONS.forEach((s) => {
    ensureSpace(16);
    doc.text(`•  ${s.title}`, MARGIN + 12, y);
    y += 15;
  });

  // Sections
  DOC_SECTIONS.forEach((section) => {
    doc.addPage();
    y = MARGIN;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...BLUE);
    doc.text(section.title, MARGIN, y);
    y += 22;

    section.blocks.forEach((block) => {
      renderBlock(doc, block, () => y, (next) => { y = next; }, ensureSpace);
    });
  });

  // Footer page numbers
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${total}`, PAGE_W - MARGIN, PAGE_H - 24, { align: "right" });
  }

  return doc;
}

function renderBlock(
  doc: jsPDF,
  block: DocBlock,
  getY: () => number,
  setY: (y: number) => void,
  ensureSpace: (n: number) => void,
) {
  if (block.type === "p") {
    doc.setFont("helvetica", block.italic ? "italic" : "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(block.text, CONTENT_W) as string[];
    lines.forEach((ln) => {
      ensureSpace(15);
      doc.text(ln, MARGIN, getY());
      setY(getY() + 14);
    });
    setY(getY() + 4);
    return;
  }

  if (block.type === "bullet") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(block.text, CONTENT_W - 18) as string[];
    lines.forEach((ln, idx) => {
      ensureSpace(15);
      if (idx === 0) doc.text("•", MARGIN + 4, getY());
      doc.text(ln, MARGIN + 18, getY());
      setY(getY() + 14);
    });
    setY(getY() + 2);
    return;
  }

  if (block.type === "kv") {
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    const labelText = `${block.label}: `;
    doc.setFont("helvetica", "bold");
    const labelW = doc.getTextWidth(labelText);
    const valueLines = doc.splitTextToSize(block.value, CONTENT_W - labelW) as string[];
    ensureSpace(15);
    doc.text(labelText, MARGIN, getY());
    doc.setFont("helvetica", "normal");
    valueLines.forEach((ln, idx) => {
      if (idx > 0) { ensureSpace(15); }
      doc.text(ln, idx === 0 ? MARGIN + labelW : MARGIN, getY());
      setY(getY() + 14);
    });
    setY(getY() + 2);
    return;
  }

  if (block.type === "table") {
    const cols = block.headers.length;
    const colW = CONTENT_W / cols;
    const padX = 6;
    const padY = 6;
    const drawRow = (cells: string[], header: boolean) => {
      doc.setFont("helvetica", header ? "bold" : "normal");
      doc.setFontSize(10);
      doc.setTextColor(20, 20, 20);
      const wrapped = cells.map((c) => doc.splitTextToSize(c ?? "", colW - padX * 2) as string[]);
      const rowLines = Math.max(...wrapped.map((w) => w.length));
      const rowH = rowLines * 12 + padY * 2;
      ensureSpace(rowH);
      const startY = getY();
      if (header) {
        doc.setFillColor(...HEADER_FILL);
        doc.rect(MARGIN, startY, CONTENT_W, rowH, "F");
      }
      doc.setDrawColor(...GREY);
      cells.forEach((_, i) => {
        const x = MARGIN + i * colW;
        doc.rect(x, startY, colW, rowH);
        wrapped[i].forEach((ln, li) => {
          doc.text(ln, x + padX, startY + padY + 9 + li * 12);
        });
      });
      setY(startY + rowH);
    };
    drawRow(block.headers, true);
    block.rows.forEach((r) => drawRow(r, false));
    // Text is drawn on its baseline, so leave room for the next line's ascent
    // below the table's bottom border.
    setY(getY() + TABLE_GAP_AFTER);
    return;
  }
}
