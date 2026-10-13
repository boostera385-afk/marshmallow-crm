import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canRequestCxUpdate } from "@/lib/access";
import { createCxRequest } from "@/lib/cx-update-requests";
import { CX_QUERY_KEY } from "@/hooks/useCxUpdates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function CxUpdateRequestButton({ leadId, customerName }: { leadId: string; customerName: string }) {
  const { role } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitted = useRef<{ id: string; text: string } | null>(null);
  const inFlight = useRef(false);
  if (!canRequestCxUpdate(role)) return null;
  const submit = async () => {
    if (inFlight.current || !text.trim()) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    submitted.current ??= { id: crypto.randomUUID(), text: text.trim() };
    try {
      await createCxRequest(leadId, submitted.current.id, submitted.current.text);
      toast.success("CX update requested");
      setOpen(false);
      setText("");
      submitted.current = null;
      // A refresh failure must not redefine an acknowledged save as failed.
      void client.invalidateQueries({ queryKey: CX_QUERY_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request CX update");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return <>
    <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      <MessageSquarePlus className="h-4 w-4" /> Get CX Update
    </Button>
    <Dialog open={open} onOpenChange={(value) => { if (!inFlight.current) setOpen(value); }}>
      <DialogContent onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Get CX Update</DialogTitle>
          <DialogDescription>What do you need to confirm with {customerName}? Assigned CS and CS Admin will see customer-only details, even when the job is hidden.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`cx-request-${leadId}`}>Required customer update</Label>
          <Textarea id={`cx-request-${leadId}`} value={text} maxLength={2000} disabled={saving || Boolean(submitted.current)}
            onChange={(event) => setText(event.target.value)} placeholder="For example: confirm whether the customer is available on Friday afternoon." />
          <p className="text-xs text-muted-foreground">Do not include technician details. Job status and agreed schedule will not change.</p>
          {error && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{error}</p><p className="text-xs">Retry sends the same request safely. Close and reopen to keep working elsewhere.</p></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Close</Button>
          <Button disabled={saving || !text.trim()} onClick={() => { void submit(); }}>{saving ? "Sending…" : submitted.current ? "Retry request" : "Send request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
