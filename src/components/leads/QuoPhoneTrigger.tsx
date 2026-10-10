import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCheck, Loader2, MessageSquare, Phone, Send, Clock, ChevronDown, GripHorizontal, Minus, Maximize2, X, Wrench } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import type { Tables, Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneE164, stripPhone } from "@/lib/phone";
import { fetchQuoChatThread, sendQuoChatMessage, type QuoChatMessage, type QuoChatThreadResponse } from "@/lib/quo-chat";
import {
  formatEasternTime,
  formatLocalRelativeTime,
  formatUsPhone,
  getQuoChatUrl,
  getQuoNumberEmoji,
  getQuoNumberName,
  isTechLineNumber,
  normalizeQuoLeadStatus,
  prepareQuoChatViaExtension,
  QUO_LEAD_STATUS_CONFIG,
  sendQuoMessageViaExtension,
  scheduleQuoMessageViaExtension,
} from "@/lib/quo-dashboard";
import ImageLightbox from "@/components/leads/ImageLightbox";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import RenderEmoji from "@/components/common/RenderEmoji";

interface QuoPhoneTriggerProps {
  contactName: string;
  phone?: string | null;
  className?: string;
  children?: ReactNode;
  chatType?: "customer" | "tech";
  initialMessage?: string;
}

function getPhoneKey(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

type UnreadConversation = Pick<Tables<"quo_conversations">, "customer_number" | "last_customer_message_at" | "last_agent_message_at" | "last_message_at"> & { quo_phone_numbers: Pick<Tables<"quo_phone_numbers">, "number" | "display_number" | "name"> | null };
type RealtimeChatMessage = Pick<Tables<"quo_messages">, "id" | "sender" | "text" | "conversation_id" | "direction" | "status" | "message_time" | "created_at"> & { recipients?: Json; quo_created_at?: string | null; media?: QuoChatMessage["media"] };

const QUICK_CHAT_UNREAD_REFRESH_DELAY = 200;
const QUICK_CHAT_UNREAD_CHUNK_SIZE = 50;
const quickChatUnreadWatchers = new Map<
  string,
  { phone: string; chatType?: "customer" | "tech"; setState: (value: boolean) => void }
>();
let quickChatUnreadRefreshTimer: ReturnType<typeof setTimeout> | null = null;
// Unread status is polled rather than driven by a realtime subscription on the
// whole quo_conversations table, which used to fan every chat message out to
// every connected user and dominated realtime message usage.
const QUICK_CHAT_UNREAD_POLL_MS = 60000;
// A filtered Realtime channel handles the open conversation. This interval is
// used only as a fallback while that channel is disconnected.
const QUICK_CHAT_THREAD_POLL_MS = 5000;
let quickChatUnreadPollTimer: ReturnType<typeof setInterval> | null = null;
let nextQuickChatUnreadWatcherId = 0;
let nextQuickChatRealtimeChannelId = 0;

function scheduleQuickChatUnreadRefresh() {
  if (quickChatUnreadRefreshTimer) clearTimeout(quickChatUnreadRefreshTimer);
  quickChatUnreadRefreshTimer = setTimeout(() => {
    void refreshQuickChatUnreadStatuses();
  }, QUICK_CHAT_UNREAD_REFRESH_DELAY);
}

async function refreshQuickChatUnreadStatuses() {
  const watchers = Array.from(quickChatUnreadWatchers.values());
  if (watchers.length === 0) {
    if (quickChatUnreadRefreshTimer) {
      clearTimeout(quickChatUnreadRefreshTimer);
      quickChatUnreadRefreshTimer = null;
    }
    if (quickChatUnreadPollTimer) {
      clearInterval(quickChatUnreadPollTimer);
      quickChatUnreadPollTimer = null;
    }
    return;
  }

  const phones = Array.from(
    new Set(
      watchers
        .map((watcher) => normalizePhoneE164(watcher.phone) ?? getPhoneKey(watcher.phone))
        .filter(Boolean),
    ),
  );

  if (!phones.length) return;

  const rowsByPhone = new Map<string, UnreadConversation[]>();

  for (let index = 0; index < phones.length; index += QUICK_CHAT_UNREAD_CHUNK_SIZE) {
    const chunk = phones.slice(index, index + QUICK_CHAT_UNREAD_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("quo_conversations")
      .select("customer_number,last_customer_message_at,last_agent_message_at,last_message_at,quo_phone_numbers(number,display_number,name)")
      .in("customer_number", chunk)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (error) {
      console.warn("Failed to refresh Quo unread status", error);
      continue;
    }

    for (const row of data ?? []) {
      const normalized = normalizePhoneE164(row.customer_number) ?? getPhoneKey(row.customer_number);
      if (!normalized) continue;
      const nextRows = rowsByPhone.get(normalized) ?? [];
      nextRows.push(row);
      rowsByPhone.set(normalized, nextRows);
    }
  }

  watchers.forEach((watcher) => {
    const normalized = normalizePhoneE164(watcher.phone) ?? getPhoneKey(watcher.phone);
    const rows = normalized ? rowsByPhone.get(normalized) ?? [] : [];
    let match: UnreadConversation | null = null;
    if (rows.length > 0) {
      match =
        rows.find((row) => {
          const numRow = row.quo_phone_numbers;
          const isTech = isTechLineNumber(numRow?.number || numRow?.display_number || numRow?.name);
          return watcher.chatType === "tech" ? isTech : !isTech;
        }) ?? rows[0];
    }

    const customerAt = match?.last_customer_message_at ? new Date(match.last_customer_message_at).getTime() : 0;
    const agentAt = match?.last_agent_message_at ? new Date(match.last_agent_message_at).getTime() : 0;
    watcher.setState(customerAt > 0 && customerAt > agentAt);
  });
}

function ensureQuickChatUnreadPolling() {
  if (quickChatUnreadPollTimer) return;
  quickChatUnreadPollTimer = setInterval(() => {
    scheduleQuickChatUnreadRefresh();
  }, QUICK_CHAT_UNREAD_POLL_MS);
}

function mergeQuoMessages(messages: QuoChatMessage[]) {
  return Array.from(new Map(messages.map((message) => [message.id, message])).values()).sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export default function QuoPhoneTrigger({
  contactName,
  phone,
  className,
  children,
  chatType,
  initialMessage,
}: QuoPhoneTriggerProps) {
  const auth = useAuth();
  const role = auth.role;
  const [open, setOpen] = useState(false);

  const trimmedPhone = phone?.trim() ?? "";
  const normalizedPhone = useMemo(() => normalizePhoneE164(trimmedPhone), [trimmedPhone]);
  const fallbackPhone = stripPhone(trimmedPhone) || trimmedPhone;
  const panelPhone = normalizedPhone ?? fallbackPhone;
  const triggerLabel = children ?? trimmedPhone;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<QuoChatMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customScheduleTime, setCustomScheduleTime] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Conversation metadata for header details
  const [conversationMeta, setConversationMeta] = useState<{
    databaseId?: string;
    id?: string;
    quoConversationId?: string;
    quoPhoneNumberId?: string;
    phoneNumberObj?: QuoChatThreadResponse["phoneNumber"];
    numberName?: string;
    numberEmoji?: string;
    status?: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const preparedChatUrlRef = useRef("");
  const threadRealtimeHealthyRef = useRef(false);
  const realtimeChannelIdRef = useRef(++nextQuickChatRealtimeChannelId);
  // Kept in refs so the live-refresh interval can read the latest minimize state
  // and re-trigger a load without tearing down and rebuilding the subscription.
  const isMinimizedRef = useRef(isMinimized);
  useEffect(() => { isMinimizedRef.current = isMinimized; }, [isMinimized]);
  const loadThreadRef = useRef<((showLoading: boolean) => void) | null>(null);
  const prevMinimizedRef = useRef(isMinimized);
  const isAdmin = role === "admin";
  const requiredAccessKey = chatType === "tech" ? "tech_quick_chat" : "quick_chat";
  // Quick Chat is available to admins and to any user an admin granted access to.
  const canUseQuickChat = isAdmin || auth.canAccess?.(requiredAccessKey) === true;
  const [lastFromCustomer, setLastFromCustomer] = useState(false);

  useEffect(() => {
    if (open && initialMessage) setMessageDraft(initialMessage);
  }, [initialMessage, open]);

  // Shared unread-status subscriber: batch all visible numbers to avoid one subscription per trigger.
  useEffect(() => {
    if (!canUseQuickChat || !normalizedPhone) return;

    const watcherId = ++nextQuickChatUnreadWatcherId;
    const watcherKey = `${chatType ?? "customer"}:${normalizedPhone}:${watcherId}`;
    quickChatUnreadWatchers.set(watcherKey, {
      phone: normalizedPhone,
      chatType,
      setState: setLastFromCustomer,
    });

    ensureQuickChatUnreadPolling();
    scheduleQuickChatUnreadRefresh();

    return () => {
      quickChatUnreadWatchers.delete(watcherKey);
      if (quickChatUnreadWatchers.size === 0) {
        if (quickChatUnreadRefreshTimer) {
          clearTimeout(quickChatUnreadRefreshTimer);
          quickChatUnreadRefreshTimer = null;
        }
        if (quickChatUnreadPollTimer) {
          clearInterval(quickChatUnreadPollTimer);
          quickChatUnreadPollTimer = null;
        }
      } else {
        scheduleQuickChatUnreadRefresh();
      }
    };
  }, [canUseQuickChat, normalizedPhone, chatType]);


  useEffect(() => {
    if (!canUseQuickChat || !open || !normalizedPhone) return;

    let active = true;

    const loadThread = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      setError(null);

      try {
        const response = await fetchQuoChatThread(normalizedPhone, chatType);
        if (!active) return;
        if (!response) throw new Error("Quick Chat returned no thread data");
        setMessages((prev) => {
          const next = mergeQuoMessages(response.messages ?? []);
          // Keep the same array reference when nothing changed, so a silent poll
          // refresh doesn't re-render or force-scroll a user reading history.
          if (prev.length === next.length && prev.every((m, i) => m.id === next[i].id)) return prev;
          return next;
        });

        const numObj = response.phoneNumber;
        const numName = getQuoNumberName(numObj, numObj?.formattedNumber);
        const numEmoji = getQuoNumberEmoji(numObj, numObj?.formattedNumber);
        const convStatus = response.conversation?.current_status || response.conversation?.status || "raw";

        setConversationMeta({
          databaseId: response.conversation?.databaseId,
          id: response.conversation?.id,
          // fetchQuoChatThread already maps the external Quo IDs onto these
          // response fields. Reading quo_conversation_id here made every lead
          // fall back to an inbox-only ?phone= URL instead of its saved chat.
          quoConversationId: response.conversation?.id,
          quoPhoneNumberId: response.conversation?.phoneNumberId || response.phoneNumber?.id,
          phoneNumberObj: numObj,
          numberName: numName,
          numberEmoji: numEmoji,
          status: convStatus,
        });

      } catch (fetchError) {
        if (!active) return;
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load Quo messages");
        setMessages([]);
        setConversationMeta(null);
      } finally {
        if (active && showLoading) setLoading(false);
      }
    };

    setMessages([]);
    void loadThread(true);

    // Expose the loader so expanding a minimized chat can refresh instantly.
    loadThreadRef.current = (showLoading: boolean) => { if (active) void loadThread(showLoading); };

    // Five-second querying is only a fallback while the targeted Realtime
    // channel is unavailable. Healthy Realtime connections do not poll.
    const shouldPoll = () =>
      active && !isMinimizedRef.current && (typeof document === "undefined" || document.visibilityState === "visible");
    const pollId = setInterval(() => {
      if (shouldPoll() && !threadRealtimeHealthyRef.current) void loadThread(false);
    }, QUICK_CHAT_THREAD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && shouldPoll() && !threadRealtimeHealthyRef.current) {
        void loadThread(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      loadThreadRef.current = null;
      clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [canUseQuickChat, normalizedPhone, open, chatType]);

  useEffect(() => {
    const databaseConversationId = conversationMeta?.databaseId;
    if (!canUseQuickChat || !open || !databaseConversationId) {
      threadRealtimeHealthyRef.current = false;
      return;
    }

    const channel = supabase
      .channel(`quick-chat-${databaseConversationId}-${realtimeChannelIdRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "quo_messages",
          filter: `conversation_id=eq.${databaseConversationId}`,
        },
        (payload) => {
          const row = payload.new as RealtimeChatMessage;
          if (!row?.id) return;
          const newMessage: QuoChatMessage = {
            id: row.id,
            to: Array.isArray(row.recipients) ? row.recipients.map((entry: unknown) => String(entry)) : [],
            from: row.sender ?? "",
            text: row.text ?? "",
            phoneNumberId: conversationMeta?.quoPhoneNumberId ?? "",
            conversationId: row.conversation_id,
            direction: row.direction === "outgoing" ? "outgoing" : "incoming",
            status: row.status,
            createdAt: row.message_time ?? row.quo_created_at ?? row.created_at,
            media: Array.isArray(row.media) ? row.media : [],
          };
          setMessages((previous) => mergeQuoMessages([...previous, newMessage]));
        },
      )
      .subscribe((status) => {
        threadRealtimeHealthyRef.current = status === "SUBSCRIBED";
      });

    return () => {
      threadRealtimeHealthyRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [canUseQuickChat, open, conversationMeta?.databaseId, conversationMeta?.quoPhoneNumberId]);

  // Expanding a minimized chat refreshes the thread immediately, so the user
  // doesn't wait up to a poll interval to see messages that arrived while it was
  // collapsed. (Opening from closed is handled by the load effect above.)
  useEffect(() => {
    const wasMinimized = prevMinimizedRef.current;
    prevMinimizedRef.current = isMinimized;
    if (open && wasMinimized && !isMinimized) loadThreadRef.current?.(false);
  }, [isMinimized, open]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, open]);

  // Pre-open the exact Quo conversation on the first typed character. This
  // gives Quo time to load in its background tab while the user finishes the
  // message, without adding any database traffic.
  useEffect(() => {
    if (!messageDraft.trim()) {
      preparedChatUrlRef.current = "";
      return;
    }
    if (!open || !normalizedPhone || !conversationMeta?.quoConversationId) return;

    const chatUrl = getQuoChatUrl(
      conversationMeta.quoConversationId,
      normalizedPhone,
      conversationMeta.quoPhoneNumberId,
    );
    if (preparedChatUrlRef.current === chatUrl) return;

    preparedChatUrlRef.current = chatUrl;
    prepareQuoChatViaExtension(chatUrl);
  }, [
    messageDraft,
    open,
    normalizedPhone,
    conversationMeta?.quoConversationId,
    conversationMeta?.quoPhoneNumberId,
  ]);

  const handleSend = async () => {
    if (!normalizedPhone) {
      setError("This number could not be normalized to E.164.");
      return;
    }

    const content = messageDraft.trim();
    if (!content) return;

    setSending(true);
    setError(null);
    setMessageDraft("");

    const nowIso = new Date().toISOString();
    const tempId = `temp_${Date.now()}`;

    // Construct Chat URL for OpenPhone / my.quo.com
    const chatUrl = getQuoChatUrl(
      conversationMeta?.quoConversationId,
      normalizedPhone,
      conversationMeta?.quoPhoneNumberId
    );

    // Save message via API / Supabase
    try {
      await sendQuoChatMessage(normalizedPhone, content, chatType);
    } catch (sendErr) {
      console.warn("sendQuoChatMessage save warning:", sendErr);
    }

    // Trigger Chrome Extension postMessage and await QUO_SEND_MESSAGE_RESPONSE
    const toastId = toast.loading("Sending via QUO Extension...");

    try {
      const extRes = await sendQuoMessageViaExtension(chatUrl, content);
      if (extRes.success) {
        toast.success("Success! The message was pasted and sent via QUO.", { id: toastId });
      } else {
        let errorMsg = extRes.error || "Failed to complete send";
        if (errorMsg.includes("Could not find message input editor")) {
          const numName = conversationMeta?.numberName || "this number";
          errorMsg = `Couldn't open the chat box in Quo for ${numName}. Make sure a Quo tab is open and try again.`;
        }
        toast.error(`Extension notice: ${errorMsg}`, { id: toastId });
      }
    } catch (err) {
      toast.error(`Extension notice: ${(err as { message?: string } | null)?.message || "Extension dispatch error"}`, { id: toastId });
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async (scheduleTime: string) => {
    if (!normalizedPhone) {
      setError("This number could not be normalized to E.164.");
      return;
    }

    const content = messageDraft.trim();
    if (!content) return;

    setSending(true);
    setError(null);
    setMessageDraft("");
    setCustomScheduleTime("");
    setScheduleOpen(false);

    const chatUrl = getQuoChatUrl(
      conversationMeta?.quoConversationId,
      normalizedPhone,
      conversationMeta?.quoPhoneNumberId
    );

    const toastId = toast.loading(`Scheduling message for "${scheduleTime}" via Extension...`);

    try {
      const extRes = await scheduleQuoMessageViaExtension(chatUrl, content, scheduleTime);
      if (extRes.success) {
        toast.success(`Success! Message scheduled for "${scheduleTime}".`, { id: toastId });
      } else {
        let errorMsg = extRes.error || "Cancelled";
        if (errorMsg.includes("Could not find message input editor")) {
          const numName = conversationMeta?.numberName || "this number";
          errorMsg = `Couldn't open the chat box in Quo for ${numName}. Make sure a Quo tab is open and try again.`;
        }
        toast.error(`Failed to schedule: ${errorMsg}`, { id: toastId });
      }
    } catch (err) {
      toast.error(`Failed to schedule: ${(err as { message?: string } | null)?.message || "Extension error"}`, { id: toastId });
    } finally {
      setSending(false);
    }
  };

  if (!trimmedPhone) {
    return null;
  }

  if (!canUseQuickChat) {
    return <span className={className}>{triggerLabel}</span>;
  }

  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showCustomerDot = latestMessage ? latestMessage.direction === "incoming" : lastFromCustomer;

  const currentStatusKey = normalizeQuoLeadStatus(conversationMeta?.status);
  const statusCfg = QUO_LEAD_STATUS_CONFIG[currentStatusKey];

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 text-left font-medium text-primary underline decoration-primary/35 underline-offset-4 transition-colors hover:text-primary/80",
          className,
        )}
      >
        <Phone className="h-3.5 w-3.5 shrink-0" />
        <span>{triggerLabel}</span>
        {showCustomerDot && (
          <span
            className="relative ml-0.5 flex h-2 w-2 shrink-0"
            title="Customer sent the last message"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
            <AnimatePresence>
              <motion.div
                drag
                dragMomentum={false}
                dragElastic={0.05}
                initial={{ opacity: 0, scale: 0.94, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 20 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto absolute w-[92vw] max-w-[500px] rounded-2xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.75)] flex flex-col z-[70] overflow-hidden"
                style={{
                  bottom: "20px",
                  right: chatType === "tech" ? "530px" : "20px",
                  height: isMinimized ? "auto" : "540px",
                }}
              >
                {/* Header Bar - Drag handle */}
                <div className="group cursor-grab active:cursor-grabbing flex items-center justify-between border-b border-border/50 bg-muted/40 px-3.5 py-2.5 select-none shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <GripHorizontal className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors shrink-0" />
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-lg font-semibold text-xs shrink-0",
                        chatType === "tech"
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {chatType === "tech" ? <Wrench className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold tracking-tight truncate text-foreground">
                          {chatType === "tech" ? "Tech Quick Chat" : "CX Quick Chat"}: {formatUsPhone(panelPhone)}
                        </span>
                        {contactName && (
                          <span className="text-[11px] font-normal text-muted-foreground truncate hidden sm:inline">
                            ({contactName})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {conversationMeta?.numberName && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <RenderEmoji emoji={conversationMeta.numberEmoji} size="sm" />
                            <span className="truncate max-w-[130px]">{conversationMeta.numberName}</span>
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 font-semibold ${statusCfg.badgeClass}`}
                        >
                          {statusCfg.label}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsMinimized(!isMinimized)}
                      className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                      title={isMinimized ? "Expand Chat" : "Minimize Chat"}
                    >
                      {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setOpen(false)}
                      className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Close Chat"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Body & Footer (hidden when minimized) */}
                {!isMinimized && (
                  <>
                    {/* Messages Stream Body */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-background/40">
                      {loading ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground gap-2 text-xs">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          Loading chat messages...
                        </div>
                      ) : error ? (
                        <div className="flex items-center justify-center h-full text-center text-xs text-destructive">
                          {error}
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1 text-xs">
                          <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-1" />
                          <span>No messages in this chat yet.</span>
                        </div>
                      ) : (
                        messages.map((message) => {
                          const isOutbound = message.direction === "outgoing" || message.from === "agent";

                          return (
                            <div
                              key={message.id}
                              className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
                            >
                              <div
                                className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed ${
                                  isOutbound
                                    ? "bg-primary text-primary-foreground rounded-br-xs"
                                    : "bg-muted/90 text-foreground border border-border/50 rounded-bl-xs"
                                }`}
                              >
                                {message.media && message.media.length > 0 && (
                                  <div className="flex flex-col gap-2 mb-2">
                                    {message.media.map((mediaItem, idx) => {
                                      const isAudio = mediaItem.type?.startsWith("audio") || mediaItem.mime_type?.startsWith("audio");
                                      const isImage = mediaItem.type?.startsWith("image") || mediaItem.mime_type?.startsWith("image");
                                      const url = mediaItem.url || mediaItem.src;
                                      if (!url) return null;

                                      if (isAudio) {
                                        return (
                                          <audio
                                            key={idx}
                                            controls
                                            src={url}
                                            className="w-full max-w-[240px] h-10"
                                            preload="metadata"
                                          />
                                        );
                                      } else if (isImage) {
                                        return (
                                          <img
                                            key={idx}
                                            src={url}
                                            alt="MMS attachment"
                                            className="w-48 h-auto max-h-48 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity border border-white/20 shadow-sm"
                                            onClick={() => {
                                              const allImages: string[] = [];
                                              let clickedIndex = 0;
                                              messages.forEach((m) => {
                                                if (m.media) {
                                                  m.media.forEach((mi) => {
                                                    if ((mi.type?.startsWith("image") || mi.mime_type?.startsWith("image")) && (mi.url || mi.src)) {
                                                      if ((mi.url || mi.src) === url) clickedIndex = allImages.length;
                                                      allImages.push(mi.url || mi.src);
                                                    }
                                                  });
                                                }
                                              });
                                              setLightboxImages(allImages);
                                              setLightboxIndex(clickedIndex);
                                              setLightboxOpen(true);
                                            }}
                                          />
                                        );
                                      }
                                      return null;
                                    })}
                                  </div>
                                )}
                                {message.text && (
                                  <p className="whitespace-pre-wrap break-words">{message.text}</p>
                                )}
                                {!message.text && (!message.media || message.media.length === 0) && (
                                  <p className="whitespace-pre-wrap break-words italic opacity-70">
                                    {message.status ? `[ ${message.status.replace(/\./g, ' ')} ]` : "—"}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-muted-foreground">
                                <span>{formatLocalRelativeTime(message.createdAt, true)}</span>
                                {isOutbound && <CheckCheck className="h-3 w-3 text-primary/70" />}
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Chat Input Footer */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSend();
                      }}
                      className="p-3 border-t border-border/50 bg-background/80 flex items-end gap-2 shrink-0"
                    >
                      <Textarea
                        value={messageDraft}
                        onChange={(event) => setMessageDraft(event.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                        placeholder="Type a message to append to chat thread..."
                        className="flex-1 min-h-[44px] max-h-[100px] resize-none text-xs bg-muted/30 focus-visible:ring-1 focus-visible:ring-primary/40 border-border/60"
                        disabled={!normalizedPhone || sending}
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          type="submit"
                          disabled={!normalizedPhone || sending || !messageDraft.trim()}
                          size="sm"
                          className="h-[44px] px-4 gap-1.5 font-medium"
                        >
                          {sending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Send className="h-4 w-4" />
                              <span>Send</span>
                            </>
                          )}
                        </Button>

                        {/* Schedule Message Popover */}
                        <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={!normalizedPhone || sending || !messageDraft.trim()}
                              className="h-[44px] px-3 gap-1.5 border-border/80 bg-background/80 hover:bg-muted text-xs font-medium"
                              title="Schedule message for later via Chrome Extension"
                            >
                              <Clock className="h-4 w-4 text-amber-400" />
                              <span className="hidden sm:inline">Schedule</span>
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-[300px] p-3 space-y-3 glass-panel-strong border-border/80 shadow-2xl z-[80]">
                            <div className="flex items-center justify-between border-b border-border/40 pb-2">
                              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                <Clock className="h-4 w-4 text-amber-400" />
                                <span>Schedule Message</span>
                              </div>
                              <Badge variant="secondary" className="text-[10px]">Quo Extension</Badge>
                            </div>

                            {/* Quick Presets */}
                            <div className="space-y-1">
                              <p className="text-[11px] font-medium text-muted-foreground">Quick Presets</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs justify-start border-border/60 hover:bg-muted/60"
                                  onClick={() => void handleSchedule("tomorrow at 9am")}
                                >
                                  Tomorrow 9:00 AM
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs justify-start border-border/60 hover:bg-muted/60"
                                  onClick={() => void handleSchedule("tomorrow at 5pm")}
                                >
                                  Tomorrow 5:00 PM
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs justify-start border-border/60 hover:bg-muted/60"
                                  onClick={() => void handleSchedule("in 1 hour")}
                                >
                                  In 1 Hour
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs justify-start border-border/60 hover:bg-muted/60"
                                  onClick={() => void handleSchedule("in 2 hours")}
                                >
                                  In 2 Hours
                                </Button>
                              </div>
                            </div>

                            {/* Custom Time Input */}
                            <div className="space-y-1.5 pt-1 border-t border-border/40">
                              <label className="text-[11px] font-medium text-muted-foreground">Custom Time Description</label>
                              <div className="flex items-center gap-1.5">
                                <Input
                                  value={customScheduleTime}
                                  onChange={(e) => setCustomScheduleTime(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && customScheduleTime.trim()) {
                                      e.preventDefault();
                                      void handleSchedule(customScheduleTime.trim());
                                    }
                                  }}
                                  placeholder="e.g. tomorrow at 5pm"
                                  className="h-8 text-xs bg-muted/30"
                                />
                                <Button
                                  size="sm"
                                  disabled={!customScheduleTime.trim()}
                                  onClick={() => void handleSchedule(customScheduleTime.trim())}
                                  className="h-8 text-xs px-3 bg-amber-600 hover:bg-amber-700 text-white shrink-0 font-medium"
                                >
                                  Schedule
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </form>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>,
          document.body
        )}

      {/* Image Lightbox */}
      <ImageLightbox
        images={lightboxImages}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      />
    </>
  );
}
