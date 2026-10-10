import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, Send, MessageSquare, User, Phone, CheckCheck, Clock, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  formatEasternTime,
  formatLocalRelativeTime,
  formatUsPhone,
  getQuoChatUrl,
  sendQuoMessageViaExtension,
  scheduleQuoMessageViaExtension,
  normalizeQuoLeadStatus,
  QUO_LEAD_STATUS_CONFIG,
  type QuoLeadStatus,
} from "@/lib/quo-dashboard";
import { extractTranscriptFromPayload, type QuoChatMedia } from "@/lib/quo-chat";
import ImageLightbox from "@/components/leads/ImageLightbox";

interface MessageItem {
  id: string;
  sender: string;
  text: string | null;
  direction?: string | null;
  message_time: string | null;
  created_at?: string;
  media?: QuoChatMedia[];
  status?: string | null;
}

interface QuoChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: {
    id: string;
    customer_name?: string | null;
    customer_number?: string | null;
    number_name?: string | null;
    status?: string | null;
    agent_name?: string | null;
    quo_conversation_id?: string | null;
    quo_phone_number_id?: string | null;
  } | null;
  onStatusChange?: (newStatus: QuoLeadStatus) => void;
}

export default function QuoChatDialog({
  open,
  onOpenChange,
  conversation,
  onStatusChange,
}: QuoChatDialogProps) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customScheduleTime, setCustomScheduleTime] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Fetch messages when conversation changes or opens
  useEffect(() => {
    if (!open || !conversation?.id) return;

    let isCancelled = false;

    const fetchMessages = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("quo_messages")
          .select("id, sender, text, direction, message_time, created_at, media, status, raw_payload")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: true });

        if (error) {
          console.error("Error fetching messages for chat", error);
        } else if (!isCancelled && data) {
          const formatted = data.map((r) => ({
            ...r,
            text: r.text || extractTranscriptFromPayload(r.raw_payload) || ""
          }));
          setMessages(formatted as MessageItem[]);
        }
      } catch (err) {
        console.error("Failed to load messages", err);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchMessages();

    // Subscribe to realtime message updates
    const channel = supabase
      .channel(`chat_${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "quo_messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const newMsg = payload.new as MessageItem;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      isCancelled = true;
      supabase.removeChannel(channel);
    };
  }, [open, conversation?.id]);

  // Auto-scroll to bottom of message thread when messages load/update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() || !conversation?.id || sending) return;

    const textToSend = newMessage.trim();
    setNewMessage("");
    setSending(true);

    const nowIso = new Date().toISOString();
    const tempId = `temp_${Date.now()}`;

    // Optimistically append message to local state
    const optimisticMsg: MessageItem = {
      id: tempId,
      sender: "agent",
      direction: "outbound",
      text: textToSend,
      message_time: nowIso,
      created_at: nowIso,
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    const chatUrl = getQuoChatUrl(
      conversation.quo_conversation_id,
      conversation.customer_number,
      conversation.quo_phone_number_id
    );

    // Save message to Supabase database
    try {
      const { error } = await supabase.from("quo_messages").insert({
        conversation_id: conversation.id,
        sender: "agent",
        direction: "outbound",
        text: textToSend,
        message_time: nowIso,
        quo_message_id: `msg_web_${Date.now()}`,
      });

      if (!error) {
        await supabase
          .from("quo_conversations")
          .update({
            last_message_preview: textToSend,
            last_message_at: nowIso,
            last_message_time: nowIso,
            last_agent_message_at: nowIso,
          })
          .eq("id", conversation.id);
      }
    } catch (dbErr) {
      console.warn("DB save warning:", dbErr);
    }

    // Trigger Chrome Extension message and wait for QUO_SEND_MESSAGE_RESPONSE callback
    const toastId = toast.loading("Sending via QUO Extension...");

    try {
      const extRes = await sendQuoMessageViaExtension(chatUrl, textToSend);

      if (extRes.success) {
        toast.success("Success! The message was pasted and sent via QUO.", { id: toastId });
      } else {
        toast.error(`Extension notice: ${extRes.error || "Failed to complete send"}`, { id: toastId });
      }
    } catch (err) {
      toast.error(`Extension notice: ${(err as { message?: string } | null)?.message || "Extension dispatch error"}`, { id: toastId });
    } finally {
      setSending(false);
    }
  };

  const handleScheduleMessage = async (scheduleTime: string) => {
    if (!newMessage.trim() || !conversation?.id || sending) return;

    const textToSend = newMessage.trim();
    setNewMessage("");
    setCustomScheduleTime("");
    setScheduleOpen(false);
    setSending(true);

    const chatUrl = getQuoChatUrl(
      conversation.quo_conversation_id,
      conversation.customer_number,
      conversation.quo_phone_number_id
    );

    const toastId = toast.loading(`Scheduling message for "${scheduleTime}" via Extension...`);

    try {
      const extRes = await scheduleQuoMessageViaExtension(chatUrl, textToSend, scheduleTime);

      if (extRes.success) {
        toast.success(`Success! Message scheduled for "${scheduleTime}".`, { id: toastId });
      } else {
        toast.error(`Failed to schedule: ${extRes.error || "Cancelled"}`, { id: toastId });
      }
    } catch (err) {
      toast.error(`Failed to schedule: ${(err as { message?: string } | null)?.message || "Extension error"}`, { id: toastId });
    } finally {
      setSending(false);
    }
  };

  if (!conversation) return null;

  const currentStatusKey = normalizeQuoLeadStatus(conversation.status);
  const statusCfg = QUO_LEAD_STATUS_CONFIG[currentStatusKey];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] h-[85vh] max-h-[680px] p-0 flex flex-col overflow-hidden glass-panel-strong border-border/80 shadow-2xl">
        {/* Chat Header */}
        <DialogHeader className="p-4 border-b border-border/50 bg-muted/30 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold text-sm">
                <MessageSquare className="h-5 w-5" />
              </span>
              <div>
                <DialogTitle className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
                  <span>{formatUsPhone(conversation.customer_number)}</span>
                  {conversation.customer_name && (
                    <span className="text-xs font-normal text-muted-foreground">
                      ({conversation.customer_name})
                    </span>
                  )}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-1">
                  {conversation.number_name && (
                    <span className="text-xs font-medium text-muted-foreground">
                      {conversation.number_name}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[11px] font-semibold ${statusCfg.badgeClass}`}
                  >
                    {statusCfg.label}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Messages Body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-background/40"
        >
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground gap-2 text-xs">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading chat messages...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1 text-xs">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-1" />
              <span>No messages in this chat yet.</span>
            </div>
          ) : (
            messages.map((msg) => {
              const isOutbound =
                msg.sender === "agent" ||
                msg.direction === "outbound" ||
                msg.sender === "us";

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    isOutbound ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed ${
                      isOutbound
                        ? "bg-primary text-primary-foreground rounded-br-xs"
                        : "bg-muted/90 text-foreground border border-border/50 rounded-bl-xs"
                    }`}
                  >
                    {msg.media && msg.media.length > 0 && (
                      <div className="flex flex-col gap-2 mb-2">
                        {msg.media.map((mediaItem, idx) => {
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
                                  // collect all images in conversation
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
                    {msg.text && (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    )}
                    {!msg.text && (!msg.media || msg.media.length === 0) && (
                      <p className="whitespace-pre-wrap break-words italic opacity-70">
                        {msg.status ? `[ ${msg.status.replace(/\./g, ' ')} ]` : "—"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-muted-foreground">
                    <span>
                      {formatLocalRelativeTime(
                        msg.message_time || msg.created_at,
                        true
                      )}
                    </span>
                    {isOutbound && <CheckCheck className="h-3 w-3 text-primary/70" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Chat Input Footer */}
        <form
          onSubmit={handleSendMessage}
          className="p-3 border-t border-border/50 bg-background/80 flex items-end gap-2 shrink-0"
        >
          <Textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Type a message to append to chat thread..."
            className="flex-1 min-h-[44px] max-h-[100px] resize-none text-xs bg-muted/30 focus-visible:ring-1 focus-visible:ring-primary/40 border-border/60"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="submit"
              disabled={!newMessage.trim() || sending}
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
                  disabled={!newMessage.trim() || sending}
                  className="h-[44px] px-3 gap-1.5 border-border/80 bg-background/80 hover:bg-muted text-xs font-medium"
                  title="Schedule message for later via Chrome Extension"
                >
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span className="hidden sm:inline">Schedule</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[300px] p-3 space-y-3 glass-panel-strong border-border/80 shadow-2xl">
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
                      onClick={() => handleScheduleMessage("tomorrow at 9am")}
                    >
                      Tomorrow 9:00 AM
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs justify-start border-border/60 hover:bg-muted/60"
                      onClick={() => handleScheduleMessage("tomorrow at 5pm")}
                    >
                      Tomorrow 5:00 PM
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs justify-start border-border/60 hover:bg-muted/60"
                      onClick={() => handleScheduleMessage("in 1 hour")}
                    >
                      In 1 Hour
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs justify-start border-border/60 hover:bg-muted/60"
                      onClick={() => handleScheduleMessage("in 2 hours")}
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
                          handleScheduleMessage(customScheduleTime.trim());
                        }
                      }}
                      placeholder="e.g. tomorrow at 5pm"
                      className="h-8 text-xs bg-muted/30"
                    />
                    <Button
                      size="sm"
                      disabled={!customScheduleTime.trim()}
                      onClick={() => handleScheduleMessage(customScheduleTime.trim())}
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
        {/* Image Lightbox */}
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      </DialogContent>
    </Dialog>
  );
}
