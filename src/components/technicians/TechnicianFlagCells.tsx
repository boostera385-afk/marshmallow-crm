import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Clock, Star } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { TECHNICIANS_ROOT_KEY } from "@/lib/technicians";
import {
  fetchPendingChangeSummary,
  requestTechnicianChange,
  type TechnicianChangeType,
} from "@/lib/tech-change-requests";
import { silkySpring } from "@/lib/motion";
import { backgroundInterval } from "@/lib/overload-guard";

export interface TechnicianFlagTarget {
  id: string;
  name: string;
  is_good_tech?: boolean | null;
  is_active?: boolean | null;
}

const QUERY_KEY = ["tech-pending-changes"];

/**
 * Good Tech control that respects the approval rule.
 *
 * An admin writes the flag directly. A processor raises a request instead,
 * because a BEFORE UPDATE trigger on technicians refuses those two columns for
 * anyone who is not an admin. Attempting the write anyway would fail with a
 * 42501 from the database, so the branch is taken here rather than discovered
 * there.
 *
 * A pending request disables the control and says so, rather than letting the
 * user press a button that the database will reject as a duplicate.
 */
export function GoodTechFlagCell({ tech }: { tech: TechnicianFlagTarget }) {
  const { role, profile } = useAuth();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);

  const isAdmin = role === "admin";
  const pendingQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPendingChangeSummary,
    refetchInterval: backgroundInterval(30_000),
    refetchIntervalInBackground: false,
    enabled: role === "processor",
  });

  const pendingTypes = pendingQuery.data?.[tech.id]?.change_types ?? [];
  const awaitingApproval = pendingTypes.includes("set_good_tech");
  const isGoodTech = Boolean(tech.is_good_tech);

  const requestMutation = useMutation({
    mutationFn: (next: boolean) =>
      requestTechnicianChange({
        technicianId: tech.id,
        technicianName: tech.name,
        changeType: "set_good_tech" as TechnicianChangeType,
        requestedValue: next,
        requesterId: profile?.id ?? "",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Request sent to an admin", {
        description: `${tech.name} will be marked Good Tech once approved.`,
      });
    },
    onError: (err: Error) => toast.error("Could not raise the request", { description: err.message }),
    onSettled: () => setBusy(false),
  });

  const directMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("technicians")
        .update({ is_good_tech: next } as never)
        .eq("id", tech.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      // The directory list holds a 30 second staleTime, so an admin writing
      // the flag here would not see it apply without this.
      void queryClient.invalidateQueries({ queryKey: TECHNICIANS_ROOT_KEY });
      toast.success(isGoodTech ? "Good Tech cleared" : "Marked as Good Tech");
    },
    onError: (err: Error) => toast.error("Could not update", { description: err.message }),
    onSettled: () => setBusy(false),
  });

  const handleToggle = (next: boolean) => {
    setBusy(true);
    if (isAdmin) directMutation.mutate(next);
    else requestMutation.mutate(next);
  };

  const disabled = awaitingApproval || busy;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleToggle(!isGoodTech);
        }}
        disabled={disabled}
        className="p-1 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        title={
          awaitingApproval
            ? "Awaiting admin approval"
            : isAdmin
              ? isGoodTech
                ? "Clear Good Tech"
                : "Mark as Good Tech"
              : `Request ${isGoodTech ? "clearing" : "setting"} Good Tech`
        }
        aria-label={
          isAdmin
            ? `${isGoodTech ? "Clear" : "Set"} Good Tech for ${tech.name}`
            : `Request ${isGoodTech ? "clearing" : "setting"} Good Tech for ${tech.name}`
        }
      >
        <Star
          className={`h-4 w-4 transition-colors ${
            isGoodTech
              ? "fill-amber-500 text-amber-500"
              : "text-muted-foreground/30 hover:text-muted-foreground"
          }`}
        />
      </button>

      <AnimatePresence>
        {awaitingApproval ? (
          <motion.span
            initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.9 }}
            transition={{ ...silkySpring }}
          >
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            >
              <Clock className="h-2.5 w-2.5" />
              Pending
            </Badge>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * Active status control with the same admin-writes, processor-requests split.
 *
 * Rendered at a smaller scale than the switch used in the directory list, so
 * the two cells stay visually balanced side by side.
 */
export function ActiveFlagCell({ tech }: { tech: TechnicianFlagTarget }) {
  const { role, profile } = useAuth();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);

  const isAdmin = role === "admin";
  const pendingQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPendingChangeSummary,
    refetchInterval: backgroundInterval(30_000),
    refetchIntervalInBackground: false,
    enabled: role === "processor",
  });

  const awaitingApproval =
    (pendingQuery.data?.[tech.id]?.change_types ?? []).includes("set_active");
  const isActive = tech.is_active !== false;

  const requestMutation = useMutation({
    mutationFn: (next: boolean) =>
      requestTechnicianChange({
        technicianId: tech.id,
        technicianName: tech.name,
        changeType: "set_active" as TechnicianChangeType,
        requestedValue: next,
        requesterId: profile?.id ?? "",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Request sent to an admin", {
        description: `${tech.name} will be ${!isActive ? "active" : "inactive"} once approved.`,
      });
    },
    onError: (err: Error) => toast.error("Could not raise the request", { description: err.message }),
    onSettled: () => setBusy(false),
  });

  const directMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("technicians")
        .update({ is_active: next } as never)
        .eq("id", tech.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TECHNICIANS_ROOT_KEY });
      toast.success(isActive ? "Technician deactivated" : "Technician activated");
    },
    onError: (err: Error) => toast.error("Could not update", { description: err.message }),
    onSettled: () => setBusy(false),
  });

  const handleToggle = (next: boolean) => {
    setBusy(true);
    if (isAdmin) directMutation.mutate(next);
    else requestMutation.mutate(next);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <Switch
        checked={isActive}
        onCheckedChange={handleToggle}
        disabled={awaitingApproval || busy}
        aria-label={
          isAdmin
            ? `${isActive ? "Deactivate" : "Activate"} ${tech.name}`
            : `Request ${isActive ? "deactivation" : "activation"} of ${tech.name}`
        }
        className="scale-75 origin-left"
      />
      <AnimatePresence>
        {awaitingApproval ? (
          <motion.span
            initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.9 }}
            transition={{ ...silkySpring }}
          >
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            >
              <Clock className="h-2.5 w-2.5" />
              Pending
            </Badge>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}