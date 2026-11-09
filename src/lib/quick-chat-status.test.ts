import { describe, expect, it } from "vitest";
import { latestChatTime, quickChatStatus, type QuickChatConversationRow } from "@/lib/quick-chat-status";

const row = (over: Partial<QuickChatConversationRow>): QuickChatConversationRow => ({
  last_customer_message_at: null,
  last_agent_message_at: null,
  last_message_at: null,
  isTechLine: false,
  ...over,
});

describe("quickChatStatus", () => {
  it("shows the last message time whoever sent it", () => {
    const fromAgent = quickChatStatus([row({ last_customer_message_at: "2026-11-08T10:00:00Z", last_agent_message_at: "2026-11-08T12:30:00Z" })], "customer");
    expect(fromAgent).toEqual({ fromContact: false, lastMessageAt: "2026-11-08T12:30:00.000Z" });
    const fromCustomer = quickChatStatus([row({ last_customer_message_at: "2026-11-08T13:00:00Z", last_agent_message_at: "2026-11-08T12:30:00Z" })], "customer");
    expect(fromCustomer).toEqual({ fromContact: true, lastMessageAt: "2026-11-08T13:00:00.000Z" });
  });

  it("uses last_message_at when it is the newest (e.g. a call)", () => {
    const status = quickChatStatus([row({ last_message_at: "2026-11-09T08:00:00Z", last_agent_message_at: "2026-11-08T12:30:00Z" })], "customer");
    expect(status.lastMessageAt).toBe("2026-11-09T08:00:00.000Z");
  });

  it("keeps CX and Tech times on their own lines", () => {
    const rows = [
      row({ isTechLine: true, last_message_at: "2026-11-09T09:00:00Z" }),
      row({ isTechLine: false, last_message_at: "2026-11-07T09:00:00Z" }),
    ];
    expect(quickChatStatus(rows, "tech").lastMessageAt).toBe("2026-11-09T09:00:00.000Z");
    expect(quickChatStatus(rows, "customer").lastMessageAt).toBe("2026-11-07T09:00:00.000Z");
  });

  it("shows no time for a line with no conversation, but keeps the unread dot fallback", () => {
    const rows = [row({ isTechLine: false, last_customer_message_at: "2026-11-09T09:00:00Z" })];
    expect(quickChatStatus(rows, "tech")).toEqual({ fromContact: true, lastMessageAt: null });
    expect(quickChatStatus([], "customer")).toEqual({ fromContact: false, lastMessageAt: null });
  });

  it("ignores missing or invalid timestamps", () => {
    expect(quickChatStatus([row({ last_message_at: "not a date" })], "customer").lastMessageAt).toBeNull();
    expect(latestChatTime(null, undefined, "bad")).toBeNull();
    expect(latestChatTime("2026-11-08T10:00:00Z", "2026-11-08T11:00:00Z")).toBe("2026-11-08T11:00:00.000Z");
  });
});
