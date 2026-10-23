import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessorReviewEvidence } from "./ProcessorReviewEvidence";
import { processorRowSummary, type ProcessorJob } from "@/lib/processor-board";
const now = new Date("2026-10-23T18:00:00Z");
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1001", customer_name: "Synthetic Customer", customer_phone: null, address: "10 Sample St", city: null, state: null, service_type: "Repair", tech_name: "Synthetic Technician", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", checked_at: now.toISOString(), assessment: { status: "payment_pending", evidence: [{ signal: "completed", quote: "JOB-1001 is completed and ready for payment", message_id: "segment", message_time: "2026-10-15T16:00:00Z", sender: "customer", source: "call_transcript", source_message_id: "original-transcript", call_id: "ACsynthetic" }], messages_reviewed: 3, matched_messages: 1, matched_technician_messages: 1, ai_used: true, ai_extraction_reused: true, job_messages_changed: false, call_transcripts: { state: "available", checked: 1, missing: 0, skipped_segments: 0 }, source: "Quo current history", history_complete: true, timezone: "America/New_York", checked_at: now.toISOString(), lead_updated_at: "2026-10-15T10:00:00Z", summary: "Synthetic verified call evidence" } };
afterEach(cleanup);
describe("plain-language job evidence", () => {
  it("keeps verified completion when no newer update exists, without implying an empty chat", () => {
    render(<ProcessorReviewEvidence job={job} timezone="America/New_York" now={now} />);
    expect(processorRowSummary(job, "America/New_York", now)).toBe("AI · call transcript: job completed · no new update.");
    expect(screen.getByText(/verified evidence below still supports/)).toBeVisible();
    expect(screen.getByText(/Call transcript · Technician/)).toBeVisible();
    expect(screen.getByLabelText("Call transcript coverage")).toHaveTextContent("1 saved call transcript checked");
    expect(screen.queryByText(/No job-linked update was available/)).not.toBeInTheDocument();
  });
  it("reports missing transcripts/unknown speakers without claiming those calls passed", () => {
    const partial = { ...job, assessment: { ...job.assessment!, call_transcripts: { state: "partial" as const, checked: 1, missing: 2, skipped_segments: 3 } } };
    render(<ProcessorReviewEvidence job={partial} timezone="America/New_York" now={now} />);
    expect(screen.getByLabelText("Call transcript coverage")).toHaveTextContent("2 unavailable");
    expect(screen.getByLabelText("Call transcript coverage")).toHaveTextContent("speakers could not be verified");
    expect(screen.getByText(/JOB-1001 is completed/)).toBeVisible();
  });
  it("does not claim a legacy text-only check included calls", () => {
    const legacy = { ...job, assessment: { ...job.assessment!, call_transcripts: undefined, ai_extraction_reused: undefined, evidence: [] } };
    render(<ProcessorReviewEvidence job={legacy} timezone="America/New_York" now={now} />);
    expect(screen.getByLabelText("Call transcript coverage")).toHaveTextContent("earlier check did not include call transcripts");
    expect(screen.getByText("AI checked this job's text messages.")).toBeVisible();
  });
  it("never presents a changed assignment's earlier call quote as current evidence", () => {
    const reassigned = { ...job, tech_number: "4155550188", updated_at: now.toISOString() };
    render(<ProcessorReviewEvidence job={reassigned} timezone="America/New_York" now={now} />);
    expect(screen.queryByText(/JOB-1001 is completed/)).not.toBeInTheDocument();
    expect(processorRowSummary(reassigned, "America/New_York", now)).toBe("Job or chat changed · check this job again.");
  });
});
