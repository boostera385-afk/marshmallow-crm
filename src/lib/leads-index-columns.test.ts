import { describe, expect, it } from "vitest";
import { LEADS_INDEX_COLUMNS } from "@/lib/leads-index-columns";

const columns = LEADS_INDEX_COLUMNS.split(",").map((c) => c.trim());

/**
 * The Leads page reads every lead with only this projection, then fetches the
 * card-only columns for the rows on screen. If a column is removed from here it
 * silently breaks something, because TypeScript cannot see it - the rows arrive
 * at runtime and are cast to Lead. These tests pin the contract.
 */
describe("leads index projection", () => {
  it("has no duplicate or empty entries", () => {
    expect(columns.every((c) => c.length > 0)).toBe(true);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("carries the columns the status counts and filters read", () => {
    // status drives every tab count, useAllowedStatuses and the status filter.
    // cs_tag drives the tag filters and the ordering rank in
    // compareLeadDisplayPriority.
    expect(columns).toContain("status");
    expect(columns).toContain("cs_tag");
  });

  it("carries the columns the sort reads", () => {
    // (created_at DESC, id DESC) is the list ordering and the id tie-break.
    // quote_requested_by + created_by drive quote pinning via
    // isLeadPinnedForUser; urgent_at orders the Urgent Job bucket.
    for (const c of ["id", "created_at", "created_by", "quote_requested_by", "urgent_at"]) {
      expect(columns).toContain(c);
    }
  });

  it("carries every field the search box matches on", () => {
    // These must stay in lockstep with the deferredSearch filter in LeadsPage.
    for (const c of [
      "customer_name",
      "job_id",
      "customer_phone",
      "customer_landline",
      "address",
      "city",
      "state",
      "service_type",
    ]) {
      expect(columns).toContain(c);
    }
  });

  it("carries what the Need Attention view and schedule filter read", () => {
    // leadNeedsAttention -> status + customer_schedule_requirements, and
    // extractAllScheduledDateKeys reads the same field for the date filter.
    expect(columns).toContain("customer_schedule_requirements");
  });

  it("carries updated_at, the delta-sync cursor", () => {
    // Without it the page cannot ask for "changed since" and would fall back to
    // re-reading every lead on every refresh.
    expect(columns).toContain("updated_at");
  });

  it("carries assigned_cs for the shared-with-me bucket", () => {
    expect(columns).toContain("assigned_cs");
  });

  it("excludes the heavy card-only columns that made it slow", () => {
    // These are the expensive ones and are only read by the detail view or the
    // card, so they must NOT be in the index. See the header comment for sizes.
    for (const c of ["nearby_areas", "service_details", "quote"]) {
      expect(columns).not.toContain(c);
    }
  });
});
