import type { JobMessage } from "./processor-job-status.ts";

/** Counts describe attribution, not outcomes. No other job's text leaves the server. */
export function processorReviewDiagnostics(messages: JobMessage[], matches: (text: string) => boolean) {
  let matchedTechnician = 0; let unattributedTechnician = 0;
  const relevant: JobMessage[] = [];
  for (const message of messages) {
    if (!message.text) continue;
    const identified = matches(message.text);
    if (message.sender === "customer") {
      if (identified) matchedTechnician++; else unattributedTechnician++;
    }
    if (!identified) continue;
    relevant.push(message);
  }
  // With no identified technician reply there is no acceptance/progress/completion
  // evidence, so no possible Send Dose result. Otherwise retain EVERY delivered
  // agent message: an update question need not contain an English keyword.
  const extractable = matchedTechnician ? relevant.filter((message) => message.sender === "customer" || (message.sender === "agent" && message.status === "delivered")) : [];
  return { relevant, extractable, matched_technician_messages: matchedTechnician, unattributed_technician_messages: unattributedTechnician };
}
