import { describe, expect, it } from "vitest";
import {
  CANCELLATION_PAGE_LEAD_COLUMNS,
  PAYMENT_PAGE_LEAD_COLUMNS,
} from "@/lib/request-page-leads";

const cancellationColumns = CANCELLATION_PAGE_LEAD_COLUMNS.split(",").map((c) => c.trim());
const paymentColumns = PAYMENT_PAGE_LEAD_COLUMNS.split(",").map((c) => c.trim());

/**
 * The Paid Approval and Cancellation Requests pages join leads with these
 * projections instead of every column. The rows are cast at the query
 * boundary, so TypeScript cannot notice a column missing from the string -
 * these tests pin the projection to each consumer, in the same style as
 * leads-index-columns.test.ts.
 */
describe("request page lead projections", () => {
  it("has no duplicate or empty entries", () => {
    for (const columns of [cancellationColumns, paymentColumns]) {
      expect(columns.every((c) => c.length > 0)).toBe(true);
      expect(new Set(columns).size).toBe(columns.length);
    }
  });

  it("carries what the review actions read", () => {
    // reviewPaymentRequest / reviewCancellationRequest update the lead by id
    // and log activity with job_id + customer_name (ReviewActionLead).
    for (const columns of [cancellationColumns, paymentColumns]) {
      for (const c of ["id", "job_id", "customer_name"]) {
        expect(columns).toContain(c);
      }
    }
  });

  it("carries what the cancellation request card renders", () => {
    // Header name, StatusBadge, and the job_id chip.
    for (const c of ["customer_name", "status", "job_id"]) {
      expect(cancellationColumns).toContain(c);
    }
  });

  it("carries what the payment request card and approved suggestion read", () => {
    // Card: StatusBadge, tech line, city/state line. Approved suggestion
    // (InlineSuggestions): tech + address fields for the Quo message draft.
    for (const c of [
      "status",
      "tech_name",
      "tech_number",
      "city",
      "state",
      "zip_code",
      "address",
    ]) {
      expect(paymentColumns).toContain(c);
    }
  });

  it("excludes the heavy card-only lead columns", () => {
    // These are the expensive text columns on leads (see
    // leads-index-columns.ts for measured sizes); neither page reads them.
    for (const columns of [cancellationColumns, paymentColumns]) {
      for (const c of ["service_details", "quote", "nearby_areas", "customer_schedule_requirements"]) {
        expect(columns).not.toContain(c);
      }
    }
  });
});
