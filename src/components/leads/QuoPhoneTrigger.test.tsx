import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import QuoPhoneTrigger from "@/components/leads/QuoPhoneTrigger";
import { useAuth } from "@/contexts/AuthContext";
import { fetchQuoChatThread } from "@/lib/quo-chat";
import { prepareQuoChatViaExtension, sendQuoMessageViaExtension } from "@/lib/quo-dashboard";
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
});
