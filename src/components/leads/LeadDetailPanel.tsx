import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ServiceCombobox } from "@/components/service-combobox";
import {
  X,
  User,
  MapPin,
  Clock,
  MessageSquare,
  FileText,
  Check,
  AlertCircle,
  Pencil,
  Trash2,
  CalendarClock,
  Wrench,
  Sparkles,
  ShieldCheck,
  CalendarDays,
  Save,
  ExternalLink,
  UserPlus,
  MoreVertical,
  History,
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import LeadCoverageBadge from "./LeadCoverageBadge";
import { geocodeAndPersistLeadAddress } from "@/lib/lead-address-geocoding";
import LeadStatusHistoryDialog from "./LeadStatusHistoryDialog";
import UrgentAICheckDialog from "./UrgentAICheckDialog";
import { showsUrgentCheck } from "@/lib/urgent-verification";
import LeadUpdatesSection from "./LeadUpdatesSection";
import PaymentDialog from "./PaymentDialog";
import CopyLeadButton from "./CopyLeadButton";
import CompleteLeadCopyButton from "./CompleteLeadCopyButton";
import NoteThread from "./NoteThread";
import NearbyAreasList, { type NearbyAreasData } from "./NearbyAreasList";
import CancellationRequestSheet from "./CancellationRequestSheet";
import CancellationRequestPanel from "./CancellationRequestPanel";
import NumberNameCombobox from "./NumberNameCombobox";
import QuoPhoneTrigger from "./QuoPhoneTrigger";
import MultiDateTimePicker from "./MultiDateTimePicker";
import AssignLeadToOperatorDialog from "./AssignLeadToOperatorDialog";
import { LEAD_STATUS_CONFIG, type Lead, type LeadStatus, type LeadCancellationRequest, type AppRole } from "@/types";
import { toast } from "sonner";
import { useDuplicatePhoneCheck } from "@/hooks/useDuplicatePhoneCheck";
import { motion } from "framer-motion";
import { logActivity } from "@/lib/activity";
import { getChangeableStatuses, canChangeStatus } from "@/lib/constants";
import { isOperatorRole } from "@/lib/access";
import { optimizeImageForUpload } from "@/lib/image-upload";
import {
  canCreateCancellationRequest,
  createCancellationRequest,
  fetchPendingCancellationRequest,
  reviewCancellationRequest,
} from "@/lib/cancellation-requests";
import { updateLeadById } from "@/lib/lead-updates";
import { dispatchLeadStatusNotification } from "@/lib/lead-notifications";
import { requestQuoteApproval } from "@/lib/quote-approval-requests";

interface Props {
  leadId: string;
  onClose: () => void;
  onUpdate: () => void;
}

type LeadFormState = Partial<Lead>;
type TrackedLeadField =
  | "customer_name"
  | "customer_email"
  | "customer_phone"
  | "service_type"
  | "address"
  | "half_address"
  | "city"
  | "state"
  | "zip_code"
  | "status"
  | "scheduled_date"
  | "scheduled_time_start"
  | "scheduled_time_end"
  | "expected_completion_date"
  | "number_name"
  | "quote"
  | "service_details"
  | "customer_schedule_requirements"
  | "reference_name"
  | "source_url"
  | "tech_name"
  | "tech_number"
  | "terms"
  | "labor_amount"
  | "material_amount"
  | "for_you_amount"
  | "for_us_amount"
  | "amount";

const SectionHeader = ({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
}) => (
  <div className="mb-5 flex items-start gap-3">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[0.10] to-primary/[0.04] shadow-inner">
      <Icon className="h-4 w-4 text-primary/80" />
    </div>
    <div className="min-w-0">
      <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">{title}</h3>
      {subtitle && <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>}
    </div>
  </div>
);

const StatusDropdownFiltered = ({
  value,
  onChange,
  role,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  role?: string | null;
}) => {
  const changeable = getChangeableStatuses(role);
  const isOpr = isOperatorRole(role as AppRole | null | undefined);

  return (
    <Select value={value} onValueChange={onChange} disabled={isOpr}>
      <SelectTrigger className="h-11 rounded-xl border-border/60 bg-background text-foreground shadow-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {changeable.map((key) => {
          const cfg = LEAD_STATUS_CONFIG[key];
          return cfg ? (
            <SelectItem key={key} value={key}>
              {cfg.label}
            </SelectItem>
          ) : null;
        })}
      </SelectContent>
    </Select>
  );
};

/**
 * Read a money input. An empty field clears the value, and a literal 0 is kept:
 * `parseFloat(value) || null` turned 0 into null, so typing 0 silently blanked
 * the field instead of saving it.
 */
const parseAmountInput = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const LeadDetailPanel = ({ leadId, onClose, onUpdate }: Props) => {
  const { user, role, profile, canAccess } = useAuth();
  const queryClient = useQueryClient();

  const [saved, setSaved] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [cancelRequestOpen, setCancelRequestOpen] = useState(false);
  const [cancelRequestLoading, setCancelRequestLoading] = useState(false);
  const [adminCancelOpen, setAdminCancelOpen] = useState(false);
  const [statusHistoryOpen, setStatusHistoryOpen] = useState(false);
  const [urgentCheckOpen, setUrgentCheckOpen] = useState(false);
  const [adminCancelLoading, setAdminCancelLoading] = useState(false);
  const [cancelReviewLoading, setCancelReviewLoading] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", leadId, role, user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) throw new Error("User not found");

      let query = supabase.from("leads").select("*").eq("id", leadId);

      if (role === "customer_service") {
        query = query.eq("created_by", user.id);
      }

      const { data, error } = await query.single();
      if (error) throw error;
      return data as Lead;
    },
  });

  const { data: lastEditorName } = useQuery({
    queryKey: ["lead-last-editor", lead?.last_edited_by],
    enabled: !!lead?.last_edited_by || !!lead?.last_edited_by_name,
    queryFn: async () => {
      if (!lead?.last_edited_by) return lead?.last_edited_by_name || null;

      const { data, error } = await supabase
        .from("profiles_public" as never)
        .select("full_name")
        .eq("id", lead.last_edited_by)
        .maybeSingle();

      if (error) return lead.last_edited_by_name || null;
      return (data as { full_name?: string } | null)?.full_name || lead.last_edited_by_name || null;
    },
  });

  const { data: pendingCancellationRequest = null, refetch: refetchPendingCancellationRequest } = useQuery({
    queryKey: ["lead-cancellation-request", leadId],
    enabled: !!leadId,
    queryFn: () => fetchPendingCancellationRequest(leadId),
  });

  const [form, setForm] = useState<LeadFormState>({});

  useEffect(() => {
    if (lead) {
      setForm(lead);
    }
  }, [lead]);

  const { isDuplicate, duplicateLeadName } = useDuplicatePhoneCheck(form.customer_phone || "", leadId);

  const formattedEditedAt = useMemo(() => {
    if (!lead?.last_edited_at) return null;
    try {
      return format(new Date(lead.last_edited_at), "MMM d, yyyy • h:mm a");
    } catch {
      return lead.last_edited_at;
    }
  }, [lead?.last_edited_at]);

  const buildLeadChanges = () => {
    if (!lead) return {};

    const changes: Record<string, { before: unknown; after: unknown }> = {};

    const fieldsToTrack: TrackedLeadField[] = [
      "customer_name",
      "customer_email",
      "customer_phone",
      "service_type",
      "address",
      "half_address",
      "city",
      "state",
      "zip_code",
      "status",
      "scheduled_date",
      "scheduled_time_start",
      "scheduled_time_end",
      "expected_completion_date",
      "number_name",
      "quote",
      "service_details",
      "customer_schedule_requirements",
      "reference_name",
      "source_url",
      "tech_name",
      "tech_number",
      "terms",
      "labor_amount",
      "material_amount",
      "for_you_amount",
      "for_us_amount",
      "amount",
    ];

    for (const field of fieldsToTrack) {
      const before = lead[field];
      const after = form[field];

      if ((before ?? null) !== (after ?? null)) {
        changes[field] = {
          before: before ?? null,
          after: after ?? null,
        };
      }
    }

    return changes;
  };

  const update = <K extends keyof Lead>(key: K, value: Lead[K]) => {
    if (key === "status" && !canChangeStatus(role, value as LeadStatus)) {
      toast.error("You do not have permission to set that status");
      return;
    }
    if (key === "status" && value === "paid") {
      setPaymentOpen(true);
      return;
    }
    if (key === "status" && value === "cancelled") {
      if (role === "admin") {
        setAdminCancelOpen(true);
      } else if (canCreateCancellationRequest(role)) {
        setCancelRequestOpen(true);
      } else {
        toast.error("You do not have permission to request cancellation");
      }
      return;
    }
    // CS, CS Admin, and Admin all review the conversation before Urgent. The
    // database gate also blocks direct status writes for these roles; Processor
    // remains exempt for dispatch operations.
    if (key === "status" && value === "urgent_job" && showsUrgentCheck(role)) {
      setUrgentCheckOpen(true);
      return;
    }
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // The database has already moved the lead to urgent by the time this runs.
  // Form state is synced here so the next save does not write the old status and
  // quietly take the lead back out of urgent.
  const handleUrgentProceed = () => {
    setForm((prev) => ({ ...prev, status: "urgent_job" as LeadStatus }));
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    onUpdate();
  };

  const jobCompletionState = useMemo(() => {
    if (form.status !== "job_in_progress" || !form.expected_completion_date) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (form.expected_completion_date < today) return "overdue";
    if (form.expected_completion_date === today) return "due_today";
    return "on_track";
  }, [form.status, form.expected_completion_date]);

  const handleCancellationRequestSubmit = async (comment: string, proof: string, proofImage: File | null, aiReasonCode?: string, aiReasonApplied?: boolean, aiSuggestedReason?: string) => {
    if (!user || !lead) return;

    setCancelRequestLoading(true);
    try {
      await createCancellationRequest({
        lead,
        userId: user.id,
        userName: profile?.full_name || user.email || "Unknown user",
        requesterRole: role,
        comment,
        proof,
        proofImage,
        aiReasonCode,
        aiReasonApplied,
        aiSuggestedReason,
      });
      toast.success("Cancellation request sent for approval");
      setCancelRequestOpen(false);
      setForm((prev) => ({ ...prev, status: "cancellation_requested" as LeadStatus }));
      await refetchPendingCancellationRequest();
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to request cancellation");
    } finally {
      setCancelRequestLoading(false);
    }
  };

  const handleAdminCancelSubmit = async (comment: string, proof: string, proofImage: File | null, aiReasonCode?: string, aiReasonApplied?: boolean) => {
    if (!user || !lead) return;

    setAdminCancelLoading(true);
    try {
      let proofImagePath: string | null = null;
      if (proofImage) {
        const optimized = await optimizeImageForUpload(proofImage);
        const ext = optimized.name.split(".").pop() || "jpg";
        proofImagePath = `cancellation-requests/${leadId}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("lead-photos").upload(proofImagePath, optimized);
        if (uploadError) throw uploadError;
      }

      const reason = [
        comment.trim() ? `Comment: ${comment.trim()}` : "",
        proof.trim() ? `Proof: ${proof.trim()}` : "",
        proofImagePath ? `Proof image: ${proofImagePath}` : "",
        aiReasonApplied ? `(AI Reason: ${aiReasonCode})` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const { error } = await supabase
        .from("leads")
        .update({
          status: "cancelled",
          cancellation_reason: reason,
          cs_tag: null,
          last_edited_by: user.id,
          last_edited_by_name: profile?.full_name || user.email || "Unknown user",
          updated_at: new Date().toISOString(),
          last_edited_at: new Date().toISOString(),
        } as never)
        .eq("id", leadId);

      if (error) throw error;

      await logActivity(user.id, "status_changed", "lead", leadId, {
        target_name: lead.job_id,
        customer_name: lead.customer_name,
        job_id: lead.job_id,
        status_from: lead.status,
        status_to: "cancelled",
        cancellation_reason: reason,
      });

      toast.success("Lead cancelled");
      setAdminCancelOpen(false);
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel lead");
    } finally {
      setAdminCancelLoading(false);
    }
  };

  const handleCancellationReview = async (action: "approved" | "rejected") => {
    if (!user || !lead || !pendingCancellationRequest) return;

    setCancelReviewLoading(true);
    try {
      await reviewCancellationRequest({
        request: pendingCancellationRequest as LeadCancellationRequest,
        lead,
        reviewerId: user.id,
        reviewerName: profile?.full_name || user.email || "Unknown user",
        reviewerRole: role,
        action,
      });
      toast.success(action === "approved" ? "Lead cancelled" : "Cancellation request rejected");
      await refetchPendingCancellationRequest();
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to review cancellation request");
    } finally {
      setCancelReviewLoading(false);
    }
  };

  const handlePaymentConfirm = async (amount: number, screenshotFile: File | null) => {
    setPaymentLoading(true);
    const currentUserName = profile?.full_name || user?.email || "Unknown user";
    let screenshotUrl: string | null = null;

    if (screenshotFile) {
      const optimizedScreenshot = await optimizeImageForUpload(screenshotFile);
      const ext = optimizedScreenshot.name.split(".").pop();
      const path = `payments/${leadId}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("lead-photos").upload(path, optimizedScreenshot);
      if (!uploadError) {
        screenshotUrl = path;
      }
    }

    setForm((prev) => ({
      ...prev,
      status: "paid" as LeadStatus,
      amount,
      payment_amount: amount,
      payment_screenshot_url: screenshotUrl,
    }));

    let paymentQuery = supabase
      .from("leads")
      .update({
        status: "paid",
        amount,
        payment_amount: amount,
        payment_screenshot_url: screenshotUrl,
        last_edited_by: user?.id,
        last_edited_by_name: currentUserName,
        last_edited_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    if (role === "customer_service" && user) {
      paymentQuery = paymentQuery.eq("created_by", user.id);
    }

    const { error } = await paymentQuery;

    setPaymentLoading(false);
    setPaymentOpen(false);

    if (error) {
      toast.error(error.message);
    } else {
      if (user && lead) {
        await logActivity(user.id, "payment_recorded", "lead", leadId, {
          target_name: lead.job_id,
          customer_name: lead.customer_name,
          job_id: lead.job_id,
          amount,
          status_from: lead.status,
          status_to: "paid",
          screenshot_uploaded: !!screenshotUrl,
          changes: {
            status: {
              before: lead.status,
              after: "paid",
            },
            payment_amount: {
              before: lead.payment_amount ?? null,
              after: amount,
            },
            payment_screenshot_url: {
              before: lead.payment_screenshot_url ?? null,
              after: screenshotUrl ?? null,
            },
            amount: {
              before: lead.amount ?? null,
              after: amount,
            },
          },
        });
      }

      toast.success("Payment recorded");
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      onUpdate();
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) return;
      if (isDuplicate) throw new Error(`Duplicate phone: ${duplicateLeadName}`);
      if (!form.status || !canChangeStatus(role, form.status as LeadStatus)) {
        throw new Error("You do not have permission to set that status");
      }
      if (form.status === "cancelled" && role !== "admin") {
        throw new Error("Please send a cancellation request instead of cancelling directly");
      }

      const previousStatus = lead?.status;
      const newStatus = form.status;
      const changes = buildLeadChanges();
      const quoteApprovalRequested =
        role === "customer_service" &&
        newStatus === "pending_to_send" &&
        previousStatus !== "pending_to_send";
      const savedStatus = quoteApprovalRequested ? previousStatus : newStatus;
      if (!savedStatus) throw new Error("Current lead status is unavailable");
      if (quoteApprovalRequested) delete changes.status;

      let addressLatitude = lead?.latitude ?? null;
      let addressLongitude = lead?.longitude ?? null;
      let addressCity = form.city || null;
      let addressState = form.state || null;
      let addressZip = form.zip_code || null;
      const addressChanged = form.address.trim() !== (lead?.address ?? "").trim()
        || lead?.latitude == null
        || lead?.longitude == null;
      if (addressChanged) {
        addressLatitude = null;
        addressLongitude = null;
        addressCity = null;
        addressState = null;
        addressZip = null;
      }

      const updateData: Record<string, unknown> = {
        customer_name: form.customer_name,
        customer_email: form.customer_email,
        customer_phone: form.customer_phone,
        service_type: form.service_type,
        address: form.address,
        latitude: addressLatitude,
        longitude: addressLongitude,
        half_address: form.half_address,
        city: addressCity,
        state: addressState,
        zip_code: addressZip,
        status: savedStatus,
        scheduled_date: form.scheduled_date,
        scheduled_time_start: form.scheduled_time_start,
        scheduled_time_end: form.scheduled_time_end,
        expected_completion_date: form.expected_completion_date || null,
        last_edited_by: user.id,
        last_edited_by_name: profile?.full_name || user.email || "Unknown user",
        last_edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        number_name: form.number_name,
        quote: form.quote,
        service_details: form.service_details,
        customer_schedule_requirements: form.customer_schedule_requirements,
        reference_name: form.reference_name,
        tech_name: role !== "customer_service" && role !== "cs_admin" ? form.tech_name : lead?.tech_name,
        tech_number: role !== "customer_service" && role !== "cs_admin" ? form.tech_number : lead?.tech_number,
        terms: role !== "customer_service" && role !== "cs_admin" ? form.terms : lead?.terms,
        labor_amount: role !== "customer_service" && role !== "cs_admin" ? form.labor_amount : lead?.labor_amount,
        material_amount: role !== "customer_service" && role !== "cs_admin" ? form.material_amount : lead?.material_amount,
        for_you_amount: role !== "customer_service" && role !== "cs_admin" ? form.for_you_amount : lead?.for_you_amount,
        for_us_amount: role !== "customer_service" && role !== "cs_admin" ? form.for_us_amount : lead?.for_us_amount,
      };

      if (form.status === "paid") {
        updateData.amount = form.amount;
      }

      if (form.status === "cancelled") {
        updateData.cancellation_reason = null;
      }

      if (!quoteApprovalRequested && form.status !== lead?.status) {
        (updateData as Record<string, unknown>).cs_tag = null;
      }

      try {
        await updateLeadById(leadId, updateData as Record<string, unknown>);
      } catch (saveErr: unknown) {
        const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
        if (msg.includes("expected_completion_date")) {
          const { expected_completion_date: _, ...fallbackData } = updateData as Record<string, unknown>;
          await updateLeadById(leadId, fallbackData);
        } else {
          throw saveErr;
        }
      }

      if (addressChanged && form.address.trim()) {
        void geocodeAndPersistLeadAddress(leadId, form.address).then((updated) => {
          if (updated) {
            queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
            onUpdate();
          }
        });
      }

      if (quoteApprovalRequested && lead) {
        await requestQuoteApproval({ lead, requesterId: user.id });
      }

      if (
        (lead?.status !== savedStatus && (savedStatus === "urgent_job" || savedStatus === "need_tech" || savedStatus === "job_in_progress")) ||
        (savedStatus === "job_in_progress" && lead?.expected_completion_date !== form.expected_completion_date && form.expected_completion_date)
      ) {
        await dispatchLeadStatusNotification({
          leadId,
          leadName: form.customer_name,
          status: savedStatus,
          expectedCompletionDate: form.expected_completion_date,
        });
      }

      if (lead?.status !== savedStatus && savedStatus === "quote_updated") {
        await dispatchLeadStatusNotification({
          leadId,
          leadName: form.customer_name,
          status: savedStatus,
          quoteRequestedBy: lead?.quote_requested_by,
        });
      }

      if (Object.keys(changes).length > 0) {
        await logActivity(user.id, "updated", "lead", leadId, {
          target_name: lead?.job_id || leadId,
          customer_name: form.customer_name,
          job_id: lead?.job_id || null,
          changes,
        });
      }

      if (previousStatus !== savedStatus) {
        await logActivity(user.id, "status_changed", "lead", leadId, {
          target_name: lead?.job_id || leadId,
          customer_name: form.customer_name,
          job_id: lead?.job_id || null,
          status_from: previousStatus,
          status_to: savedStatus,
          changes: {
            status: {
              before: previousStatus ?? null,
              after: savedStatus ?? null,
            },
          },
        });
      }

      return { quoteApprovalRequested };
    },
    onSuccess: (result) => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      toast.success(result?.quoteApprovalRequested ? "Lead saved and quote sent for approval" : "Lead saved");
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      onUpdate();
    },
    onError: (err: unknown) => toast.error("Save failed: " + (err instanceof Error ? err.message : "Unknown error")),
  });

  const isCS = role === "customer_service";
  const isProcessor = role === "processor";
  const isOpr = isOperatorRole(role);
  const isAdmin = role === "admin";
  const isCsAdmin = role === "cs_admin";
  const hasQuickChatAccess = canAccess("quick_chat");
  const hasTechQuickChatAccess = canAccess("tech_quick_chat");
  // CS Admin has the same limited view of processor internals as CS users.
  const hideProcessorDetails = isCS || isCsAdmin;

  const labelClass = "text-[12px] font-semibold tracking-[-0.01em] text-foreground/82";
  const fieldClass =
    "crm-lead-card-inner h-11 rounded-xl border-border/60 bg-transparent text-foreground shadow-[0_16px_24px_-22px_rgba(59,130,246,0.12)] placeholder:text-muted-foreground/55 dark:shadow-none";
  const areaClass =
    "crm-lead-card-inner rounded-xl border-border/60 bg-transparent text-foreground shadow-[0_16px_24px_-22px_rgba(59,130,246,0.12)] placeholder:text-muted-foreground/55 resize-none dark:shadow-none";
  const sectionClass = "glass-panel rounded-[26px] border border-border/65 p-5 shadow-[0_24px_46px_-32px_rgba(59,130,246,0.16)] dark:shadow-none";

  if (isLoading || !lead) {
    return (
      <div className="fixed inset-0 z-40 flex">
        <div className="flex-1 bg-foreground/15" onClick={onClose} />
        <div className="w-[58%] max-w-4xl border-l border-border bg-card p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading lead...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex-1 bg-foreground/20"
        onClick={onClose}
      />

      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        className="w-[58%] max-w-4xl overflow-y-auto border-l border-border bg-[linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent)] bg-card"
      >
        <div className="glass-panel-strong sticky top-0 z-20 border-b border-border/60">
          <div className="px-6 pt-5 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-primary/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                    <Sparkles className="h-2.5 w-2.5" />
                    Lead Detail
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground/65">{lead.job_id}</span>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="max-w-[360px] truncate text-[20px] font-semibold tracking-[-0.025em] text-foreground">
                    {lead.customer_name}
                  </h2>
                  <StatusBadge status={lead.status as LeadStatus} />
                  <LeadCoverageBadge
                    level={lead.coverage_level}
                    count={lead.coverage_tech_count}
                    areaLabel={lead.coverage_area_label}
                  />
                  {lead.source_url && (
                    <a
                      href={lead.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source chat on Quo.com"
                      className="inline-flex items-center justify-center rounded-[8px] bg-[#EEFF41] hover:bg-[#F4FF40] text-[#1A237E] font-extrabold text-[10px] px-2 py-1 tracking-wider transition-all duration-300 border border-[#D4E157] shadow-sm select-none"
                    >
                      QUO
                    </a>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  {lead.created_at && (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Created {format(new Date(lead.created_at), "MMM d, yyyy")}
                    </span>
                  )}

                  {(formattedEditedAt || lastEditorName) && (
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {lastEditorName ? `Edited by ${lastEditorName}` : "Edited"}
                      {formattedEditedAt ? ` • ${formattedEditedAt}` : ""}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {hasQuickChatAccess && lead.customer_phone && (
                  <QuoPhoneTrigger
                    contactName={lead.customer_name}
                    phone={lead.customer_phone}
                    chatType="customer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-all no-underline shadow-sm"
                  >
                    <MessageSquare className="h-4 w-4" />
                    <span>CX Quick Chat</span>
                  </QuoPhoneTrigger>
                )}
                {hasTechQuickChatAccess && lead.tech_number && (
                  <QuoPhoneTrigger
                    contactName={lead.tech_name || "Technician"}
                    phone={lead.tech_number}
                    chatType="tech"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-all no-underline shadow-sm"
                  >
                    <Wrench className="h-4 w-4" />
                    <span>Tech Quick Chat</span>
                  </QuoPhoneTrigger>
                )}
                <CopyLeadButton lead={lead} />
                <CompleteLeadCopyButton lead={lead} />

                {!isOpr && (
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || isDuplicate}
                    size="sm"
                    className="min-w-[92px] gap-1.5 rounded-xl shadow-sm"
                  >
                    {saved ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Saved
                      </>
                    ) : saveMutation.isPending ? (
                      "Saving..."
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        Save
                      </>
                    )}
                  </Button>
                )}

                <button
                  onClick={onClose}
                  className="rounded-xl border border-border/60 bg-background p-2 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>

            <div className="crm-lead-card-footer mt-4 rounded-2xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/70">
                  Current Status
                </Label>
                {isDuplicate && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-destructive/15 bg-destructive/[0.07] px-2.5 py-1 text-[10px] font-medium text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    Duplicate phone: {duplicateLeadName}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <StatusDropdownFiltered value={form.status} onChange={(v) => update("status", v as LeadStatus)} role={role} />
                </div>
                <Button variant="outline" className="h-11 shrink-0 gap-1.5 px-3 rounded-xl border-border/60" onClick={() => setStatusHistoryOpen(true)}>
                  <History className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">History</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pt-5">
          <CancellationRequestPanel
            request={pendingCancellationRequest as LeadCancellationRequest | null}
            role={role}
            loading={cancelReviewLoading}
            onApprove={() => handleCancellationReview("approved")}
            onReject={() => handleCancellationReview("rejected")}
          />
        </div>

        <div className="space-y-6 p-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className={sectionClass}
          >
            <SectionHeader
              icon={User}
              title="Customer Information"
              subtitle="Primary contact details, service request, and intake information."
            />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className={labelClass}>Name</Label>
                <Input
                  value={form.customer_name ?? ""}
                  onChange={(e) => update("customer_name", e.target.value)}
                  readOnly={isProcessor || isOpr}
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Number Name</Label>
                <NumberNameCombobox
                  value={form.number_name}
                  onChange={(value) => update("number_name", value)}
                  disabled={isProcessor || isOpr}
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Phone</Label>
                <Input
                  value={form.customer_phone ?? ""}
                  onChange={(e) => update("customer_phone", e.target.value)}
                  readOnly={isProcessor || isOpr}
                  className={`${fieldClass} ${isDuplicate ? "border-destructive ring-1 ring-destructive/40" : ""}`}
                />
                {form.customer_phone && (
                  <QuoPhoneTrigger
                    contactName={form.customer_name ?? "Lead"}
                    phone={String(form.customer_phone)}
                    chatType="customer"
                    className="text-xs font-medium"
                  >
                    {String(form.customer_phone)}
                  </QuoPhoneTrigger>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Email</Label>
                <Input
                  value={form.customer_email ?? ""}
                  onChange={(e) => update("customer_email", e.target.value)}
                  readOnly={isProcessor || isOpr}
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Service Type</Label>
                <ServiceCombobox
                  value={form.service_type ?? ""}
                  onChange={(val) => update("service_type", val)}
                  disabled={isProcessor || isOpr}
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Quote</Label>
                <Input
                  value={form.quote ?? ""}
                  onChange={(e) => update("quote", e.target.value)}
                  readOnly={isProcessor || isOpr}
                  className={fieldClass}
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label className={labelClass}>Service Details</Label>
                <Textarea
                  value={form.service_details ?? ""}
                  onChange={(e) => update("service_details", e.target.value)}
                  readOnly={isProcessor || isOpr}
                  rows={4}
                  className={`${areaClass} min-h-[108px]`}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Schedule Requirements</Label>
                <MultiDateTimePicker
                  value={form.customer_schedule_requirements ?? ""}
                  onChange={(val) => update("customer_schedule_requirements", val)}
                  readOnly={isProcessor || isOpr}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Reference</Label>
                <Input
                  value={form.reference_name ?? ""}
                  onChange={(e) => update("reference_name", e.target.value)}
                  readOnly={isProcessor || isOpr}
                  className={fieldClass}
                />
              </div>

              {form.source_url && (
                <div className="col-span-2 space-y-1.5">
                  <Label className={labelClass}>Source URL (Intake Chat Link)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.source_url ?? ""}
                      readOnly
                      className={`${fieldClass} flex-1`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => window.open(form.source_url!, "_blank")}
                      className="shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-[14px]"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span>Quo Chat Thread</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.03 }}
            className={sectionClass}
          >
            <SectionHeader
              icon={MapPin}
              title="Address"
              subtitle="Customer location details used for routing and scheduling."
            />

            <div className="space-y-1.5">
              <Label className={labelClass}>Address</Label>
              <Input
                value={form.address ?? ""}
                onChange={(e) => update("address", e.target.value)}
                readOnly={isProcessor || isOpr}
                placeholder="Full address"
                className={fieldClass}
              />
            </div>

            <div className="mt-4 space-y-1.5">
              <Label className={labelClass}>Half Address</Label>
              <Input
                value={form.half_address ?? ""}
                onChange={(e) => update("half_address", e.target.value)}
                readOnly={isProcessor || isOpr}
                placeholder="Shortened address shown to operators"
                className={fieldClass}
              />
            </div>
          </motion.div>

          {!hideProcessorDetails && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.06 }}
              className={sectionClass}
            >
              <SectionHeader
                icon={Wrench}
                title="Processor Details"
                subtitle="Assigned technician, quote mode, and internal cost breakdown."
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className={labelClass}>Tech Name</Label>
                  <Input
                    value={form.tech_name ?? ""}
                    onChange={(e) => update("tech_name", e.target.value)}
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Tech Number</Label>
                  <Input
                    value={form.tech_number ?? ""}
                    onChange={(e) => update("tech_number", e.target.value)}
                    className={fieldClass}
                  />
                  {form.tech_number && (
                    <QuoPhoneTrigger
                      contactName={form.tech_name ?? "Technician"}
                      phone={String(form.tech_number)}
                      chatType="tech"
                      className="text-xs font-medium"
                    >
                      {String(form.tech_number)}
                    </QuoPhoneTrigger>
                  )}
                </div>

                <div className="col-span-2 space-y-1.5">
                  <Label className={labelClass}>Terms</Label>
                  <Select value={form.terms ?? ""} onValueChange={(v) => update("terms", v as "free_estimate" | "quoted")}>
                    <SelectTrigger className={fieldClass}>
                      <SelectValue placeholder="Select terms..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free_estimate">Free Estimate Visit</SelectItem>
                      <SelectItem value="quoted">Quoted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.terms === "quoted" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className={labelClass}>Customer Labor ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={form.labor_amount ?? ""}
                        onChange={(e) => update("labor_amount", parseAmountInput(e.target.value))}
                        className={fieldClass}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className={labelClass}>Materials ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={form.material_amount ?? ""}
                        onChange={(e) => update("material_amount", parseAmountInput(e.target.value))}
                        className={fieldClass}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className={labelClass}>For You ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={form.for_you_amount ?? ""}
                        onChange={(e) => update("for_you_amount", parseAmountInput(e.target.value))}
                        className={fieldClass}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className={labelClass}>For Us ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={form.for_us_amount ?? ""}
                        onChange={(e) => update("for_us_amount", parseAmountInput(e.target.value))}
                        className={fieldClass}
                      />
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}

          {!hideProcessorDetails && (
            <NearbyAreasList
              leadId={leadId}
              customerAddress={form.address ?? lead.address ?? null}
              customerCity={form.city ?? lead.city ?? null}
              customerState={form.state ?? lead.state ?? null}
              customerZip={form.zip_code ?? lead.zip_code ?? null}
              latitude={(lead as unknown as { latitude?: number | null }).latitude ?? null}
              longitude={(lead as unknown as { longitude?: number | null }).longitude ?? null}
              savedNearbyAreas={
                ((lead as unknown as { nearby_areas?: unknown }).nearby_areas as NearbyAreasData | null) ?? null
              }
              canManage={isAdmin || isProcessor}
            />
          )}

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.09 }}
            className={sectionClass}
          >
            <SectionHeader
              icon={Clock}
              title="Schedule"
              subtitle="Date, time window, and payment amount when applicable."
            />

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className={labelClass}>Date</Label>
                <Input
                  type="date"
                  value={form.scheduled_date ?? ""}
                  onChange={(e) => update("scheduled_date", e.target.value)}
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Start Time</Label>
                <Input
                  type="time"
                  value={form.scheduled_time_start ?? ""}
                  onChange={(e) => update("scheduled_time_start", e.target.value)}
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>End Time</Label>
                <Input
                  type="time"
                  value={form.scheduled_time_end ?? ""}
                  onChange={(e) => update("scheduled_time_end", e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>

            {(role === "admin" || role === "processor") && (form.status === "job_in_progress" || form.expected_completion_date) && (
              <div className="mt-4 space-y-2.5 rounded-2xl border border-sky-200/80 bg-sky-50/60 p-3.5 dark:border-sky-800/40 dark:bg-sky-950/20">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] font-semibold text-sky-950 dark:text-sky-200 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                    Expected Job Completion Date
                  </Label>
                  {jobCompletionState === "overdue" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                      <AlertCircle className="h-3 w-3" />
                      Completion Overdue
                    </span>
                  )}
                  {jobCompletionState === "due_today" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      <Clock className="h-3 w-3" />
                      Due Today
                    </span>
                  )}
                </div>
                <Input
                  type="date"
                  value={form.expected_completion_date ?? ""}
                  onChange={(e) => update("expected_completion_date", e.target.value)}
                  className={fieldClass}
                />
                {(role === "admin" || role === "processor") && (jobCompletionState === "overdue" || jobCompletionState === "due_today") && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-50/90 p-2.5 text-[11px] text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                    <span>
                      <strong>Reminder for Processor & Admin:</strong> This job {jobCompletionState === "overdue" ? "has exceeded" : "is expected to finish today on"} its target completion date ({form.expected_completion_date}). Please follow up with technician ({form.tech_name || "Unassigned"}).
                    </span>
                  </div>
                )}
                {form.expected_completion_date && jobCompletionState === "on_track" && (
                  <p className="text-[11px] text-sky-700 dark:text-sky-300">
                    🔔 Processors and Admins will be notified when this job reaches its completion date.
                  </p>
                )}
              </div>
            )}

            {form.status === "paid" && (
              <div className="mt-4 w-[220px] space-y-1.5">
                <Label className={labelClass}>Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount ?? ""}
                  onChange={(e) => update("amount", parseAmountInput(e.target.value))}
                  className={fieldClass}
                />
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.12 }}
            className={sectionClass}
          >
            <SectionHeader
              icon={MessageSquare}
              title="General Notes"
              subtitle="Shared notes and customer-related context."
            />
            <NoteThread leadId={leadId} noteType="general" label="General Notes" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.15 }}
            className={sectionClass}
          >
            <SectionHeader
              icon={MessageSquare}
              title="CS Notes"
              subtitle="Customer service notes and follow-up context."
            />
            <NoteThread leadId={leadId} noteType="cs" label="CS Notes" />
          </motion.div>

          {!hideProcessorDetails && !isOpr && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.18 }}
              className={sectionClass}
            >
              <SectionHeader
                icon={FileText}
                title="Processor Notes"
                subtitle="Technician and processing-side internal notes."
              />
              <NoteThread leadId={leadId} noteType="processor" label="Processor Notes" />
            </motion.div>
          )}

          {(isAdmin || isProcessor || isOpr) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.19 }}
              className={sectionClass}
            >
              <SectionHeader
                icon={UserPlus}
                title="OPR Notes"
                subtitle="Notes shared with assigned operators."
              />
              <NoteThread leadId={leadId} noteType="opr" label="OPR Notes" />
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.21 }}
            className={sectionClass}
          >
            <SectionHeader
              icon={FileText}
              title="Activity & Updates"
              subtitle="Recent changes, timeline activity, and lead history."
            />
            <LeadUpdatesSection leadId={leadId} />
          </motion.div>
        </div>

        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          onConfirm={handlePaymentConfirm}
          loading={paymentLoading}
          mode={isProcessor ? "request" : "direct"}
        />

        <CancellationRequestSheet
          open={cancelRequestOpen}
          onOpenChange={setCancelRequestOpen}
          onSubmit={handleCancellationRequestSubmit}
          loading={cancelRequestLoading}
          requesterLabel={isProcessor ? "Admin" : "Processor or Admin"}
          leadId={leadId || undefined}
        />

        <CancellationRequestSheet
          open={adminCancelOpen}
          onOpenChange={setAdminCancelOpen}
          onSubmit={handleAdminCancelSubmit}
          loading={adminCancelLoading}
          mode="direct"
          leadId={leadId || undefined}
        />

<LeadStatusHistoryDialog
            open={statusHistoryOpen}
            onOpenChange={setStatusHistoryOpen}
            leadId={leadId}
            currentStatus={form.status}
          />

          <UrgentAICheckDialog
            open={urgentCheckOpen}
            onOpenChange={setUrgentCheckOpen}
            leadId={leadId}
            onProceed={handleUrgentProceed}
          />
      </motion.div>
    </div>
  );
};

export default LeadDetailPanel;
