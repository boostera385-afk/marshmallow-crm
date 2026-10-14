import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCopilotAccess } from "@/hooks/useCopilotAccess";
import { CopilotContext } from "@/lib/copilot-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
const CopilotPanel = lazy(() => import("./CopilotPanel"));

export default function CopilotProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const [open, setSessionOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const setOpen = useCallback((value: boolean) => { setSessionOpen(value); setMinimized(false); }, []);
  const { access } = useCopilotAccess(open);
  useEffect(() => { if (!access) setOpen(false); }, [access, setOpen]);
  return <CopilotContext.Provider value={{ access, open: open && !minimized && Boolean(access), setOpen }}>
    {children}
    {access && open && <ErrorBoundary fallback={<div role="alert" className="fixed bottom-4 right-4 z-40 max-w-sm rounded-xl border bg-card p-4 text-sm shadow-lg">Copilot could not open. Your CRM remains available.<Button variant="outline" className="mt-2" onClick={() => setOpen(false)}>Close assistant</Button></div>}><Suspense fallback={<div role="status" className="fixed bottom-4 right-4 z-40 rounded-xl border bg-card p-4 text-sm shadow-lg">Opening Copilot…</div>}>
      <CopilotPanel key={`${user?.id}:${role}`} access={access} minimized={minimized} onMinimizedChange={setMinimized} onClose={() => setOpen(false)} />
    </Suspense></ErrorBoundary>}
  </CopilotContext.Provider>;
}
