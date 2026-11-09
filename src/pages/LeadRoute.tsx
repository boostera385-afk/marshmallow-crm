import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isOperatorRole } from "@/lib/access";
import LeadDetailPage from "@/pages/LeadDetailPage";

/**
 * /leads/:id. Operators (opr and opr_admin) have limited access: their lead cards
 * have no "Edit Lead" button and they never get the full lead page. Links that
 * still point here (notification "Open lead" buttons, the bell, the map, old or
 * typed URLs) take an Operator to their own Leads view, filtered to that job, so
 * the full lead (customer contact, notes, amounts, payment, history) is never
 * loaded or shown to them. Every other role gets the full lead page as before.
 */
export default function LeadRoute() {
  const { role } = useAuth();
  if (isOperatorRole(role)) return <OperatorLeadRedirect />;
  return <LeadDetailPage />;
}

function OperatorLeadRedirect() {
  const { id } = useParams<{ id: string }>();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!id) {
      setTarget("/leads");
      return;
    }
    // Only the job ID: the redirect needs nothing else from the lead.
    void Promise.resolve(supabase.from("leads").select("job_id").eq("id", id).maybeSingle())
      .then(({ data }) => {
        if (!active) return;
        const jobId = (data as { job_id?: string | null } | null)?.job_id;
        setTarget(jobId ? `/leads?search=${encodeURIComponent(jobId)}` : "/leads");
      })
      .catch(() => { if (active) setTarget("/leads"); });
    return () => { active = false; };
  }, [id]);

  if (target) return <Navigate to={target} replace />;
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Opening job">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  );
}
