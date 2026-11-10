import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import QuoPhoneTrigger from "@/components/leads/QuoPhoneTrigger";
import { useAuth } from "@/contexts/AuthContext";
import { fetchQuoChatThread, sendQuoChatMessage } from "@/lib/quo-chat";
import { formatLocalRelativeTime, prepareQuoChatViaExtension, sendQuoMessageViaExtension } from "@/lib/quo-dashboard";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/quo-chat", () => ({
  fetchQuoChatThread: vi.fn().mockResolvedValue({
    contact: { participant: "+15551234567" },
    phoneNumber: {
      id: "PN123",
      number: "+15551230000",
      formattedNumber: "+1 (555) 123-0000",
      name: "Main Line",
    },
    conversation: null,
    messages: [],
  }),
  sendQuoChatMessage: vi.fn(),
}));

vi.mock("@/lib/quo-dashboard", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/quo-dashboard")>();
  return {
    ...original,
    prepareQuoChatViaExtension: vi.fn(),
    sendQuoMessageViaExtension: vi.fn().mockResolvedValue({ success: true }),
  };
});

describe("QuoPhoneTrigger", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("opens the Quo drawer for admins and shows a normalized phone number", async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: "admin",
    } as unknown as ReturnType<typeof useAuth>);

    render(
      <QuoPhoneTrigger contactName="Jane Doe" phone="(555) 123-4567">
        (555) 123-4567
      </QuoPhoneTrigger>,
    );

    fireEvent.click(screen.getByRole("button", { name: /\(555\) 123-4567/i }));

    expect(await screen.findByText("No messages in this chat yet.")).toBeInTheDocument();
    expect(screen.getAllByText("(555) 123-4567").length).toBeGreaterThan(0);
    expect(screen.getByText("(Jane Doe)")).toBeInTheDocument();
    expect(fetchQuoChatThread).toHaveBeenCalledWith("+15551234567", undefined);
  });

  it("passes chat type when loading the thread", async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: "admin",
      canAccess: vi.fn(() => true),
    } as unknown as ReturnType<typeof useAuth>);

    render(
      <QuoPhoneTrigger contactName="Jane Doe" phone="(555) 123-4567" chatType="customer">
        (555) 123-4567
      </QuoPhoneTrigger>,
    );

    fireEvent.click(screen.getByRole("button", { name: /\(555\) 123-4567/i }));

    await waitFor(() => {
      expect(fetchQuoChatThread).toHaveBeenCalledWith("+15551234567", "customer");
    });
  });

  it("sends the saved Quo conversation URL to the extension", async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: "admin",
      canAccess: vi.fn(() => true),
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(fetchQuoChatThread).mockResolvedValueOnce({
      contact: { participant: "+15551234567" },
      phoneNumber: {
        id: "PN123",
        number: "+15551230000",
        formattedNumber: "+1 (555) 123-0000",
        name: "Main Line",
      },
      conversation: {
        databaseId: "00000000-0000-4000-8000-000000000123",
        id: "CN_saved_conversation",
        phoneNumberId: "PN123",
        participants: ["+15551234567"],
      },
      messages: [],
    });
    const subscribe = vi.fn().mockImplementation((onStatus?: (status: string) => void) => {
      onStatus?.("SUBSCRIBED");
      return realtimeChannel;
    });
    const realtimeChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe,
      unsubscribe: vi.fn(),
    };
    vi.spyOn(supabase, "channel").mockReturnValue(realtimeChannel as unknown as ReturnType<typeof supabase.channel>);
    vi.spyOn(supabase, "removeChannel").mockResolvedValue("ok");

    render(
      <QuoPhoneTrigger contactName="Jane Doe" phone="(555) 123-4567">
        (555) 123-4567
      </QuoPhoneTrigger>,
    );
    fireEvent.click(screen.getByRole("button", { name: /\(555\) 123-4567/i }));

    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Use exact chat" } });

    await waitFor(() => {
      expect(prepareQuoChatViaExtension).toHaveBeenCalledWith(
        "https://my.quo.com/inbox/PN123/c/CN_saved_conversation",
      );
    });
    expect(fetchQuoChatThread).toHaveBeenCalledTimes(1);
    expect(realtimeChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "quo_messages",
        filter: "conversation_id=eq.00000000-0000-4000-8000-000000000123",
      },
      expect.any(Function),
    );

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(sendQuoMessageViaExtension).toHaveBeenCalledWith(
        "https://my.quo.com/inbox/PN123/c/CN_saved_conversation",
        "Use exact chat",
      );
    });
  });

  it("renders plain text for non-admin users", () => {
    vi.mocked(useAuth).mockReturnValue({
      role: "customer_service",
    } as unknown as ReturnType<typeof useAuth>);

    render(
      <QuoPhoneTrigger contactName="Jane Doe" phone="(555) 123-4567">
        (555) 123-4567
      </QuoPhoneTrigger>,
    );

    expect(screen.queryByRole("button", { name: /\(555\) 123-4567/i })).not.toBeInTheDocument();
    expect(screen.getByText("(555) 123-4567")).toBeInTheDocument();
  });
  it("opens a pinned CRM-only review without composing, queuing or launching Quo", async () => {
    vi.mocked(useAuth).mockReturnValue({ role: "admin" } as ReturnType<typeof useAuth>);
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    const close = vi.fn();
    const id = "00000000-0000-4000-8000-000000000123";
    render(<QuoPhoneTrigger contactName="Synthetic Tech" phone="4155550199" chatType="tech" conversationId={id} defaultOpen hideTrigger readOnly initialMessage="Must not become an outbound message" onClose={close} />);
    const panel = await screen.findByRole("dialog", { name: "Tech Quick Chat: Synthetic Tech" });
    expect(fetchQuoChatThread).toHaveBeenCalledExactlyOnceWith("+14155550199", "tech", id);
    expect(panel).toHaveTextContent("No Quo login is needed to read");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
    expect(prepareQuoChatViaExtension).not.toHaveBeenCalled();
    expect(sendQuoMessageViaExtension).not.toHaveBeenCalled();
    expect(sendQuoChatMessage).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not read a pinned chat without the independent Tech Quick Chat grant", () => {
    vi.mocked(useAuth).mockReturnValue({ role: "processor", canAccess: () => false } as unknown as ReturnType<typeof useAuth>);
    render(<QuoPhoneTrigger contactName="Synthetic Tech" phone="4155550199" chatType="tech" conversationId="00000000-0000-4000-8000-000000000123" defaultOpen hideTrigger readOnly />);
    expect(fetchQuoChatThread).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("exposes a failed CRM read instead of opening an external fallback", async () => {
    vi.mocked(useAuth).mockReturnValue({ role: "admin" } as ReturnType<typeof useAuth>);
    vi.mocked(fetchQuoChatThread).mockRejectedValueOnce(new Error("Synthetic CRM chat unavailable"));
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<QuoPhoneTrigger contactName="Synthetic Tech" phone="4155550199" chatType="tech" conversationId="00000000-0000-4000-8000-000000000123" defaultOpen hideTrigger readOnly />);
    expect(await screen.findByText("Synthetic CRM chat unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No messages in this chat yet.")).not.toBeInTheDocument();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("shows the last message time on the CX and Tech Quick Chat buttons only", async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: "admin",
      canAccess: vi.fn(() => true),
    } as unknown as ReturnType<typeof useAuth>);
    const reads: string[] = [];
    vi.spyOn(supabase, "from").mockImplementation(((table: string) => {
      reads.push(table);
      const builder = {
        select: () => builder,
        in: () => builder,
        order: () => Promise.resolve({
          data: [
            { customer_number: "+15551234567", last_customer_message_at: "2026-11-08T14:00:00Z", last_agent_message_at: "2026-11-08T15:30:00Z", last_message_at: "2026-11-08T15:30:00Z", quo_phone_numbers: { number: "+15551230000", display_number: null, name: "Main Line" } },
          ],
          error: null,
        }),
      };
      return builder;
    }) as never);

    render(
      <>
        <QuoPhoneTrigger contactName="Jane Doe" phone="(555) 123-4567" chatType="customer" showLastMessageTime>
          <span>CX Quick Chat</span>
        </QuoPhoneTrigger>
        <QuoPhoneTrigger contactName="Jane Doe" phone="(555) 123-4567" chatType="customer">
          (555) 123-4567
        </QuoPhoneTrigger>
      </>,
    );

    const expected = formatLocalRelativeTime("2026-11-08T15:30:00Z", true);
    const time = await screen.findByText(expected);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2026-11-08T15:30:00.000Z");
    expect(screen.getByRole("button", { name: /CX Quick Chat/ })).toContainElement(time);
    expect(screen.getAllByText(expected)).toHaveLength(1);
    // Both buttons share one batched read; no per-button request.
    expect(reads.filter((table) => table === "quo_conversations")).toHaveLength(1);
  });
  describe("unread badge polling in a hidden tab", () => {
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    afterEach(() => {
      setVisibility("visible");
      vi.useRealTimers();
    });

    const renderBadgeTrigger = () => {
      vi.mocked(useAuth).mockReturnValue({
        role: "admin",
        canAccess: vi.fn(() => true),
      } as unknown as ReturnType<typeof useAuth>);
      const reads: string[] = [];
      vi.spyOn(supabase, "from").mockImplementation(((table: string) => {
        reads.push(table);
        const builder = {
          select: () => builder,
          in: () => builder,
          order: () => Promise.resolve({ data: [], error: null }),
        };
        return builder;
      }) as never);
      render(
        <QuoPhoneTrigger contactName="Jane Doe" phone="(555) 123-4567" chatType="customer" showLastMessageTime>
          <span>CX Quick Chat</span>
        </QuoPhoneTrigger>,
      );
      return () => reads.filter((table) => table === "quo_conversations").length;
    };

    it("skips the 60-second unread read while hidden and catches up once on return", async () => {
      vi.useFakeTimers();
      const unreadReads = renderBadgeTrigger();
      await vi.advanceTimersByTimeAsync(250);
      expect(unreadReads()).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(unreadReads()).toBe(2); // visible: normal 60 s poll

      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(180_000);
      expect(unreadReads()).toBe(2); // three hidden ticks, no reads

      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(250);
      expect(unreadReads()).toBe(3); // one catch-up read, not three

      await vi.advanceTimersByTimeAsync(60_000);
      expect(unreadReads()).toBe(4); // polling resumes
    });

    it("does not add a read when the tab returns before any tick was skipped", async () => {
      vi.useFakeTimers();
      const unreadReads = renderBadgeTrigger();
      await vi.advanceTimersByTimeAsync(250);
      expect(unreadReads()).toBe(1);

      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(10_000);
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(250);
      expect(unreadReads()).toBe(1);
    });

    it("stops listening once the last badge unmounts", async () => {
      vi.useFakeTimers();
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const unreadReads = renderBadgeTrigger();
      await vi.advanceTimersByTimeAsync(250);
      cleanup();
      expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(120_000);
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(250);
      expect(unreadReads()).toBe(1);
    });
  });
});
