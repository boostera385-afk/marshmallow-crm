import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotepad } from "@/contexts/NotepadContext";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  X,
  Minus,
  Maximize2,
  Check,
  Loader2,
  GripHorizontal,
  Plus,
  Trash2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import NotepadUserPickerModal from "./NotepadUserPickerModal";

interface SingleNotepadProps {
  targetUserId: string;
  windowIndex: number;
}

function FloatingNotepadWindow({ targetUserId, windowIndex }: SingleNotepadProps) {
  const { user, role } = useAuth();
  const { closeNotepad, openPicker } = useNotepad();

  const [content, setContent] = useState("");
  const [initialLoadedContent, setInitialLoadedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [targetUserName, setTargetUserName] = useState<string>("User");
  const [targetUserRole, setTargetUserRole] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const isMounted = useRef(true);
  const isAdmin = role === "admin";
  const isSelf = targetUserId === user?.id;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Fetch target user info (if not self)
  useEffect(() => {
    if (isSelf) {
      setTargetUserName("Personal Notepad");
      return;
    }

    const fetchUserInfo = async () => {
      try {
        const [{ data: profile }, { data: userRole }] = await Promise.all([
          supabase
            .from("profiles_public")
            .select("full_name, email")
            .eq("id", targetUserId)
            .maybeSingle() as unknown as PromiseLike<{ data: { full_name: string | null; email: string | null } | null }>,
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", targetUserId)
            .maybeSingle(),
        ]);

        if (profile) {
          const p = profile;
          setTargetUserName(p.full_name || p.email || "User");
        }
        if (userRole) {
          setTargetUserRole(userRole.role);
        }
      } catch (err) {
        console.error("Failed to fetch user info for notepad window", err);
      }
    };

    fetchUserInfo();
  }, [targetUserId, isSelf]);

  // Load content for targetUserId
  useEffect(() => {
    let isCancelled = false;

    const loadNotes = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("user_notepads")
          .select("content")
          .eq("user_id", targetUserId)
          .maybeSingle();

        if (error) {
          console.error("Error loading notepad for user", targetUserId, error);
        }

        if (!isCancelled) {
          const loadedText = data?.content || "";
          setContent(loadedText);
          setInitialLoadedContent(loadedText);
          lastSavedRef.current = loadedText;
          setSavingStatus("idle");
        }
      } catch (err) {
        console.error("Error loading user notepad", err);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    loadNotes();

    return () => {
      isCancelled = true;
    };
  }, [targetUserId]);

  // Save notes function
  const saveNotesImmediate = useCallback(
    async (textToSave: string) => {
      if (!targetUserId) return;
      if (textToSave === lastSavedRef.current) {
        setSavingStatus("idle");
        return;
      }

      setSavingStatus("saving");
      try {
        const { error } = await supabase.from("user_notepads").upsert(
          {
            user_id: targetUserId,
            content: textToSave,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) {
          console.error("Failed to save notepad", error);
          if (isMounted.current) setSavingStatus("idle");
        } else if (isMounted.current) {
          lastSavedRef.current = textToSave;
          setSavingStatus("saved");
          setInitialLoadedContent(textToSave);
          setTimeout(() => {
            if (isMounted.current) setSavingStatus("idle");
          }, 2000);
        }
      } catch (err) {
        console.error("Failed to save notepad exception", err);
        if (isMounted.current) setSavingStatus("idle");
      }
    },
    [targetUserId]
  );

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    setSavingStatus("saving");

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveNotesImmediate(val);
    }, 700);
  };

  // Close and Save
  const handleCloseAndSave = async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (content !== initialLoadedContent) {
      await saveNotesImmediate(content);
      toast.success(isSelf ? "Notepad saved" : `Saved notes for ${targetUserName}`);
    }
    closeNotepad(targetUserId);
  };

  const handleCopyText = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success("Notes copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearText = () => {
    if (!content) return;
    if (window.confirm("Are you sure you want to clear all text in this notepad?")) {
      setContent("");
      saveNotesImmediate("");
    }
  };

  // Calculate staggered positioning based on windowIndex
  const bottomOffset = 24 + windowIndex * 36;
  const rightOffset = 24 + windowIndex * 36;

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.05}
      initial={{ opacity: 0, scale: 0.92, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: 20 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-auto absolute w-[92vw] max-w-[400px] rounded-2xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)] dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col z-50"
      style={{
        bottom: `${bottomOffset}px`,
        right: `${rightOffset}px`,
        height: isMinimized ? "auto" : "400px",
      }}
    >
      {/* Header Bar */}
      <div className="group cursor-grab active:cursor-grabbing flex items-center justify-between border-b border-border/50 bg-muted/40 px-3.5 py-2.5 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold tracking-tight truncate text-foreground">
              {isSelf ? "Personal Notepad" : `Notepad: ${targetUserName}`}
            </span>
            {targetUserRole && !isSelf && (
              <span className="text-[10px] uppercase font-mono px-1 py-0.2 rounded bg-muted text-muted-foreground">
                {targetUserRole.replace("_", " ")}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Status badge */}
          <div className="mr-1 flex items-center text-[11px] text-muted-foreground">
            {savingStatus === "saving" && (
              <span className="flex items-center gap-1 text-amber-500 font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </span>
            )}
            {savingStatus === "saved" && (
              <span className="flex items-center gap-1 text-emerald-500 font-medium">
                <Check className="h-3 w-3" />
                Saved
              </span>
            )}
          </div>

          {/* Admin "+" button to launch another notepad */}
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              onClick={openPicker}
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              title="Open another user's notepad"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}

          {/* Minimize / Restore */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            title={isMinimized ? "Expand Notepad" : "Minimize Notepad"}
          >
            {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </Button>

          {/* Close & Save Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCloseAndSave}
            className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Save and Close Notepad"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      {!isMinimized && (
        <div className="flex-1 flex flex-col min-h-0 bg-background/50 p-3">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs font-medium">Loading notes...</span>
            </div>
          ) : (
            <>
              <Textarea
                value={content}
                onChange={handleContentChange}
                placeholder={
                  isSelf
                    ? "Type your notes, reminders, or scratchpad text here..."
                    : `Taking notes for ${targetUserName}...`
                }
                className="flex-1 resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-1 font-mono leading-relaxed placeholder:font-sans placeholder:text-muted-foreground/60 selection:bg-primary/20"
              />

              {/* Footer */}
              <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>
                    {content.length} char{content.length !== 1 ? "s" : ""}
                  </span>
                  <span>•</span>
                  <span>
                    {content.trim() ? content.trim().split(/\s+/).length : 0} word
                    {content.trim().split(/\s+/).length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyText}
                    disabled={!content}
                    className="h-6 w-6 rounded text-muted-foreground hover:text-foreground"
                    title="Copy all notes"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClearText}
                    disabled={!content}
                    className="h-6 w-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Clear notepad text"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default function FloatingNotepad() {
  const { activeUserIds } = useNotepad();

  return (
    <>
      <NotepadUserPickerModal />
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        <AnimatePresence>
          {activeUserIds.map((userId, idx) => (
            <FloatingNotepadWindow key={userId} targetUserId={userId} windowIndex={idx} />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
