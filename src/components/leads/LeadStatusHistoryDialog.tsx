import { useState, useEffect } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import StatusBadge from "./StatusBadge";
import { LeadStatus } from "@/lib/constants";
import { Loader2 } from "lucide-react";

interface StatusHistoryLog {
  id: string;
  user_name: string;
  action: string;
  created_at: string;
  details: {
    status_from?: string;
    status_to?: string;
    status?: string;
  } | null;
}

interface Props {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: string;
}

export default function LeadStatusHistoryDialog({ leadId, open, onOpenChange, currentStatus }: Props) {
  const [history, setHistory] = useState<StatusHistoryLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && leadId) {
      void fetchHistory();
    }
  }, [open, leadId]);

  // Fallback Polling every 15 seconds
  useEffect(() => {
    if (!open || !leadId) return;
    
    const intervalId = setInterval(() => {
      void fetchHistory(true);
    }, 15000);

    return () => clearInterval(intervalId);
  }, [open, leadId]);

  const fetchHistory = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    
    const [logsRes, leadRes] = await Promise.all([
      supabase
        .from("activity_logs")
        .select("id, user_name, action, created_at, details")
        .eq("target_type", "lead")
        .eq("target_id", leadId)
        .in("action", ["created", "status_changed", "status_change"])
        .order("created_at", { ascending: true }),
      supabase
        .from("leads")
        .select("created_at, created_by_name, status")
        .eq("id", leadId)
        .single()
    ]);

    if (!logsRes.error && logsRes.data) {
      const fetchedLogs = logsRes.data as unknown as StatusHistoryLog[];
      
      const hasCreationLog = fetchedLogs.some(log => log.action === "created");
      
      if (!hasCreationLog && leadRes.data) {
        const syntheticLog: StatusHistoryLog = {
          id: `synthetic-created-${leadId}`,
          user_name: leadRes.data.created_by_name || "Unknown user",
          action: "created",
          created_at: leadRes.data.created_at,
          details: {
            status_to: fetchedLogs.length > 0 && fetchedLogs[0].details?.status_from
              ? fetchedLogs[0].details.status_from 
              : leadRes.data.status
          }
        };
        fetchedLogs.unshift(syntheticLog);
      }
      
      setHistory(fetchedLogs);
    }
    
    if (!isBackground) setLoading(false);
  };

  useEffect(() => {
    if (!open || !leadId) return;

    const channel = supabase
      .channel(`status-history-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_logs",
          filter: `target_id=eq.${leadId}`,
        },
        (payload) => {
          const newLog = payload.new as { action: string };
          if (["created", "status_changed", "status_change"].includes(newLog.action)) {
            // Re-fetch to guarantee correct ordering and display format
            void fetchHistory();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, leadId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Status History</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4 mt-4">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No status history available.
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:-bottom-2 before:w-[2px] before:bg-border/60">
              {history.map((log, i) => {
                const isCreation = log.action === "created";
                const date = new Date(log.created_at);
                
                let parsedDetails: StatusHistoryLog["details"] = null;
                if (typeof log.details === "string") {
                  try {
                    parsedDetails = JSON.parse(log.details);
                  } catch (e) { /* Keep missing details when legacy JSON is malformed. */ }
                } else {
                  parsedDetails = log.details;
                }

                const hasValidStatus = !isCreation && parsedDetails?.status_to;
                const userName = log.user_name || "Unknown user";

                return (
                  <div key={log.id} className="relative flex flex-col gap-1 text-sm">
                    {/* Timeline Dot */}
                    <div className="absolute -left-6 top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary ring-1 ring-border shadow-sm" />

                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {format(date, "MMM d, yyyy 'at' h:mm a")}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-x-2 mt-1">
                      <span className="font-medium text-foreground">
                        {userName}
                      </span>
                      <span className="text-muted-foreground">
                        {isCreation ? "created the lead" : "changed status to"}
                      </span>
                    </div>

                    {hasValidStatus && (
                      <div className="mt-1.5">
                        <StatusBadge status={parsedDetails.status_to as LeadStatus} size="sm" />
                      </div>
                    )}
                    {isCreation && i === 0 && (() => {
                      let initialStatus = parsedDetails?.status_to || parsedDetails?.status;
                      
                      // Infer from the very next status change log since we filtered for only these actions
                      if (!initialStatus && history[i + 1]) {
                        const nextLog = history[i + 1];
                        let nextDetails: StatusHistoryLog["details"] = null;
                        if (typeof nextLog.details === "string") {
                          try { nextDetails = JSON.parse(nextLog.details); } catch(e) { /* Keep missing details when legacy JSON is malformed. */ }
                        } else {
                          nextDetails = nextLog.details;
                        }
                        initialStatus = nextDetails?.status_from || nextDetails?.status_to;
                      }

                      if (!initialStatus && history.length === 1) {
                        initialStatus = currentStatus;
                      }

                      if (!initialStatus) return null;

                      return (
                        <div className="mt-1.5 opacity-80">
                          <StatusBadge status={initialStatus as LeadStatus} size="sm" />
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
