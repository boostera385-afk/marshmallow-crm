import { describe, expect, it } from "vitest";
import { getDefaultVisibleStatuses } from "@/lib/access";
import { ALL_LEAD_STATUSES, ALL_NAV_ITEMS, STATUS_LABELS, getChangeableStatuses } from "@/lib/constants";
import { SCHEDULE_TAGS } from "@/lib/lead-tags";
import { CS_TAG_LABELS, type AppRole } from "@/types";
import {
  DOC_SECTIONS,
  NAV_ACCESS_ROWS,
  ROLE_LABELS,
  TAG_ROWS,
  type DocBlock,
} from "@/lib/documentation-content";

const section = (id: string) => {
  const found = DOC_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Missing documentation section ${id}`);
  return found;
};

const tables = (id: string) =>
  section(id).blocks.filter((b): b is Extract<DocBlock, { type: "table" }> => b.type === "table");

const kv = (id: string, label: string) =>
  section(id).blocks.find((b): b is Extract<DocBlock, { type: "kv" }> => b.type === "kv" && b.label === label)?.value;

describe("in-app documentation content", () => {
  it("numbers sections 1..N in order with unique ids", () => {
    DOC_SECTIONS.forEach((s, index) => {
      expect(s.title.startsWith(`${index + 1}. `)).toBe(true);
    });
    expect(new Set(DOC_SECTIONS.map((s) => s.id)).size).toBe(DOC_SECTIONS.length);
  });

  it("documents every navigation key exactly once", () => {
    const keys = NAV_ACCESS_ROWS.map(([key]) => key);
    expect([...keys].sort()).toEqual([...ALL_NAV_ITEMS].sort());
  });

  it("lists every lead status with its app label", () => {
    const statusTable = tables("statuses")[0];
    expect(statusTable.rows.map(([key]) => key)).toEqual(ALL_LEAD_STATUSES);
    statusTable.rows.forEach(([key, label, meaning]) => {
      expect(label).toBe(STATUS_LABELS[key as keyof typeof STATUS_LABELS]);
      expect(meaning.length).toBeGreaterThan(0);
    });
  });

  it("states each role's settable statuses exactly as the app enforces them", () => {
    (Object.keys(ROLE_LABELS) as AppRole[]).forEach((role) => {
      const documented = kv("status-visibility", ROLE_LABELS[role]);
      const expected = getChangeableStatuses(role).map((s) => STATUS_LABELS[s]);
      if (expected.length === 0) {
        expect(documented).toBe("None (read-only).");
      } else {
        expect(documented?.split(", ")).toEqual(expected);
      }
    });
  });

  it("states operators as read-only and shows them Urgent Job only", () => {
    expect(kv("status-visibility", "OPR")).toBe("None (read-only).");
    expect(kv("status-visibility", "OPR Admin")).toBe("None (read-only).");
    const visibility = tables("status-visibility")[0];
    const oprRow = visibility.rows.find(([role]) => role === "OPR");
    expect([...getDefaultVisibleStatuses("opr")]).toEqual(["urgent_job"]);
    expect(oprRow?.[1]).toBe("Everything except Urgent Job");
  });

  it("documents every lead tag with its app label", () => {
    expect(TAG_ROWS.map(([key]) => key).sort()).toEqual([...SCHEDULE_TAGS, "incomplete_details"].sort());
    TAG_ROWS.forEach(([key, label]) => {
      expect(label).toBe(CS_TAG_LABELS[key as keyof typeof CS_TAG_LABELS]);
    });
  });
});
