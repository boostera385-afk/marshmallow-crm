import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessCxUpdates, canCompleteCxUpdate, canRequestCxUpdate } from "@/lib/access";
import { acknowledgeCxRequest, completeCxRequest, type CxUpdateRequest } from "@/lib/cx-update-requests";
import { CX_QUERY_KEY, useCxQueue } from "@/hooks/useCxUpdates";
import { formatUSPhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function CxUpdatesPage() {
  const { user, role } = useAuth();
  const [params, setParams] = useSearchParams();
  const processor = canRequestCxUpdate(role);
  const status = processor && params.get("tab") === "cs_updated" ? "cs_updated" : "pending";
  const [offset, setOffset] = useState(0);
  const queue = useCxQueue(status, offset);
  const client = useQueryClient();
  const [selected, setSelected] = useState<CxUpdateRequest | null>(null);
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ackId, setAckId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  if (!canAccessCxUpdates(role)) return <p role="alert">You do not have access to CX updates.</p>;
  const refresh = () => { void client.invalidateQueries({ queryKey: CX_QUERY_KEY }); };
  const complete = async () => {
    if (!selected || !response.trim() || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await completeCxRequest(selected.id, response);
      setFinished((previous) => new Set(previous).add(selected.id));
      setSelected(null);
      setResponse("");
      toast.success("CS Updated — returned to Processor/Admin");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save customer update");
    } finally { setSaving(false); inFlight.current = false; }
  };
  const acknowledge = async (request: CxUpdateRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setAckId(request.id);
    try {
      await acknowledgeCxRequest(request.id);
      setFinished((previous) => new Set(previous).add(request.id));
      toast.success("CX update acknowledged");
      refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not acknowledge update"); }
    finally { setAckId(null); inFlight.current = false; }
  };
  const rows = queue.data?.rows.filter((request) => !finished.has(request.id)) ?? [];
  return <section className="space-y-5" aria-label="CX update queue">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><MessageSquarePlus className="h-6 w-6 text-primary" /> Get CX Update</h1>
        <p className="mt-1 text-sm text-muted-foreground">{processor ? "Request customer follow-ups from a saved lead. Review returned CS updates here." : "Customer-only requests from Processor/Admin. Mark CS Updated after recording the customer response."}</p></div>
      <Button variant="outline" onClick={refresh} disabled={queue.isFetching}>Refresh</Button>
    </header>
    {processor && <div className="flex flex-wrap gap-2" aria-label="CX request views">
      {(["pending", "cs_updated"] as const).map((tab) => <Button key={tab} aria-pressed={status === tab} variant={status === tab ? "default" : "outline"}
        onClick={() => { setOffset(0); setParams(tab === "cs_updated" ? { tab } : {}); }}>{tab === "pending" ? "Requested" : "CS Updated"}</Button>)}
    </div>}
    {queue.isError ? <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{queue.error.message} <Button variant="outline" onClick={refresh}>Retry</Button></div>
      : queue.isPending ? <p role="status">Loading CX update requests…</p>
      : !rows.length ? <p role="status" className="rounded-xl border border-border p-6 text-sm text-muted-foreground">{status === "pending" ? "No pending CX update requests." : "No CS Updated responses to review."}</p>
      : <div className="grid gap-4 xl:grid-cols-2">{rows.map((request) => {
        const customer = request.customer;
        return <Card key={request.id} className="min-w-0"><CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">{customer.customer_name}</h2><p className="text-xs text-muted-foreground">{customer.job_id} · {status === "pending" ? "Get CX Update" : "CS Updated"}</p></div>
            <p className="text-xs text-muted-foreground">Requested by {request.requester_name || "Processor/Admin"}</p></div>
          <dl className="space-y-2 break-words text-sm">
            <div><dt className="text-xs text-muted-foreground">Customer phone</dt><dd>{formatUSPhone(customer.customer_phone) || "Not provided"}{customer.customer_landline ? ` · Landline: ${formatUSPhone(customer.customer_landline)}` : ""}</dd></div>
            {customer.customer_email && <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{customer.customer_email}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">Service</dt><dd>{customer.service_type || "Not provided"}</dd><dd className="whitespace-pre-wrap">{customer.service_details}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Address</dt><dd>{[customer.address, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ") || "Not provided"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Agreed schedule</dt><dd className="whitespace-pre-wrap">{customer.customer_schedule_requirements || "Not provided"}</dd>
              {customer.scheduled_date && <dd>{customer.scheduled_date} {[customer.scheduled_time_start, customer.scheduled_time_end].filter(Boolean).join(" – ")}</dd>}</div>
          </dl>
          <div className="rounded-xl bg-primary/5 p-3"><p className="text-xs font-semibold text-primary">Required customer update</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{request.request_text}</p></div>
          <p className="text-xs text-muted-foreground">Assigned to {request.recipient_name ? `${request.recipient_name} + CS Admin` : "CS Admin (no assigned CS agent)"}</p>
          {status === "cs_updated" && <div className="rounded-xl border border-border p-3"><p className="text-xs font-semibold">CS Updated by {request.completed_by_name || "CS"}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{request.response_text}</p></div>}
          <div className="flex flex-wrap gap-2">
            {status === "pending" && canCompleteCxUpdate(role) && <Button onClick={() => { setSelected(request); setResponse(""); setError(""); }}>Mark CS Updated</Button>}
            {processor && <Button variant="outline" asChild><Link to={`/leads/${request.lead_id}`}>Open lead</Link></Button>}
            {status === "cs_updated" && (role === "admin" || request.requested_by === user?.id) && <Button disabled={Boolean(ackId)} onClick={() => { void acknowledge(request); }}>{ackId === request.id ? "Acknowledging…" : "Acknowledge update"}</Button>}
          </div>
        </CardContent></Card>;
      })}</div>}
    {queue.data && queue.data.total > 20 && <nav aria-label="CX queue pages" className="flex items-center justify-center gap-3">
      <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
      <span className="text-sm">Page {Math.floor(offset / 20) + 1}</span>
      <Button variant="outline" disabled={offset + 20 >= queue.data.total} onClick={() => setOffset(offset + 20)}>Next</Button>
    </nav>}
    <Dialog open={Boolean(selected)} onOpenChange={(value) => { if (!value && !inFlight.current) setSelected(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Mark CS Updated</DialogTitle><DialogDescription>Record the customer's response. This closes temporary CS access and returns the request to Processor/Admin without changing the job status or schedule.</DialogDescription></DialogHeader>
        <p className="whitespace-pre-wrap break-words text-sm">{selected?.request_text}</p>
        <Label htmlFor="cx-response">Customer update</Label><Textarea id="cx-response" value={response} disabled={saving} maxLength={4000} onChange={(event) => setResponse(event.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={saving || !response.trim()} onClick={() => { void complete(); }}>{saving ? "Saving…" : "Save CS Updated"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
