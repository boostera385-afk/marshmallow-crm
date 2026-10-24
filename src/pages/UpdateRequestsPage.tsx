import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessCxUpdates, canCompleteCxUpdate, canCompleteTechUpdate, canRequestCxUpdate, canRequestTechUpdate, canResolveUpdateRequest } from "@/lib/access";
import { acknowledgeUpdateRequest, completeUpdateRequest, questionMoreUpdateRequest, updateRequestVersion, reassignUpdateRequest, fetchResolutionOwners, type CxUpdateRequest, type UpdateRequestKind, type UpdateRequestView } from "@/lib/cx-update-requests";
import { UPDATE_QUERY_KEY, useUpdateQueue } from "@/hooks/useCxUpdates";
import { formatUSPhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props { kind: UpdateRequestKind }

export default function UpdateRequestsPage({ kind }: Props) {
  const { user, role } = useAuth();
  const [params, setParams] = useSearchParams();
  const requester = kind === "cx" ? canRequestCxUpdate(role) : canRequestTechUpdate(role);
  const completer = kind === "cx" ? canCompleteCxUpdate(role) : canCompleteTechUpdate(role);
  const tab = params.get("tab");
  const view: UpdateRequestView = tab === "updated" || tab === "resolved" || tab === "action" || tab === "pending" ? tab : requester ? "action" : "pending";
  const requestId = params.get("request");
  const scope = `${user?.id}:${role}:${kind}:${view}:${requestId}`;
  const [offset, setOffset] = useState(0);
  const queue = useUpdateQueue(kind, view, offset, requestId);
  const client = useQueryClient();
  const [selection, setSelection] = useState<{ request: CxUpdateRequest; scope: string } | null>(null);
  const selected = selection?.scope === scope ? selection.request : null;
  const [dialogMode, setDialogMode] = useState<"complete" | "question_more" | "reassign">("complete");
  const [ownerId, setOwnerId] = useState("");
  const owners = useQuery({ queryKey: [...UPDATE_QUERY_KEY, "owners", user?.id, role, kind],
    queryFn: () => fetchResolutionOwners(kind), enabled: role === "admin" && Boolean(selected) && dialogMode === "reassign" });
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ackId, setAckId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const subject = kind === "cx" ? "CX" : "Tech";
  const responseLabel = kind === "cx" ? "Customer update" : "Tech update";
  const updatedLabel = kind === "cx" ? "CS Updated" : "Tech Updated";
  const title = kind === "cx" ? "Get CX Update" : "Get Tech Update";
  const Icon = kind === "cx" ? MessageSquarePlus : Wrench;

  if (!canAccessCxUpdates(role)) return <p role="alert">You do not have access to update requests.</p>;
  const refresh = () => { void client.invalidateQueries({ queryKey: UPDATE_QUERY_KEY }); };
  const closeDialog = () => { setSelection(null); setResponse(""); setError(""); };
  const saveDialog = async () => {
    if (!selected || !response.trim() || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      if (dialogMode === "complete") {
        await completeUpdateRequest(kind, selected.id, response, selected.revision);
        toast.success(`${updatedLabel} — pending resolution by ${selected.owner_name || selected.requester_name || "the requester"}`);
      } else if (dialogMode === "question_more") {
        await questionMoreUpdateRequest(kind, selected.id, response, selected.revision);
        toast.success("Follow-up question sent");
      } else {
        await reassignUpdateRequest(kind, selected.id, ownerId, response, selected.revision);
        toast.success("Resolution owner reassigned; original requester retained");
      }
      setFinished((previous) => new Set(previous).add(`${scope}:${updateRequestVersion(selected)}`));
      closeDialog();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save update");
    } finally { setSaving(false); inFlight.current = false; }
  };
  const acknowledge = async (request: CxUpdateRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setAckId(request.id);
    try {
      await acknowledgeUpdateRequest(kind, request.id, request.revision);
      setFinished((previous) => new Set(previous).add(`${scope}:${updateRequestVersion(request)}`));
      toast.success(`${subject} update resolved`);
      refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not resolve update"); }
    finally { setAckId(null); inFlight.current = false; }
  };
  const rows = queue.data?.rows.filter((request) => !finished.has(`${scope}:${updateRequestVersion(request)}`)) ?? [];
  const mayResolve = (request: CxUpdateRequest) => canResolveUpdateRequest(role, user?.id, request.resolution_owner);

  return <section className="space-y-5" aria-label={`${subject} update queue`}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Icon className="h-6 w-6 text-primary" /> {title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {kind === "cx"
            ? requester ? "Request customer follow-ups from a saved lead and review returned CS updates." : "Customer-only requests from Processor/Admin. Record the customer response here."
            : requester ? "Request technician/job details from a saved lead and review Processor replies." : role === "processor" ? "Reply to technician update questions from CS and CS Admin." : "Monitor pending technician update questions for Processor."}
        </p></div>
      <Button variant="outline" onClick={refresh} disabled={queue.isFetching}>Refresh</Button>
    </header>
    <div className="flex flex-wrap gap-2" aria-label={`${subject} request views`}>
      {(["action", "pending", "updated", "resolved"] as const).map((tab) => <Button key={tab} aria-pressed={!requestId && view === tab} variant={!requestId && view === tab ? "default" : "outline"}
        onClick={() => { setOffset(0); setFinished(new Set()); setParams({ tab }); }}>
        {{ action: "Needs my action", pending: "Waiting for response", updated: "Awaiting resolution", resolved: "Resolved" }[tab]}
        {!requestId && view === tab && queue.data ? ` (${queue.data.total})` : ""}</Button>)}
    </div>
    <p className="text-xs text-muted-foreground">Reading a notification does not resolve a request. Only its resolution owner can close it.</p>
    {queue.isError ? <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{queue.error.message} <Button variant="outline" onClick={refresh}>Retry</Button></div>
      : queue.isPending ? <p role="status">Loading {subject.toLowerCase()} update requests…</p>
      : !rows.length ? <p role="status" className="rounded-xl border border-border p-6 text-sm text-muted-foreground">{requestId ? "This request is unavailable or outside your current access. Select a queue above to continue." : view === "pending" ? `No pending ${subject} update requests.` : view === "resolved" ? "No resolved requests in your authorized history." : view === "action" ? "No requests need your action." : `No ${updatedLabel} responses to review.`}</p>
      : <div className="grid gap-4 xl:grid-cols-2">{rows.map((request) => {
        const customer = request.customer;
        const thread = request.thread?.length ? request.thread : [
          { type: "question" as const, text: request.request_text, at: request.created_at, by_name: request.requester_name },
          ...(request.response_text ? [{ type: "response" as const, text: request.response_text, at: request.completed_at ?? request.created_at, by_name: request.completed_by_name }] : []),
        ];
        return <Card key={request.id} className="min-w-0"><CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">{customer.customer_name}</h2><p className="text-xs text-muted-foreground">{customer.job_id} · {request.status === "pending" ? "Awaiting response" : request.acknowledged_at ? "Resolved" : "Response received"}</p></div>
            <p className="text-xs text-muted-foreground">Requested by {request.requester_name || "Team member"}</p></div>
          <dl className="space-y-2 break-words text-sm">
            <div><dt className="text-xs text-muted-foreground">Customer phone</dt><dd>{formatUSPhone(customer.customer_phone) || "Not provided"}{customer.customer_landline ? ` · Landline: ${formatUSPhone(customer.customer_landline)}` : ""}</dd></div>
            {customer.customer_email && <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{customer.customer_email}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">Service</dt><dd>{customer.service_type || "Not provided"}</dd><dd className="whitespace-pre-wrap">{customer.service_details}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Address</dt><dd>{[customer.address, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ") || "Not provided"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Agreed schedule</dt><dd className="whitespace-pre-wrap">{customer.customer_schedule_requirements || "Not provided"}</dd>
              {customer.scheduled_date && <dd>{customer.scheduled_date} {[customer.scheduled_time_start, customer.scheduled_time_end].filter(Boolean).join(" – ")}</dd>}</div>
            {request.technician && <div><dt className="text-xs text-muted-foreground">Technician</dt><dd>{request.technician.tech_name || "Not assigned"}{request.technician.tech_number ? ` · ${formatUSPhone(request.technician.tech_number)}` : ""}</dd><dd>{request.technician.status || ""} {request.technician.terms || ""}</dd></div>}
          </dl>
          <div className="space-y-2 rounded-xl bg-primary/5 p-3" aria-label="Update conversation">
            {thread.map((entry, index) => <div key={`${entry.at}-${index}`} className={entry.type === "response" ? "border-l-2 border-emerald-500/50 pl-3" : "border-l-2 border-primary/40 pl-3"}>
              <p className="text-xs font-semibold text-muted-foreground">{entry.type === "response" ? "Response" : "Question"}{entry.by_name ? ` · ${entry.by_name}` : ""} · <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{entry.text}</p>
            </div>)}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm" role="status">
            {request.acknowledged_at
              ? `${request.resolved_by_name ? `Resolved by ${request.resolved_by_name}` : "Previously acknowledged"} · ${new Date(request.acknowledged_at).toLocaleString()}`
              : request.status === "pending" ? "Awaiting responder · not yet resolved"
              : `Pending resolution by ${request.owner_name || request.requester_name || "unassigned owner — Admin reassignment needed"}`}
          </div>
          {kind === "cx" && <p className="text-xs text-muted-foreground">Assigned to {request.recipient_name ? `${request.recipient_name} + CS Admin` : "CS Admin (no assigned CS agent)"}</p>}
          <div className="flex flex-wrap gap-2">
            {role === "admin" && !request.acknowledged_at && <Button variant="outline" onClick={() => { setSelection({ request, scope }); setDialogMode("reassign"); setOwnerId(""); setResponse(""); setError(""); }}>Reassign resolution owner</Button>}
            {request.status === "pending" && !request.acknowledged_at && completer && <Button onClick={() => { setSelection({ request, scope }); setDialogMode("complete"); setResponse(""); setError(""); }}>Mark {updatedLabel}</Button>}
            {(role === "admin" || role === "processor") && <Button variant="outline" asChild><Link to={`/leads/${request.lead_id}`}>Open lead</Link></Button>}
            {request.status !== "pending" && !request.acknowledged_at && mayResolve(request) && <>
              <Button disabled={Boolean(ackId)} onClick={() => { void acknowledge(request); }}>{ackId === request.id ? "Resolving…" : "Mark Resolved"}</Button>
              <Button variant="outline" disabled={Boolean(ackId)} onClick={() => { setSelection({ request, scope }); setDialogMode("question_more"); setResponse(""); setError(""); }}>Question More</Button>
            </>}
          </div>
        </CardContent></Card>;
      })}</div>}
    {queue.data && queue.data.total > 20 && <nav aria-label={`${subject} queue pages`} className="flex items-center justify-center gap-3">
      <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
      <span className="text-sm">Page {Math.floor(offset / 20) + 1}</span>
      <Button variant="outline" disabled={offset + 20 >= queue.data.total} onClick={() => setOffset(offset + 20)}>Next</Button>
    </nav>}
    <Dialog open={Boolean(selected)} onOpenChange={(value) => { if (!value && !inFlight.current) closeDialog(); }}>
      <DialogContent><DialogHeader><DialogTitle>{dialogMode === "complete" ? `Mark ${updatedLabel}` : dialogMode === "reassign" ? "Reassign resolution owner" : "Question More"}</DialogTitle>
        <DialogDescription>{dialogMode === "complete" ? `Record the ${kind === "cx" ? "customer" : "technician/job"} response. This returns the request without changing the lead.` : dialogMode === "reassign" ? "Use when the original requester cannot review this work. The original requester remains recorded and your reason is audited. This does not resolve the request." : "Ask a focused follow-up. The request returns to the responder queue and keeps the prior conversation."}</DialogDescription></DialogHeader>
        {dialogMode === "reassign" && <><Label htmlFor="resolution-owner">New resolution owner</Label><select id="resolution-owner" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} disabled={owners.isPending || saving}>
          <option value="">Choose a team member</option>{owners.data?.map((owner) => <option key={owner.id} value={owner.id}>{owner.name || "Unnamed user"} · {owner.role}</option>)}</select>
          {owners.isError && <p role="alert" className="text-sm text-destructive">Could not load eligible owners. <Button variant="link" onClick={() => { void owners.refetch(); }}>Retry</Button></p>}</>}
        <Label htmlFor="update-response">{dialogMode === "complete" ? responseLabel : dialogMode === "reassign" ? "Reassignment reason" : "Follow-up question"}</Label>
        <Textarea id="update-response" value={response} disabled={saving} maxLength={dialogMode === "complete" ? 4000 : 2000} onChange={(event) => setResponse(event.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={closeDialog}>Cancel</Button><Button disabled={saving || !response.trim() || (dialogMode === "reassign" && (!ownerId || response.trim().length < 10))} onClick={() => { void saveDialog(); }}>{saving ? "Saving…" : dialogMode === "complete" ? `Save ${updatedLabel}` : dialogMode === "reassign" ? "Reassign owner" : "Send question"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
