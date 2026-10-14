import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canRequestCxUpdate, canRequestTechUpdate } from "@/lib/access";
import { createUpdateRequest, type UpdateRequestKind } from "@/lib/cx-update-requests";
import { UPDATE_QUERY_KEY } from "@/hooks/useCxUpdates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props { kind: UpdateRequestKind; leadId: string; customerName: string; className?: string }

export default function UpdateRequestButton({ kind, leadId, customerName, className }: Props) {
  const { role } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitted = useRef<{ id: string; text: string } | null>(null);
  const inFlight = useRef(false);
  const allowed = kind === "cx" ? canRequestCxUpdate(role) : canRequestTechUpdate(role);
  if (!allowed) return null;

  const title = kind === "cx" ? "Get CX Update" : "Get Tech Update";
  const submit = async () => {
    if (inFlight.current || !requestText.trim()) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    submitted.current ??= { id: crypto.randomUUID(), text: requestText.trim() };
    try {
      await createUpdateRequest(kind, leadId, submitted.current.id, submitted.current.text);
      toast.success(`${kind === "cx" ? "CX" : "Tech"} update requested`);
      setOpen(false);
      setRequestText("");
      submitted.current = null;
      void client.invalidateQueries({ queryKey: UPDATE_QUERY_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not request ${kind === "cx" ? "CX" : "Tech"} update`);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return <>
    <Button variant="outline" size="sm" className={cn("h-10 gap-1.5 rounded-xl px-3", className)} onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      {kind === "cx" ? <MessageSquarePlus className="h-4 w-4 shrink-0" /> : <Wrench className="h-4 w-4 shrink-0" />}
      <span className="truncate">{title}</span>
    </Button>
    <Dialog open={open} onOpenChange={(value) => { if (!inFlight.current) setOpen(value); }}>
      <DialogContent onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {kind === "cx"
              ? `What do you need to confirm with ${customerName}? Assigned CS and CS Admin will see customer-only details, even when the job is hidden.`
              : `What technician or job update do you need for ${customerName}? Processor will reply in the Tech Update queue.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`${kind}-request-${leadId}`}>{kind === "cx" ? "Required customer update" : "Required technician update"}</Label>
          <Textarea id={`${kind}-request-${leadId}`} value={requestText} maxLength={2000} disabled={saving || Boolean(submitted.current)}
            onChange={(event) => setRequestText(event.target.value)}
            placeholder={kind === "cx" ? "For example: confirm whether the customer is available Friday afternoon." : "For example: confirm whether the technician collected the replacement part."} />
          <p className="text-xs text-muted-foreground">This request does not change the job status, schedule, technician, or approvals.</p>
          {error && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{error}</p><p className="text-xs">Retry sends the same request safely.</p></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Close</Button>
          <Button disabled={saving || !requestText.trim()} onClick={() => { void submit(); }}>{saving ? "Sending…" : submitted.current ? "Retry request" : "Send request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
