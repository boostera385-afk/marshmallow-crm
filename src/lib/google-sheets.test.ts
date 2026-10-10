import { describe, it, expect } from "vitest";
import { formatLeadForGoogleSheet, type GoogleSheetLeadRow } from "./google-sheets";
import type { Lead } from "@/types";

describe("formatLeadForGoogleSheet", () => {
  const mockLead: Lead = {
    id: "lead-123",
    job_id: "JOB-9999",
    customer_name: "John Doe",
    customer_phone: "3055550123",
    customer_email: "john@example.com",
    address: "123 Main St",
    city: "Miami",
    state: "FL",
    zip_code: "33101",
    service_type: "HVAC Repair",
    service_details: "AC blowing warm air",
    number_name: "Main Marketing Line",
    customer_schedule_requirements: "Available after 3 PM on weekdays",
    status: "waiting_customer_response",
    cs_tag: "booked",
    tech_name: "Alex Smith",
    tech_number: "3055559876",
    created_at: "2026-09-05T10:00:00Z",
    updated_at: "2026-09-05T12:00:00Z",
    created_by: "user-1",
    assigned_cs: null,
    last_edited_by: null,
    last_edited_at: null,
    scheduled_date: null,
    scheduled_time_start: null,
    scheduled_time_end: null,
    amount: 250,
    payment_amount: null,
    payment_screenshot_url: null,
    quote: "250",
    reference_name: null,
    terms: null,
    direction: null,
    labor_amount: null,
    material_amount: null,
    for_you_amount: null,
    for_us_amount: null,
  };

  it("should format all 17 required columns in exact required order", () => {
    const formatted: GoogleSheetLeadRow = formatLeadForGoogleSheet(
      mockLead,
      {
        cs: "[10:15 AM] Sarah: CS Note update",
        processor: "[10:30 AM] Mike: Parts ready",
        opr: "[10:45 AM] Dave: Dispatched tech",
      },
      ["https://supabase.co/storage/v1/object/public/lead-photos/photo1.jpg"]
    );

    // Verify all 17 keys exist in exact requested order
    expect(formatted["Lead ID"]).toBe("JOB-9999");
    expect(formatted["Lead Creation Date"]).toBeDefined();
    expect(formatted["Customer Name"]).toBe("John Doe");
    expect(formatted["Customer Phone No"]).toBe("(305) 555-0123");
    expect(formatted["Address"]).toBe("123 Main St, Miami, FL, 33101");
    expect(formatted["Service Type"]).toBe("HVAC Repair");
    expect(formatted["Service Details"]).toBe("AC blowing warm air");
    expect(formatted["Number Name"]).toBe("Main Marketing Line");
    expect(formatted["Schedule Requirements"]).toBe("Available after 3 PM on weekdays");
    expect(formatted["Pictures"]).toBe("https://supabase.co/storage/v1/object/public/lead-photos/photo1.jpg");
    expect(formatted["Tag"]).toBe("Booked");
    expect(formatted["Status"]).toBe("Waiting Customer Response");
    expect(formatted["Tech Name"]).toBe("Alex Smith");
    expect(formatted["Tech Number"]).toBe("(305) 555-9876");
    expect(formatted["Cs Notes"]).toBe("[10:15 AM] Sarah: CS Note update");
    expect(formatted["Processor Notes"]).toBe("[10:30 AM] Mike: Parts ready");
    expect(formatted["Opr Notes"]).toBe("[10:45 AM] Dave: Dispatched tech");
    expect(formatted._id).toBe("lead-123");
    expect(formatted._job_id).toBe("JOB-9999");
  });

  it("should fall back to lead.id if job_id is empty", () => {
    const leadWithoutJobId = { ...mockLead, job_id: "" };
    const formatted = formatLeadForGoogleSheet(leadWithoutJobId);
    expect(formatted["Lead ID"]).toBe("lead-123");
  });

  it("should handle empty optional fields gracefully", () => {
    const minimalLead = {
      ...mockLead,
      cs_tag: null,
      tech_name: null,
      tech_number: null,
      number_name: null,
      service_details: null,
      customer_schedule_requirements: null,
    };
    const formatted = formatLeadForGoogleSheet(minimalLead);
    expect(formatted["Tag"]).toBe("");
    expect(formatted["Tech Name"]).toBe("");
    expect(formatted["Tech Number"]).toBe("");
    expect(formatted["Cs Notes"]).toBe("");
    expect(formatted["Processor Notes"]).toBe("");
    expect(formatted["Opr Notes"]).toBe("");
  });

  it("should fetch all leads across multiple pages beyond 1000 rows limit", async () => {
    const { fetchAllLeadsWithDetails } = await import("./google-sheets");
    const { supabase } = await import("@/integrations/supabase/client");

    const originalFrom = supabase.from;
    const mockPage1 = Array.from({ length: 1000 }, (_, i) => ({
      ...mockLead,
      id: `lead-p1-${i}`,
      job_id: `JOB-P1-${i}`,
    }));
    const mockPage2 = Array.from({ length: 250 }, (_, i) => ({
      ...mockLead,
      id: `lead-p2-${i}`,
      job_id: `JOB-P2-${i}`,
    }));

    (supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
      if (table === "leads") {
        return {
          select: () => ({
            order: () => ({
              range: (from: number, to: number) => {
                if (from === 0) {
                  return Promise.resolve({ data: mockPage1, error: null });
                }
                if (from === 1000) {
                  return Promise.resolve({ data: mockPage2, error: null });
                }
                return Promise.resolve({ data: [], error: null });
              },
            }),
          }),
        };
      }
      if (table === "profiles_public") {
        return {
          select: () => Promise.resolve({ data: [], error: null }),
        };
      }
      if (table === "lead_notes" || table === "lead_photos") {
        return {
          select: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      return originalFrom.call(supabase, table as Parameters<typeof supabase.from>[0]);
    };

    try {
      const results = await fetchAllLeadsWithDetails();
      expect(results.length).toBe(1250);
      expect(results[0]["Lead ID"]).toBe("JOB-P1-0");
      expect(results[1000]["Lead ID"]).toBe("JOB-P2-0");
    } finally {
      supabase.from = originalFrom;
    }
  });

  it("requires an explicit Apps Script success response for a connection test", async () => {
    const { testGoogleSheetsWebhook } = await import("./google-sheets");
    const { supabase } = await import("@/integrations/supabase/client");

    const proto = Object.getPrototypeOf(supabase);
    const originalDescriptor =
      Object.getOwnPropertyDescriptor(proto, "functions") ||
      Object.getOwnPropertyDescriptor(supabase, "functions");

    Object.defineProperty(supabase, "functions", {
      configurable: true,
      value: {
        invoke: (fnName: string, options: { body: unknown }) => {
          if (fnName === "google-sheets-sync") {
            expect(options.body).toEqual({
              action: "ping",
              webhookUrl: "https://script.google.com/macros/s/test/exec",
            });
            return Promise.resolve({
              data: {
                success: true,
                message: "Connected",
                sheets: ["All Leads"],
                capabilities: ["ping", "sync_mirror", "clear_all"],
                version: "2.0.0",
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      },
    });

    try {
      await expect(testGoogleSheetsWebhook("https://script.google.com/macros/s/test/exec"))
        .resolves.toMatchObject({ success: true, message: "Connected", sheets: ["All Leads"], version: "2.0.0" });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(supabase, "functions", originalDescriptor);
      } else {
        delete (supabase as unknown as { functions?: unknown }).functions;
      }
    }
  });

  it("does not call an opaque-success fallback when Apps Script rejects a request", async () => {
    const { testGoogleSheetsWebhook } = await import("./google-sheets");
    const { supabase } = await import("@/integrations/supabase/client");
    const proto = Object.getPrototypeOf(supabase);
    const originalDescriptor = Object.getOwnPropertyDescriptor(proto, "functions")
      || Object.getOwnPropertyDescriptor(supabase, "functions");
    Object.defineProperty(supabase, "functions", {
      configurable: true,
      value: { invoke: () => Promise.resolve({ data: { success: false, error: "Quota exceeded" }, error: null }) },
    });
    try {
      await expect(testGoogleSheetsWebhook("https://script.google.com/macros/s/test/exec"))
        .rejects.toThrow("Quota exceeded");
    } finally {
      if (originalDescriptor) Object.defineProperty(supabase, "functions", originalDescriptor);
      else delete (supabase as unknown as { functions?: unknown }).functions;
    }
  });

  it("shows the Edge Function response body when an HTTP error is returned", async () => {
    const { testGoogleSheetsWebhook } = await import("./google-sheets");
    const { supabase } = await import("@/integrations/supabase/client");
    const proto = Object.getPrototypeOf(supabase);
    const originalDescriptor = Object.getOwnPropertyDescriptor(proto, "functions")
      || Object.getOwnPropertyDescriptor(supabase, "functions");
    const response = new Response(
      JSON.stringify({ success: false, error: "A delivery batch is in flight; retry the rebuild in a moment." }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
    Object.defineProperty(supabase, "functions", {
      configurable: true,
      value: {
        invoke: () => Promise.resolve({
          data: null,
          error: { message: "Edge Function returned a non-2xx status code", context: response },
        }),
      },
    });
    try {
      await expect(testGoogleSheetsWebhook("https://script.google.com/macros/s/test/exec"))
        .rejects.toThrow("A delivery batch is in flight; retry the rebuild in a moment.");
    } finally {
      if (originalDescriptor) Object.defineProperty(supabase, "functions", originalDescriptor);
      else delete (supabase as unknown as { functions?: unknown }).functions;
    }
  });
});

