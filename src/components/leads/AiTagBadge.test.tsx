import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import AiTagBadge from "./AiTagBadge";
afterEach(cleanup);
it("marks a Ready to schedule tag that the AI set", () => {
  render(<AiTagBadge lead={{ cs_tag: "ready_to_schedule", cs_tag_source: "ai" }} />);
  expect(screen.getByLabelText("Set by AI: the customer confirmed the schedule in Quo")).toHaveTextContent("AI");
});
it("marks a Customer Require New Schedule tag that the AI set, with its own explanation", () => {
  render(<AiTagBadge lead={{ cs_tag: "confirmation_sent", cs_tag_source: "ai" }} />);
  expect(screen.getByLabelText("Set by AI: the customer asked for a different day or time in Quo")).toHaveTextContent("AI");
});
it.each([
  { cs_tag: "ready_to_schedule", cs_tag_source: null },
  { cs_tag: "confirmation_sent", cs_tag_source: null },
  { cs_tag: "waiting_schedule_confirmation", cs_tag_source: "ai" },
  { cs_tag: "ready_to_schedule" },
  { cs_tag: "booked", cs_tag_source: "ai" },
  { cs_tag: null, cs_tag_source: "ai" },
])("shows nothing for a tag a person set or a stale marker: %j", (lead) => {
  const { container } = render(<AiTagBadge lead={lead} />);
  expect(container).toBeEmptyDOMElement();
});
