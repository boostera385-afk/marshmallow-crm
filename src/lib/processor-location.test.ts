import { describe, expect, it } from "vitest";
import { processorLocation } from "./processor-location";

describe("Processor Board saved customer location", () => {
  it("prefers saved city/state over the job address, never technician coverage", () => {
    expect(processorLocation({ city: "Miami", state: "FL", address: "House 10, Sample Street", half_address: "Different partial" })).toEqual({ text: "Miami, FL", note: null });
  });
  it("shows an existing full address unchanged when city/state are blank", () => {
    expect(processorLocation({ city: " ", state: null, address: "10 Sample St Apt 2", half_address: "House 10" })).toEqual({ text: "10 Sample St Apt 2", note: "Saved address · city/state not saved" });
  });
  it("uses a saved short house/street address without inventing a city or state", () => {
    expect(processorLocation({ city: "Unknown", state: "N/A", address: " ", half_address: "House 12, Sample Street" })).toEqual({ text: "House 12, Sample Street", note: "Partial address · city/state not saved" });
  });
  it("reports missing location only after every saved source is exhausted", () => {
    expect(processorLocation({ city: "unknown", state: "—", address: "N/A", half_address: null })).toEqual({ text: "Job location missing", note: "Update the saved address" });
  });
  it("keeps known location parts without filling missing ones from guesses", () => {
    expect(processorLocation({ city: "Springfield", state: null, address: "10 Main St" })).toEqual({ text: "Springfield", note: "State not saved" });
  });
});
