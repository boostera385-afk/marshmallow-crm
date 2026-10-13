import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isOperatorRole } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buildTechEntry, countTechs, formatTechCount, nextTechNumber } from "@/lib/lead-techs";
import { formatUSPhone } from "@/lib/phone";
import { realtimeBus } from "@/lib/realtime";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface LeadNote {
  id: string;
  lead_id: string;
  user_id: string | null;
  user_name?: string | null;
  note_type: string;
  content: string;
  created_at: string;
}

interface Props {
  leadId: string;
  noteType: "cs" | "processor" | "general" | "opr";
  label: string;
  profiles?: Record<string, string>;
  onNotesChanged?: () => void;
}

export default function NoteThread({ leadId, noteType, label, profiles = {}, onNotesChanged }: Props) {
  const { user, role, profile } = useAuth();
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [resolvedProfiles, setResolvedProfiles] = useState<Record<string, string>>({});
  
  const draftKey = `draft-note-${leadId}-${noteType}`;
  const [newNote, setNewNote] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(draftKey) || "";
    }
    return "";
  });

  useEffect(() => {
    if (newNote) {
      sessionStorage.setItem(draftKey, newNote);
    } else {
      sessionStorage.removeItem(draftKey);
    }
  }, [newNote, draftKey]);

  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isAdmin = role === "admin";
  const isCS = role === "customer_service";
  const isCsAdmin = role === "cs_admin";
  const isProcessor = role === "processor";
  const isOpr = isOperatorRole(role);

  const canViewThread = useMemo(() => {
    if (isAdmin) return true;
    if (noteType === "general") return true;
    if (noteType === "cs") return isCS || isCsAdmin || isProcessor || isOpr;
    if (noteType === "opr") return isProcessor || isOpr;
    return isProcessor;
  }, [isAdmin, isCS, isCsAdmin, isProcessor, isOpr, noteType]);

  const canWriteThread = useMemo(() => {
    if (isAdmin) return true;
    if (noteType === "general") return true;
    if (noteType === "cs") return isCS || isCsAdmin;
    if (noteType === "opr") return isProcessor || isOpr;
    return isProcessor;
  }, [isAdmin, isCS, isCsAdmin, isProcessor, isOpr, noteType]);

  const fetchNotes = useCallback(async () => {
    if (!canViewThread) {
      setNotes([]);
      return;
    }

    const { data } = await supabase
      .from("lead_notes")
      .select("*")
      .eq("lead_id", leadId)
      .eq("note_type", noteType)
      .order("created_at", { ascending: true });
    if (data) {
      const next = data as LeadNote[];
      // Avoid re-rendering (and losing textarea focus/cursor) when nothing changed
      setNotes((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    }

  }, [canViewThread, leadId, noteType]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  // Fallback Polling every 15 seconds
  useEffect(() => {
    if (!canViewThread) return;
    
    const intervalId = setInterval(() => {
      void fetchNotes();
    }, 15000);

    return () => clearInterval(intervalId);
  }, [fetchNotes, canViewThread]);

  // Realtime subscription for notes
  useEffect(() => {
    if (!canViewThread) return;

    const handleNotes = (e: Event) => {
      const payload = (e as CustomEvent<{ new: { note_type?: string; lead_id?: string }; old: { note_type?: string; lead_id?: string } }>).detail;
      const newRow = payload.new as { note_type?: string; lead_id?: string };
      const oldRow = payload.old as { note_type?: string; lead_id?: string };

      const isForThisLead = newRow?.lead_id === leadId || oldRow?.lead_id === leadId;
      const isForThisType = newRow?.note_type === noteType || oldRow?.note_type === noteType;

      if (isForThisLead && isForThisType) {
        void fetchNotes();
      }
    };

    realtimeBus.addEventListener("lead_notes", handleNotes);

    return () => {
      realtimeBus.removeEventListener("lead_notes", handleNotes);
    };
  }, [leadId, noteType, fetchNotes, canViewThread]);

  const profilesKey = JSON.stringify(profiles);

  useEffect(() => {
    const missingUserIds = Array.from(new Set(notes.map((note) => note.user_id).filter(Boolean) as string[])).filter((userId) => !profiles[userId]);

    if (missingUserIds.length === 0) {
      setResolvedProfiles((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    let cancelled = false;

    const fetchProfileNames = async () => {
      const { data } = await supabase.from("profiles_public" as never).select("id, full_name").in("id", missingUserIds) as { data: { id: string; full_name: string | null }[] | null };

      if (!cancelled && data) {
        const nextProfiles = Object.fromEntries(
          data.map((profile: { id: string; full_name: string | null }) => [profile.id, profile.full_name || "Unknown"]),
        );
        setResolvedProfiles((prev) =>
          JSON.stringify(prev) === JSON.stringify(nextProfiles) ? prev : nextProfiles,
        );
      }
    };

    void fetchProfileNames();

    return () => {
      cancelled = true;
    };
  }, [notes, profilesKey]);

  // Auto-scroll only when a new note arrives, and never while the user is typing
  const lastNoteCount = useRef(0);
  useEffect(() => {
    const grew = notes.length > lastNoteCount.current;
    lastNoteCount.current = notes.length;
    if (!grew || !scrollRef.current) return;
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [notes]);


  // Techs live in the processor thread as "Tech N" entries, written through the form that is
  // always open at the bottom of the thread.
  const isTechThread = noteType === "processor";
  const [addingTech, setAddingTech] = useState(false);
  const [techName, setTechName] = useState("");
  const [techPhone, setTechPhone] = useState("");
  const [techNote, setTechNote] = useState("");

  const techCount = useMemo(
    () => (isTechThread ? countTechs(notes.map((n) => n.content)) : 0),
    [isTechThread, notes],
  );

  // Numbering continues past the highest already used. The processor thread has no free-text
  // composer any more, so only saved notes count.
  const nextTech = useMemo(() => nextTechNumber(notes.map((n) => n.content)), [notes]);

  const resetTechForm = () => {
    setTechName("");
    setTechPhone("");
    setTechNote("");
  };

  // Sent to the thread as an ordinary note, the same as typing one.
  const submitTech = async () => {
    if (!user || !techName.trim() || addingTech) return;
    setAddingTech(true);

    const entry = buildTechEntry(nextTech, {
      name: techName,
      phone: techPhone,
      note: techNote,
    });

    const { error } = await supabase.from("lead_notes").insert({
      lead_id: leadId,
      user_id: user.id,
      user_name: profile?.full_name || user.email || "Unknown user",
      note_type: noteType,
      content: entry,
    });

    setAddingTech(false);

    if (error) {
      toast.error("Failed to add tech: " + error.message);
      return;
    }

    resetTechForm();
    await fetchNotes();
    onNotesChanged?.();
  };

  const handleTechKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submitTech();
    } else if (e.key === "Escape") {
      e.preventDefault();
      resetTechForm();
    }
  };

  const handleSend = async () => {
    if (!canWriteThread || !newNote.trim() || !user) return;
    setSending(true);
    const { error } = await supabase.from("lead_notes").insert({
      lead_id: leadId,
      user_id: user.id,
      user_name: profile?.full_name || user.email || "Unknown user",
      note_type: noteType,
      content: newNote.trim(),
    });
    if (error) {
      toast.error("Failed to add note: " + error.message);
    } else {
      setNewNote("");
      await fetchNotes();
      onNotesChanged?.();
    }
    setSending(false);
  };

  const handleEdit = (note: LeadNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim() || !editingId) return;
    const { error } = await supabase
      .from("lead_notes")
      .update({ content: editContent.trim() })
      .eq("id", editingId);
    if (error) {
      toast.error("Failed to update note");
    } else {
      setEditingId(null);
      setEditContent("");
      await fetchNotes();
      onNotesChanged?.();
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canEdit = (note: LeadNote) => {
    if (!canWriteThread) return false;
    if (isAdmin) return true;
    return note.user_id === user?.id;
  };

  const getInitials = (note: LeadNote) => {
    const name = (note.user_id ? profiles[note.user_id] || resolvedProfiles[note.user_id] : null) || note.user_name || "?";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const getName = (note: LeadNote) => (note.user_id ? profiles[note.user_id] || resolvedProfiles[note.user_id] : null) || note.user_name || "Unknown";

  if (!canViewThread) return null;

  return (
    <div className="crm-lead-card-soft overflow-hidden rounded-[20px]">
      <div className="border-b border-border/40 bg-[hsl(var(--background)/0.64)] px-4 py-2.5 dark:bg-[hsl(var(--background)/0.18)]">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">{label}</h4>
      </div>

      <div ref={scrollRef} className="max-h-60 space-y-3 overflow-y-auto p-3">
        {notes.length === 0 && (
          <p className="text-[12px] text-muted-foreground/40 text-center py-6">No notes yet. Start the conversation.</p>
        )}
        <AnimatePresence initial={false}>
          {notes.map((note) => {
            const isMe = note.user_id === user?.id;
            const isEditing = editingId === note.id;
            return (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16 }}
                className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}
              >
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback className={`text-[8px] font-bold ${isMe ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {getInitials(note)}
                  </AvatarFallback>
                </Avatar>
                <div className={`max-w-[75%] space-y-0.5 ${isMe ? "items-end text-right" : ""}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-foreground">
                      {getName(note)}
                    </span>
                    <span className="text-[9px] text-muted-foreground/40">
                      {new Date(note.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {canEdit(note) && !isEditing && (
                      <button
                        onClick={() => handleEdit(note)}
                        className="opacity-0 group-hover/note:opacity-100 hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-muted transition-all"
                        title="Edit note"
                      >
                        <Pencil className="h-2.5 w-2.5 text-muted-foreground/60" />
                      </button>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="space-y-1.5">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[60px] text-[13px] resize-none"
                        autoFocus
                      />
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit} aria-label="Cancel editing note">
                          <X className="h-3 w-3" />
                        </Button>
                        <Button size="icon" className="h-6 w-6" onClick={handleSaveEdit} aria-label="Save note">
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`group/note relative rounded-[16px] px-3 py-2 text-[13px] leading-relaxed ${
                        isMe
                          ? "border border-primary/15 bg-[linear-gradient(180deg,hsl(var(--primary)),hsl(223_85%_60%))] text-primary-foreground rounded-tr-sm shadow-[0_12px_22px_-18px_hsl(var(--primary)/0.55)]"
                          : "crm-lead-card-inner rounded-tl-sm text-foreground shadow-[0_14px_22px_-20px_rgba(59,130,246,0.12)] dark:shadow-none"
                      }`}
                    >
                      {note.content}
                      {canEdit(note) && (
                        <button
                          onClick={() => handleEdit(note)}
                          className="absolute top-1 right-1 opacity-0 group-hover/note:opacity-100 p-1 rounded-md hover:bg-black/10 transition-all"
                          title="Edit"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {canWriteThread ? (
        <div className="border-t border-border/35 bg-[hsl(var(--background)/0.54)] p-2 dark:bg-[hsl(var(--background)/0.12)]">
          {isTechThread ? (
            /* Processor notes are written as techs: the form is always open and is the only
               composer in this thread. Fill the fields and send with the tick. */
            <div className="space-y-1.5 rounded-xl border border-sky-300/60 bg-sky-500/[0.07] p-2 dark:border-sky-400/30">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                  Tech {nextTech}
                </span>
                {techCount > 0 && (
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {formatTechCount(techCount)} in this thread
                  </span>
                )}
              </div>

              <div className="flex gap-1.5">
                <Input
                  value={techName}
                  onChange={(e) => setTechName(e.target.value)}
                  onKeyDown={handleTechKeyDown}
                  placeholder="Name"
                  className="h-8 flex-1 rounded-lg text-[12px]"
                />
                <Input
                  value={techPhone}
                  // Formatted as it is typed, so it always reads (000) 000-0000.
                  onChange={(e) => setTechPhone(formatUSPhone(e.target.value))}
                  onKeyDown={handleTechKeyDown}
                  placeholder="(000) 000-0000"
                  inputMode="tel"
                  className="h-8 flex-1 rounded-lg text-[12px]"
                />
              </div>

              <div className="flex gap-1.5">
                <Input
                  value={techNote}
                  onChange={(e) => setTechNote(e.target.value)}
                  onKeyDown={handleTechKeyDown}
                  placeholder="Note (optional)"
                  className="h-8 flex-1 rounded-lg text-[12px]"
                />
                <Button
                  size="icon"
                  onClick={submitTech}
                  disabled={addingTech || !techName.trim()}
                  aria-label="Add tech to notes"
                  className="h-8 w-8 shrink-0 rounded-lg"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Add a note...`}
                className="crm-lead-card-inner min-h-[36px] max-h-20 resize-none border-0 bg-transparent text-sm focus-visible:ring-0 shadow-none"
                rows={1}
              />
              <Button
                size="icon"
                aria-label="Send note"
                className="h-9 w-9 shrink-0 rounded-[14px] shadow-[0_12px_22px_-16px_hsl(var(--primary)/0.45)]"
                onClick={handleSend}
                disabled={sending || !newNote.trim()}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-border/35 bg-[hsl(var(--background)/0.5)] px-4 py-2.5 text-[11px] text-muted-foreground dark:bg-[hsl(var(--background)/0.1)]">
          This note thread is view-only for your role.
        </div>
      )}

    </div>
  );
}
