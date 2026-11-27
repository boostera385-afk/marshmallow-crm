import { describe, expect, it } from "vitest";
import { isEvidenceMessage, parseTechChat, techChatItems } from "./tech-chat";

const rows = parseTechChat([
  { id: "1", sender: "agent", kind: "text", text: "Hi Josh, can you do Christmas lights in Irving tomorrow 2pm for $400?", message_time: "2026-11-27T10:00:00Z", has_media: false },
  { id: "2", sender: "agent", kind: "call", text: "Call completed.", message_time: "2026-11-27T10:05:00Z", has_media: false },
  { id: "3", sender: "agent", kind: "call", text: "Call recording completed.", message_time: "2026-11-27T10:05:01Z", has_media: false },
  { id: "4", sender: "customer", kind: "call", text: "Call summary completed.", message_time: "2026-11-27T10:05:02Z", has_media: false },
  { id: "5", sender: "customer", kind: "call", text: "Call transcript: Customer: Hello?\nAgent: Hi Josh", message_time: "2026-11-27T10:05:03Z", has_media: false },
  { id: "6", sender: "customer", kind: "text", text: "Yes I can do it", message_time: "2026-11-27T10:10:00Z", has_media: false },
  { id: "7", sender: "customer", kind: "text", text: "", message_time: "2026-11-27T10:11:00Z", has_media: true },
  { id: "8", sender: "customer", kind: "text", text: "  ", message_time: "2026-11-27T10:12:00Z", has_media: false },
  null,
  { sender: "agent" },
]);

describe("tech chat", () => {
  it("parses only well-formed rows", () => {
    expect(rows.map((row) => row.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("keeps our message, the tech's replies and meaningful call events, dropping Quo bookkeeping", () => {
    const items = techChatItems(rows);
    expect(items.map((item) => item.id)).toEqual(["1", "2", "5", "6", "7"]);
    expect(items[0]).toMatchObject({ type: "text", fromUs: true });
    expect(items[1]).toMatchObject({ type: "call", label: "Call completed", detail: null });
    expect(items[2]).toMatchObject({ type: "call", label: "Call transcript", detail: "Customer: Hello?\nAgent: Hi Josh" });
    expect(items[3]).toMatchObject({ type: "text", fromUs: false, text: "Yes I can do it" });
    expect(items[4]).toMatchObject({ type: "text", hasMedia: true });
  });

  it("points at the tech message the AI quoted, never at ours", () => {
    const items = techChatItems(rows);
    expect(items.filter((item) => isEvidenceMessage(item, "yes  i can do it")).map((item) => item.id)).toEqual(["6"]);
    expect(items.some((item) => isEvidenceMessage(item, "Christmas lights"))).toBe(false);
    expect(items.some((item) => isEvidenceMessage(item, null))).toBe(false);
  });
});
