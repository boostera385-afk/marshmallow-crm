import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback } from "react";
import type { ChangeEvent, ElementType } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activity";
import { dispatchLeadStatusNotification } from "@/lib/lead-notifications";
import { formatUSPhone, hasContactNumber } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ServiceCombobox } from "@/components/service-combobox";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  AlertCircle,
  ImagePlus,
  X,
  ChevronDown,
  User,
  Wrench,
  Calendar,
  Check,
  Phone,
  MapPin,
  Clock3,
  BadgeDollarSign,
  Sparkles,
  MessageSquare,
} from "lucide-react";
import { motion } from "framer-motion";
import MultiDateTimePicker from "@/components/leads/MultiDateTimePicker";
import { useDuplicatePhoneCheck } from "@/hooks/useDuplicatePhoneCheck";
import PaymentDialog from "@/components/leads/PaymentDialog";
import ImageLightbox from "@/components/leads/ImageLightbox";
import LeadPhotoActions from "@/components/leads/LeadPhotoActions";
import CopyLeadButton from "@/components/leads/CopyLeadButton";
import CompleteLeadCopyButton from "@/components/leads/CompleteLeadCopyButton";
import ReminderButton from "@/components/leads/ReminderButton";
import NoteThread from "@/components/leads/NoteThread";
import NearbyAreasList, { type NearbyAreasData } from "@/components/leads/NearbyAreasList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LEAD_STATUS_CONFIG, type Lead, type LeadStatus, type LeadCancellationRequest } from "@/types";
import { getChangeableStatuses, canChangeStatus } from "@/lib/constants";
import { optimizeImageForUpload } from "@/lib/image-upload";
import { updateLeadById } from "@/lib/lead-updates";
import { requestQuoteApproval } from "@/lib/quote-approval-requests";
import StatusBadge from "@/components/leads/StatusBadge";
import LeadCoverageBadge from "@/components/leads/LeadCoverageBadge";
import { geocodeAndPersistLeadAddress } from "@/lib/lead-address-geocoding";
import CancelledStatusBadge from "@/components/leads/CancelledStatusBadge";
import NearbyUrgentLeads from "@/components/leads/NearbyUrgentLeads";
import LeadTagControl from "@/components/leads/LeadTagControl";
import { useNearbyUrgentLeads } from "@/hooks/useNearbyUrgentLeads";
import { canSeeTechDetails } from "@/lib/access";
import CancellationRequestSheet from "@/components/leads/CancellationRequestSheet";
import CancellationRequestPanel from "@/components/leads/CancellationRequestPanel";
import QuoPhoneTrigger from "@/components/leads/QuoPhoneTrigger";
import { heroTitle, premiumEase, silkySpring } from "@/lib/motion";
import {
  canCreateCancellationRequest,
  createCancellationRequest,
  fetchPendingCancellationRequest,
  reviewCancellationRequest,
} from "@/lib/cancellation-requests";
import NumberNameCombobox from "@/components/leads/NumberNameCombobox";
import UrgentAICheckDialog from "@/components/leads/UrgentAICheckDialog";
import { showsUrgentCheck } from "@/lib/urgent-verification";

const PHOTO_PREVIEW_LIMIT = 1;

interface ExistingPhoto {
  id: string;
  previewUrl: string;
  originalUrl?: string;
  path: string;
}

const generateJobId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "LD-";
  for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
};

const SectionHeader = ({
  icon: Icon,
  title,
  subtitle,
  open,
}: {
  icon: ElementType;
  title: string;
  subtitle?: string;
  open: boolean;
}) => (
  <div className="flex w-full items-start gap-3">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/12 bg-gradient-to-br from-primary/[0.10] to-primary/[0.04] shadow-inner">
      <Icon className="h-4 w-4 text-primary/80" />
    </div>
    <div className="min-w-0 flex-1 text-left">
      <div className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">{title}</div>
      {subtitle && <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{subtitle}</div>}
    </div>
    <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
      <ChevronDown className="h-4 w-4 text-muted-foreground/70" />
    </motion.span>
  </div>
);

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, role, profile, canAccess } = useAuth();

  const isNew = id === "new";
  const isCS = role === "customer_service";
  const isProcessor = role === "processor";
  const isOpr = role === "opr";
  const isAdmin = role === "admin";
  const isCsAdmin = role === "cs_admin";
  const hideProcessorDetails = isCS || isCsAdmin;
  // Same quick chats as the lead card. Tech chat is hidden from CS Admins, who do not see
  // technician details anywhere.
  const hasQuickChatAccess = canAccess("quick_chat");
  const hasTechQuickChatAccess = canAccess("tech_quick_chat") && canSeeTechDetails(role);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [leadId, setLeadId] = useState<string | null>(isNew ? null : id || null);
  const [originalLead, setOriginalLead] = useState<Lead | null>(null);
  // Set by the realtime subscription when someone else saves this lead while it is open.
  // Deliberately does not touch `form` — that would wipe whatever is being typed.
  const [externalUpdateBy, setExternalUpdateBy] = useState<string | null>(null);
  // Other urgent leads in this one's area - the same notice the lead card shows.
  const nearbyUrgentLeads = useNearbyUrgentLeads(isNew ? null : originalLead);

  const [jobId, setJobId] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [lastEditedBy, setLastEditedBy] = useState("");
  const [lastEditedAt, setLastEditedAt] = useState("");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [cancelRequestOpen, setCancelRequestOpen] = useState(false);
  const [cancelRequestLoading, setCancelRequestLoading] = useState(false);
  const [adminCancelOpen, setAdminCancelOpen] = useState(false);
  const [adminCancelLoading, setAdminCancelLoading] = useState(false);
  const [urgentCheckOpen, setUrgentCheckOpen] = useState(false);
  // ?urgentCheck=1 opens the conversation review on arrival. The Chrome extension
  // links here when it withheld an urgent status, so the review starts without the
  // CS member having to find the status dropdown. Set once per link click, so a
  // refetch while the dialog is open cannot reopen it.
  const urgentCheckHandled = useRef(false);
  const urgentCheckRequested = searchParams.get("urgentCheck") === "1";
  const [cancelReviewLoading, setCancelReviewLoading] = useState(false);
  const [pendingCancellationRequest, setPendingCancellationRequest] = useState<LeadCancellationRequest | null>(null);

  const [photos, setPhotos] = useState<ExistingPhoto[]>([]);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showAllPhotos, setShowAllPhotos] = useState(false);

  const [csOpen, setCsOpen] = useState(true);
  const [processorOpen, setProcessorOpen] = useState(role !== "customer_service");
  const [scheduleOpen, setScheduleOpen] = useState(true);

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    customer_landline: "",
    number_name: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    service_type: "",
    status: "waiting_complete_details" as LeadStatus,
    scheduled_date: "",
    expected_completion_date: "",
    start_hour: "12",
    start_minute: "00",
    start_ampm: "AM",
    end_hour: "2",
    end_minute: "00",
    end_ampm: "PM",

    quote: "",
    service_details: "",
    customer_schedule_requirements: "",
    reference_name: "",
    cs_notes: "",
    processor_notes: "",
    general_notes: "",

    tech_name: "",
    tech_number: "",
    terms: "" as "" | "free_estimate" | "quoted",
    labor_amount: "",
    material_amount: "",
    for_you_amount: "",
    for_us_amount: "",

    amount: "",
    payment_screenshot_url: "",
  });

  const duplicateCheckId = isNew ? undefined : leadId || undefined;
  const { isDuplicate, duplicateLeadName } = useDuplicatePhoneCheck(form.customer_phone, duplicateCheckId);

  const fieldClass =
    "crm-lead-card-inner border-border/65 bg-transparent text-foreground shadow-[0_18px_30px_-24px_rgba(59,130,246,0.12)] placeholder:text-muted-foreground/65 focus-visible:border-primary/35 focus-visible:bg-[hsl(var(--background)/0.96)] dark:shadow-none";
  const labelClass = "text-[12px] font-semibold tracking-[-0.01em] text-foreground/82";
  const sectionClass =
    "glass-panel rounded-[26px] border border-border/65 p-5 shadow-[0_26px_54px_-34px_rgba(59,130,246,0.18)] space-y-4 dark:shadow-none";
  const collapsibleShellClass =
    "glass-panel rounded-[24px] border border-border/60 px-4 py-4 text-left transition-all duration-200 hover:border-primary/18 hover:shadow-[0_22px_40px_-28px_rgba(59,130,246,0.14)] dark:shadow-none";

  const fetchProfilesAndMeta = async (lead: Lead) => {
    if (lead.created_by) {
      const { data: creator } = await supabase.from("profiles_public" as never).select("full_name").eq("id", lead.created_by).maybeSingle();
      setCreatedBy((creator as { full_name?: string } | null)?.full_name || lead.created_by_name || "Unknown");
    } else {
      setCreatedBy(lead.created_by_name || "Unknown");
    }

    if (lead.last_edited_by) {
      const { data: editor } = await supabase
        .from("profiles_public" as never)
        .select("full_name")
        .eq("id", lead.last_edited_by)
        .maybeSingle();
      setLastEditedBy((editor as { full_name?: string } | null)?.full_name || lead.last_edited_by_name || "Unknown");
    } else if (lead.last_edited_by_name) {
      setLastEditedBy(lead.last_edited_by_name);
    } else {
      setLastEditedBy("");
    }

    setLastEditedAt(lead.updated_at || "");
  };

  const setFormFromLead = (lead: Lead) => {
    const parseTimeParts = (time?: string | null, fallbackHour = "12", fallbackMinute = "00", fallbackAmpm = "AM") => {
      if (!time) {
        return { hour: fallbackHour, minute: fallbackMinute, ampm: fallbackAmpm };
      }

      const [rawHour, minute] = time.split(":");
      let hourNum = parseInt(rawHour, 10);
      const ampm = hourNum >= 12 ? "PM" : "AM";
      hourNum = hourNum % 12 || 12;

      return {
        hour: String(hourNum),
        minute: minute || "00",
        ampm,
      };
    };

    const start = parseTimeParts(lead.scheduled_time_start, "12", "00", "AM");
    const end = parseTimeParts(lead.scheduled_time_end, "2", "00", "PM");

    setForm({
      customer_name: lead.customer_name || "",
      customer_phone: lead.customer_phone ? formatUSPhone(lead.customer_phone) : "",
      customer_email: lead.customer_email || "",
      customer_landline: lead.customer_landline ? formatUSPhone(lead.customer_landline) : "",
      number_name: lead.number_name || "",
      address: lead.address || "",
      city: lead.city || "",
      state: lead.state || "",
      zip_code: lead.zip_code || "",
      service_type: lead.service_type || "",
      status: (lead.status || "waiting_complete_details") as LeadStatus,
      scheduled_date: lead.scheduled_date || "",
      expected_completion_date: lead.expected_completion_date || "",
      start_hour: start.hour,
      start_minute: start.minute,
      start_ampm: start.ampm,
      end_hour: end.hour,
      end_minute: end.minute,
      end_ampm: end.ampm,

      quote: lead.quote || "",
      service_details: lead.service_details || "",
      customer_schedule_requirements: lead.customer_schedule_requirements || "",
      reference_name: lead.reference_name || "",
      // Notes live in the lead_notes thread system. These form fields only seed the
      // initial-note inputs shown while creating a lead, so they always start empty.
      cs_notes: "",
      processor_notes: "",
      general_notes: "",

      tech_name: lead.tech_name || "",
      tech_number: lead.tech_number ? formatUSPhone(lead.tech_number) : "",
      terms: lead.terms || "",
      labor_amount: lead.labor_amount != null ? String(lead.labor_amount) : "",
      material_amount: lead.material_amount != null ? String(lead.material_amount) : "",
      for_you_amount: lead.for_you_amount != null ? String(lead.for_you_amount) : "",
      for_us_amount: lead.for_us_amount != null ? String(lead.for_us_amount) : "",

      amount: lead.amount != null ? String(lead.amount) : "",
      payment_screenshot_url: lead.payment_screenshot_url || "",
    });
  };

  const fetchLead = useCallback(async () => {
    if (!id || isNew) return;

    setLoading(true);

    const { data: lead, error } = await supabase.from("leads").select("*").eq("id", id).single();

    if (error || !lead) {
      toast.error("Lead not found");
      navigate("/leads");
      return;
    }

    setLeadId(lead.id);
    setExternalUpdateBy(null);
    const typedLead = { ...lead, status: lead.status as LeadStatus } as Lead;
    setOriginalLead(typedLead);
    setJobId(lead.job_id);
    setFormFromLead(typedLead);
    await fetchProfilesAndMeta(typedLead);
    setLoading(false);
  }, [id, isNew, navigate]);

  const fetchPhotos = async (currentLeadId: string) => {
    const { data } = await supabase
      .from("lead_photos")
      .select("id, photo_url")
      .eq("lead_id", currentLeadId)
      .order("created_at", { ascending: true });

    if (data) {
      const { getSignedUrls } = await import("@/lib/storage");
      const rows = data as Array<{ id: string; photo_url: string }>;
      const paths = rows.map((p) => p.photo_url);
      // Only load preview thumbnails up front. Originals are lazy-loaded
      // when the user opens the lightbox to slash storage egress.
      const previewUrls = await getSignedUrls(paths, { width: 240, height: 240, resize: "cover", quality: 50 });
      setPhotos(
        rows.map((p, i) => ({
          id: p.id,
          previewUrl: previewUrls[i],
          path: p.photo_url,
        })),
      );
    } else {
      setPhotos([]);
    }
  };

  // Lazy-load full-resolution signed URLs only when the lightbox opens.
  const loadPhotoOriginals = async () => {
    const missing = photos.filter((p) => !p.originalUrl);
    if (missing.length === 0) return;
    const { getSignedUrls } = await import("@/lib/storage");
    const urls = await getSignedUrls(missing.map((p) => p.path));
    setPhotos((prev) =>
      prev.map((p) => {
        const idx = missing.findIndex((m) => m.id === p.id);
        if (idx === -1) return p;
        return { ...p, originalUrl: urls[idx] };
      }),
    );
  };

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
    void loadPhotoOriginals();
  };

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      setJobId(generateJobId());
      return;
    }
    fetchLead();
  }, [fetchLead, id, isNew]);

  useEffect(() => {
    if (leadId) {
      void fetchPhotos(leadId);
    }
  }, [leadId]);

  // Realtime for this one lead only: the filter keeps the server from sending us every other
  // lead's changes, so an open detail page costs one row-scoped subscription and no polling.
  useEffect(() => {
    if (!leadId || isNew) return;

    const channel = supabase
      .channel(`lead-detail:${leadId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads", filter: `id=eq.${leadId}` },
        (payload) => {
          const row = payload.new as Lead | undefined;
          if (!row) return;
          // Our own save echoes back — no point telling the user their edit landed.
          if (row.last_edited_by && row.last_edited_by === user?.id) return;
          setExternalUpdateBy(row.last_edited_by_name || "Someone");
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "leads", filter: `id=eq.${leadId}` },
        () => {
          toast.error("This lead was deleted");
          navigate("/leads");
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [leadId, isNew, user?.id, navigate]);

  const refreshPendingCancellationRequest = useCallback(async () => {
    if (!leadId) {
      setPendingCancellationRequest(null);
      return;
    }
    const request = await fetchPendingCancellationRequest(leadId);
    setPendingCancellationRequest(request);
  }, [leadId]);

  useEffect(() => {
    void refreshPendingCancellationRequest();
  }, [refreshPendingCancellationRequest, form.status]);



  useEffect(() => {
    setShowAllPhotos(false);
  }, [leadId]);

  const clearUrgentCheckParam = () => {
    if (searchParams.get("urgentCheck") === null) return;
    const next = new URLSearchParams(searchParams);
    next.delete("urgentCheck");
    setSearchParams(next, { replace: true });
  };

  const handleUrgentCheckOpenChange = (open: boolean) => {
    setUrgentCheckOpen(open);
    // Dropped on close, so a refresh or a back-navigation does not re-run a
    // review that has already been answered.
    if (!open) clearUrgentCheckParam();
  };

  // Opens the review for a deep link, once the record has loaded. Runs after the
  // dialog has content to read, and never before the caller has been asked, so it
  // is gated on the same role rule as the status dropdown.
  useEffect(() => {
    if (!urgentCheckRequested || urgentCheckHandled.current) return;
    if (isNew || !originalLead) return;
    urgentCheckHandled.current = true;

    if (originalLead.status === "urgent_job" || !showsUrgentCheck(role)) {
      // Nothing to review: already urgent, or this role is never asked.
      clearUrgentCheckParam();
      return;
    }

    setUrgentCheckOpen(true);
  }, [urgentCheckRequested, isNew, originalLead, role]);

  const update = (key: string, value: string) => {
    if (key === "status" && value === "urgent_job" && leadId && showsUrgentCheck(role)) {
      setUrgentCheckOpen(true);
      return;
    }

    if (key === "customer_phone" || key === "customer_landline" || key === "tech_number") {
      setForm((prev) => ({ ...prev, [key]: formatUSPhone(value) }));
      return;
    }

    if (key === "status" && value === "paid") {
      setPaymentOpen(true);
      return;
    }

    if (key === "status" && value === "cancelled") {
      if (isAdmin) {
        setAdminCancelOpen(true);
      } else if (canCreateCancellationRequest(role)) {
        setCancelRequestOpen(true);
      } else {
        toast.error("You do not have permission to request cancellation");
      }
      return;
    }

    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const parseTime = (hour: string, minute: string, ampm: string) => {
    let h = parseInt(hour, 10);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${minute}`;
  };

  const parseAmount = (val?: string | number | null): number | null => {
    if (val === null || val === undefined || val === "") return null;
    if (typeof val === "number") return isNaN(val) ? null : val;
    const cleaned = String(val).replace(/[^0-9.-]+/g, "");
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  };

  const handlePhotoAdd = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setNewPhotos((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeNewPhoto = (index: number) => {
    setNewPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingPhoto = async (photoId: string) => {
    const photo = photos.find((item) => item.id === photoId);

    await supabase.from("lead_photos").delete().eq("id", photoId);

    if (photo?.path) {
      await supabase.storage.from("lead-photos").remove([photo.path]);
    }

    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  const handlePaymentConfirm = async (amount: number, screenshotFile: File | null) => {
    if (!leadId || !user) {
      toast.error("Save the lead first before recording payment");
      setPaymentOpen(false);
      return;
    }

    setPaymentLoading(true);
    try {
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

      await updateLeadById(leadId, {
        status: "paid",
        amount,
        payment_amount: amount,
        payment_screenshot_url: screenshotUrl,
        last_edited_by: user.id,
        last_edited_by_name: profile?.full_name || user.email || "Unknown user",
        updated_at: new Date().toISOString(),
        last_edited_at: new Date().toISOString(),
      });

      setPaymentOpen(false);
      setForm((prev) => ({
        ...prev,
        status: "paid",
        amount: String(amount),
        payment_screenshot_url: screenshotUrl || prev.payment_screenshot_url,
      }));

      await fetchLead();
      toast.success("Payment recorded & status updated to Paid");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentLoading(false);
    }
  };

  const uploadNewPhotos = async (currentLeadId: string) => {
    const currentUserName = profile?.full_name || user?.email || "Unknown user";
    for (const photo of newPhotos) {
      const optimizedPhoto = await optimizeImageForUpload(photo);
      const ext = optimizedPhoto.name.split(".").pop();
      const path = `leads/${currentLeadId}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("lead-photos").upload(path, optimizedPhoto);

      if (!uploadErr) {
        await supabase.from("lead_photos").insert({
          lead_id: currentLeadId,
          photo_url: path,
          uploaded_by: user!.id,
          uploaded_by_name: currentUserName,
        });
      }
    }

    setNewPhotos([]);
    await fetchPhotos(currentLeadId);
  };

  const insertInitialNotes = async (currentLeadId: string) => {
    if (!user) return;

    const currentUserName = profile?.full_name || user.email || "Unknown user";
    const noteInserts: { lead_id: string; user_id: string; user_name: string; note_type: "cs" | "processor" | "general"; content: string }[] = [];

    if ((!isProcessor || form.status === "activate_customer") && form.cs_notes.trim()) {
      noteInserts.push({
        lead_id: currentLeadId,
        user_id: user.id,
        user_name: currentUserName,
        note_type: "cs",
        content: form.cs_notes.trim(),
      });
    }

    if (!hideProcessorDetails && form.processor_notes.trim()) {
      noteInserts.push({
        lead_id: currentLeadId,
        user_id: user.id,
        user_name: currentUserName,
        note_type: "processor",
        content: form.processor_notes.trim(),
      });
    }

    if (form.general_notes.trim()) {
      noteInserts.push({
        lead_id: currentLeadId,
        user_id: user.id,
        user_name: currentUserName,
        note_type: "general",
        content: form.general_notes.trim(),
      });
    }

    if (noteInserts.length > 0) {
      await supabase.from("lead_notes").insert(noteInserts);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (isOpr) {
      toast.error("Operators cannot edit leads");
      return;
    }

    if (!form.customer_name.trim()) {
      toast.error("Customer Name is required");
      return;
    }

    // A cell phone or a landline - either one is enough.
    if (!hasContactNumber(form.customer_phone, form.customer_landline)) {
      toast.error("Enter a cell phone or a landline");
      return;
    }

    if (!form.number_name.trim()) {
      toast.error("Number Name is required");
      return;
    }

    if (isDuplicate) {
      toast.error(`A lead with this phone number already exists (${duplicateLeadName})`);
      return;
    }
    if (!canChangeStatus(role, form.status)) {
      toast.error("You do not have permission to set that status");
      return;
    }

    if (form.status === "cancelled" && !isAdmin) {
      toast.error("Please send a cancellation request instead of cancelling directly");
      return;
    }

    setSaving(true);
    const currentUserName = profile?.full_name || user.email || "Unknown user";
    const quoteApprovalRequested =
      role === "customer_service" &&
      form.status === "pending_to_send" &&
      (isNew || originalLead?.status !== "pending_to_send");
    const urgentVerificationRequested =
      form.status === "urgent_job" && showsUrgentCheck(role) &&
      (isNew || originalLead?.status !== "urgent_job");
    const savedStatus: LeadStatus = urgentVerificationRequested
      ? (isNew ? "waiting_complete_details" : originalLead?.status ?? "waiting_complete_details")
      : quoteApprovalRequested
      ? (originalLead?.status ?? "waiting_complete_details")
      : form.status;

    let scheduled_time_start: string | null = null;
    let scheduled_time_end: string | null = null;

    if (form.scheduled_date) {
      scheduled_time_start = parseTime(form.start_hour, form.start_minute, form.start_ampm);
      scheduled_time_end = parseTime(form.end_hour, form.end_minute, form.end_ampm);
    }

    let addressLatitude = originalLead?.latitude ?? null;
    let addressLongitude = originalLead?.longitude ?? null;
    let addressCity = form.city || null;
    let addressState = form.state || null;
    let addressZip = form.zip_code || null;
    const addressChanged = isNew
      || form.address.trim() !== (originalLead?.address ?? "").trim()
      || originalLead?.latitude == null
      || originalLead?.longitude == null;
    if (addressChanged) {
      addressLatitude = null;
      addressLongitude = null;
      addressCity = null;
      addressState = null;
      addressZip = null;
    }

    const payload = {
      customer_name: form.customer_name,
      customer_phone: form.customer_phone || "",
      customer_email: form.customer_email || null,
      ...(form.customer_landline || originalLead?.customer_landline
        ? { customer_landline: form.customer_landline || null }
        : {}),
      number_name: form.number_name || null,
      address: form.address || null,
      city: addressCity,
      state: addressState,
      zip_code: addressZip,
      latitude: addressLatitude,
      longitude: addressLongitude,
      service_type: form.service_type || null,
      status: savedStatus,
      scheduled_date: form.scheduled_date || null,
      scheduled_time_start,
      scheduled_time_end,
      expected_completion_date: form.expected_completion_date || null,

      quote: form.quote || null,
      service_details: form.service_details || null,
      customer_schedule_requirements: form.customer_schedule_requirements || null,
      reference_name: form.reference_name || null,

      tech_name: !hideProcessorDetails ? form.tech_name || null : (originalLead?.tech_name ?? null),
      tech_number: !hideProcessorDetails ? form.tech_number || null : (originalLead?.tech_number ?? null),
      terms: !hideProcessorDetails ? form.terms || null : (originalLead?.terms ?? null),
      labor_amount:
        !hideProcessorDetails
          ? parseAmount(form.labor_amount)
          : (originalLead?.labor_amount ?? null),
      material_amount:
        !hideProcessorDetails
          ? parseAmount(form.material_amount)
          : (originalLead?.material_amount ?? null),
      for_you_amount:
        !hideProcessorDetails
          ? parseAmount(form.for_you_amount)
          : (originalLead?.for_you_amount ?? null),
      for_us_amount:
        !hideProcessorDetails
          ? parseAmount(form.for_us_amount)
          : (originalLead?.for_us_amount ?? null),

      last_edited_by: user.id,
      last_edited_by_name: currentUserName,
      updated_at: new Date().toISOString(),
      last_edited_at: new Date().toISOString(),
    };

    if (form.status === "cancelled") {
      (payload as Record<string, unknown>).cancellation_reason = null;
    }

    try {
      if (isNew) {
        const insertData = {
          ...payload,
          job_id: jobId || generateJobId(),
          created_by: user.id,
          created_by_name: currentUserName,
          assigned_cs: isCS ? user.id : null,
          // Manual CRM entry. The Chrome extension leaves this false, and RLS
          // only lets a CS through when Settings granted Manual Lead Addition.
          manual_entry: true,
        };

        const { data, error } = await supabase.from("leads").insert(insertData).select().single();

        if (error) throw error;

        const newLeadId = data.id;
        setLeadId(newLeadId);
        setOriginalLead(data as Lead);
        void geocodeAndPersistLeadAddress(newLeadId, form.address).then(async (updated) => {
          if (!updated) return;
          const { data: refreshedLead } = await supabase.from("leads").select("*").eq("id", newLeadId).maybeSingle();
          if (refreshedLead) setOriginalLead(refreshedLead as Lead);
        });

        // The coverage trigger stores its result in a follow-up UPDATE. The
        // INSERT ... RETURNING payload can therefore contain the pre-trigger
        // NULL coverage fields; read the stored result once so a lead created
        // here shows its badge immediately without requiring a page refresh.
        const { data: storedCoverage } = await supabase
          .from("leads")
          .select("coverage_level, coverage_tech_count, coverage_area_label")
          .eq("id", newLeadId)
          .maybeSingle();
        if (storedCoverage) {
          const coveragePatch = storedCoverage as Partial<Lead>;
          setOriginalLead((previous) => previous
            ? { ...previous, ...coveragePatch }
            : previous);
        }

        if (urgentVerificationRequested) {
          setForm((previous) => ({ ...previous, status: savedStatus }));
        }

        let quoteApprovalSucceeded = false;
        if (quoteApprovalRequested) {
          try {
            await requestQuoteApproval({
              lead: {
                id: newLeadId,
                job_id: data.job_id,
                customer_name: data.customer_name,
                status: savedStatus,
              },
              requesterId: user.id,
            });
            quoteApprovalSucceeded = true;
          } catch (approvalError) {
            toast.error(
              approvalError instanceof Error
                ? `Lead created, but approval request failed: ${approvalError.message}`
                : "Lead created, but approval request failed",
            );
          }
        }

        await insertInitialNotes(newLeadId);

        if (newPhotos.length > 0) {
          try {
            await uploadNewPhotos(newLeadId);
          } catch (photoErr) {
            console.warn("Failed to upload new photos for lead:", photoErr);
          }
        }

        try {
          await dispatchLeadStatusNotification({
            leadId: newLeadId,
            leadName: form.customer_name,
            status: savedStatus,
            expectedCompletionDate: form.expected_completion_date,
          });
        } catch (notifErr) {
          console.warn("Notification dispatch failed:", notifErr);
        }

        try {
          await logActivity(user.id, "created", "lead", newLeadId, { customer_name: form.customer_name });
        } catch (actErr) {
          console.warn("Activity logging failed:", actErr);
        }

        if (quoteApprovalSucceeded) {
          toast.success("Lead created and quote sent for approval");
        } else if (!quoteApprovalRequested) {
          toast.success("Lead created!");
        }

        navigate(`/leads/${newLeadId}`, { replace: true });
        setSaving(false);
        if (urgentVerificationRequested) setUrgentCheckOpen(true);
        return;
      }

      if (!leadId) throw new Error("Missing lead id");

      const previousStatus = originalLead?.status;
      const updatePayload: Record<string, unknown> = { ...payload };
      if (form.status === "paid" && form.amount) {
        updatePayload.amount = parseAmount(form.amount);
      }
      if (previousStatus !== savedStatus) {
        updatePayload.cs_tag = null;
      }

      try {
        await updateLeadById(leadId, updatePayload);
      } catch (saveErr: unknown) {
        const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
        if (msg.includes("expected_completion_date")) {
          const { expected_completion_date: _, ...fallbackPayload } = updatePayload;
          await updateLeadById(leadId, fallbackPayload);
        } else {
          throw saveErr;
        }
      }

      if (addressChanged && form.address.trim()) {
        void geocodeAndPersistLeadAddress(leadId, form.address).then(async (updated) => {
          if (!updated) return;
          const { data: refreshedLead } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
          if (refreshedLead) setOriginalLead(refreshedLead as Lead);
        });
      }

      if (quoteApprovalRequested && previousStatus) {
        await requestQuoteApproval({
          lead: {
            id: leadId,
            job_id: originalLead?.job_id || jobId || leadId,
            customer_name: form.customer_name,
            status: previousStatus,
          },
          requesterId: user.id,
        });
      }

      if (newPhotos.length > 0) {
        try {
          await uploadNewPhotos(leadId);
        } catch (photoErr) {
          console.error("Failed to upload new photos:", photoErr);
          toast.error("Lead updated, but some photos failed to upload.");
        }
      }

      if (
        (previousStatus !== savedStatus && (savedStatus === "urgent_job" || savedStatus === "need_tech" || savedStatus === "job_in_progress")) ||
        (savedStatus === "job_in_progress" && originalLead?.expected_completion_date !== form.expected_completion_date && form.expected_completion_date)
      ) {
        try {
          await dispatchLeadStatusNotification({
            leadId: leadId,
            leadName: form.customer_name,
            status: savedStatus,
            expectedCompletionDate: form.expected_completion_date,
          });
        } catch (notifErr) {
          console.warn("Failed to dispatch notifications:", notifErr);
        }
      }

      try {
        const changedDetails: Record<string, unknown> = { customer_name: form.customer_name };
        if (previousStatus && previousStatus !== savedStatus) {
          changedDetails.status_from = LEAD_STATUS_CONFIG[previousStatus]?.label || previousStatus;
          changedDetails.status_to = LEAD_STATUS_CONFIG[savedStatus]?.label || savedStatus;
        }
        await logActivity(user.id, "updated", "lead", leadId, changedDetails);
      } catch (actErr) {
        console.warn("Failed to log activity:", actErr);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      await fetchLead();
      toast.success(quoteApprovalRequested ? "Lead updated and quote sent for approval" : "Lead updated!");
    } catch (err: unknown) {
      console.error("Failed to save lead:", err);
      const message = err instanceof Error ? err.message : "Failed to save lead";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancellationRequestSubmit = async (comment: string, proof: string, proofImage: File | null, aiReasonCode?: string, aiReasonApplied?: boolean, aiSuggestedReason?: string) => {
    if (!user || !originalLead) return;

    setCancelRequestLoading(true);
    try {
      await createCancellationRequest({
        lead: originalLead,
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
      await refreshPendingCancellationRequest();
      await fetchLead();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to request cancellation");
    } finally {
      setCancelRequestLoading(false);
    }
  };

  const handleAdminCancelSubmit = async (comment: string, proof: string, proofImage: File | null, aiReasonCode?: string, aiReasonApplied?: boolean) => {
    if (!user || !leadId) return;

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

      await updateLeadById(leadId, {
          status: "cancelled",
          cancellation_reason: reason,
          cs_tag: null,
          last_edited_by: user.id,
          last_edited_by_name: profile?.full_name || user.email || "Unknown user",
          updated_at: new Date().toISOString(),
          last_edited_at: new Date().toISOString(),
        });

      await logActivity(user.id, "status_changed", "lead", leadId, {
        target_name: jobId,
        customer_name: form.customer_name,
        job_id: jobId,
        status_from: originalLead?.status,
        status_to: "cancelled",
        cancellation_reason: reason,
      });

      toast.success("Lead cancelled");
      setAdminCancelOpen(false);
      await fetchLead();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel lead");
    } finally {
      setAdminCancelLoading(false);
    }
  };

  const handleCancellationReview = async (action: "approved" | "rejected") => {
    if (!user || !originalLead || !pendingCancellationRequest) return;

    setCancelReviewLoading(true);
    try {
      await reviewCancellationRequest({
        request: pendingCancellationRequest,
        lead: originalLead,
        reviewerId: user.id,
        reviewerName: profile?.full_name || user.email || "Unknown user",
        reviewerRole: role,
        action,
      });
      toast.success(action === "approved" ? "Lead cancelled" : "Cancellation request rejected");
      await refreshPendingCancellationRequest();
      await fetchLead();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to review cancellation request");
    } finally {
      setCancelReviewLoading(false);
    }
  };

  const currentCopyLead = useMemo(() => {
    if (isNew || !leadId) return null;

    return {
      ...(originalLead || {}),
      id: leadId,
      job_id: jobId,
      customer_name: form.customer_name,
      customer_phone: form.customer_phone || null,
      customer_email: form.customer_email || null,
      customer_landline: form.customer_landline || null,
      number_name: form.number_name || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      zip_code: form.zip_code || null,
      service_type: form.service_type || null,
      status: form.status,
      scheduled_date: form.scheduled_date || null,
      scheduled_time_start: form.scheduled_date ? parseTime(form.start_hour, form.start_minute, form.start_ampm) : null,
      scheduled_time_end: form.scheduled_date ? parseTime(form.end_hour, form.end_minute, form.end_ampm) : null,
      expected_completion_date: form.expected_completion_date || null,
      quote: form.quote || null,
      service_details: form.service_details || null,
      customer_schedule_requirements: form.customer_schedule_requirements || null,
      reference_name: form.reference_name || null,
      tech_name: form.tech_name || null,
      tech_number: form.tech_number || null,
      terms: form.terms || null,
      labor_amount: form.labor_amount ? parseFloat(form.labor_amount) : null,
      material_amount: form.material_amount ? parseFloat(form.material_amount) : null,
      for_you_amount: form.for_you_amount ? parseFloat(form.for_you_amount) : null,
      for_us_amount: form.for_us_amount ? parseFloat(form.for_us_amount) : null,
      created_by: originalLead?.created_by || user?.id || null,
      created_by_name: originalLead?.created_by_name || profile?.full_name || user?.email || null,
      created_at: originalLead?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_edited_by: user?.id || originalLead?.last_edited_by || null,
      last_edited_by_name: profile?.full_name || user?.email || originalLead?.last_edited_by_name || null,
      payment_screenshot_url: form.payment_screenshot_url || null,
      amount: form.amount ? parseFloat(form.amount) : null,
      payment_amount: form.amount ? parseFloat(form.amount) : null,
    } as Lead;
  }, [originalLead, form, isNew, leadId, jobId, user, profile]);

  const newPhotoUrls = useMemo(() => newPhotos.map((p) => URL.createObjectURL(p)), [newPhotos]);

  useEffect(() => {
    return () => {
      newPhotoUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [newPhotoUrls]);

  const allImageUrls: Array<{ src: string; fallback?: string }> = [
    ...photos.map((p) => ({
      src: p.originalUrl ?? p.previewUrl,
      fallback: p.previewUrl,
    })),
    ...newPhotoUrls.map((url) => ({ src: url })),
  ];
  const displayedPhotos = showAllPhotos ? photos : photos.slice(0, PHOTO_PREVIEW_LIMIT);
  const hiddenPhotoCount = Math.max(photos.length - displayedPhotos.length, 0);
  const visiblePhotoCount = photos.length + newPhotos.length;
  const scheduleSummary = form.scheduled_date
    ? `${new Date(form.scheduled_date).toLocaleDateString()}${
        form.start_hour && form.end_hour ? ` · ${form.start_hour}:${form.start_minute} ${form.start_ampm} - ${form.end_hour}:${form.end_minute} ${form.end_ampm}` : ""
      }`
    : "Not scheduled yet";

  const jobCompletionState = useMemo(() => {
    if (form.status !== "job_in_progress" || !form.expected_completion_date) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (form.expected_completion_date < today) return "overdue";
    if (form.expected_completion_date === today) return "due_today";
    return "on_track";
  }, [form.status, form.expected_completion_date]);

  const TimePicker = ({ prefix, label }: { prefix: "start" | "end"; label: string }) => (
    <div className="space-y-1.5">
      <Label className={labelClass}>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={form[`${prefix}_hour` as keyof typeof form]} onValueChange={(v) => update(`${prefix}_hour`, v)}>
          <SelectTrigger className="h-10 w-[72px] border-border/60 bg-background/90">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-muted-foreground/50">:</span>

        <Select
          value={form[`${prefix}_minute` as keyof typeof form]}
          onValueChange={(v) => update(`${prefix}_minute`, v)}
        >
          <SelectTrigger className="h-10 w-[72px] border-border/60 bg-background/90">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["00", "15", "30", "45"].map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={form[`${prefix}_ampm` as keyof typeof form]} onValueChange={(v) => update(`${prefix}_ampm`, v)}>
          <SelectTrigger className="h-10 w-[76px] border-border/60 bg-background/90">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="glass-panel rounded-2xl px-5 py-4 text-sm text-muted-foreground dark:bg-[linear-gradient(180deg,hsl(var(--card)/0.94),hsl(var(--muted)/0.30))]">
          Loading lead details...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {externalUpdateBy && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/50 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {externalUpdateBy} updated this lead. Your unsaved changes are untouched — reload to see theirs.
          </span>
          <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => void fetchLead()}>
            Reload
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setExternalUpdateBy(null)}
            className="rounded-lg p-1 text-amber-900/70 transition-colors hover:bg-amber-400/20 dark:text-amber-100/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: premiumEase }}
        className="overflow-hidden rounded-[30px] border border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_26%),linear-gradient(180deg,hsl(var(--card)),hsl(var(--muted)/0.18))] shadow-[0_26px_70px_-40px_rgba(0,0,0,0.48)]"
      >
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate("/leads")} className="mt-1 shrink-0 rounded-xl" aria-label="Back to leads">
                <ArrowLeft className="h-5 w-5" />
              </Button>

              <motion.div variants={heroTitle} initial="initial" animate="animate" className="min-w-0">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  {isNew ? "Lead Creation" : "Lead Detail"}
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">
                  {isNew ? "New Lead" : form.customer_name || "Lead"}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {jobId && <p className="font-mono text-[13px] text-muted-foreground">{jobId}</p>}
                  {leadId && !isNew ? (
                    <CancelledStatusBadge leadId={leadId} status={form.status} size="md" />
                  ) : (
                    <StatusBadge status={form.status} />
                  )}
                  {!isNew && originalLead && (
                    <LeadCoverageBadge
                      level={originalLead.coverage_level}
                      count={originalLead.coverage_tech_count}
                      areaLabel={originalLead.coverage_area_label}
                    />
                  )}
                  {!isNew && hasQuickChatAccess && originalLead?.customer_phone && (
                    <QuoPhoneTrigger
                      contactName={originalLead.customer_name || "Lead"}
                      phone={originalLead.customer_phone}
                      chatType="customer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary no-underline shadow-sm transition-all hover:bg-primary/20"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>CX Quick Chat</span>
                    </QuoPhoneTrigger>
                  )}
                  {!isNew && hasTechQuickChatAccess && originalLead?.tech_number && (
                    <QuoPhoneTrigger
                      contactName={originalLead.tech_name || "Technician"}
                      phone={originalLead.tech_number}
                      chatType="tech"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold text-amber-700 no-underline shadow-sm transition-all hover:bg-amber-500/22 dark:text-amber-300"
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      <span>Tech Quick Chat</span>
                    </QuoPhoneTrigger>
                  )}
                </div>
                <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted-foreground">
                  Keep customer intake, processor notes, schedule details, and photos organized in one readable workspace.
                </p>
                {nearbyUrgentLeads.length > 0 && (
                  <div className="max-w-md">
                    <NearbyUrgentLeads nearby={nearbyUrgentLeads} />
                  </div>
                )}
              </motion.div>
            </div>

            {!isOpr && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleSave} disabled={saving || isDuplicate} className="gap-2">
                  {saved ? (
                    <>
                      <Check className="h-4 w-4" /> Saved
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" /> {saving ? "Saving..." : isNew ? "Create Lead" : "Save Lead"}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-3 border-t border-border/50 pt-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="crm-lead-card-inner rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                Contact
              </div>
              {form.customer_phone ? (
                <QuoPhoneTrigger contactName={form.customer_name || "Lead"} phone={form.customer_phone} chatType="customer" className="mt-2 text-sm font-semibold">
                  {form.customer_phone}
                </QuoPhoneTrigger>
              ) : !form.customer_landline ? (
                <p className="mt-2 text-sm font-semibold text-foreground">Phone pending</p>
              ) : null}
              {form.customer_landline && (
                <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <span className="rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Landline
                  </span>
                  <a href={`tel:${form.customer_landline}`} className="hover:underline">
                    {form.customer_landline}
                  </a>
                </p>
              )}
            </div>
            <div className="crm-lead-card-inner rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Service
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{form.service_type || "Service not set"}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{form.address || "Address not entered yet"}</p>
            </div>
            <div className="crm-lead-card-inner rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Schedule
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{scheduleSummary}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {form.status === "scheduled" ? "Job is scheduled." : "Use status and timing to guide the handoff."}
              </p>
            </div>
            <div className="crm-lead-card-inner rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <BadgeDollarSign className="h-3.5 w-3.5" />
                Activity
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {isNew ? "Draft lead" : `Created by ${createdBy || "Unknown"}`}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {lastEditedBy && lastEditedAt
                  ? `Last updated by ${lastEditedBy} on ${new Date(lastEditedAt).toLocaleString()}`
                  : `${visiblePhotoCount} photo${visiblePhotoCount !== 1 ? "s" : ""} attached`}
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {!isNew && (
        <CancellationRequestPanel
          request={pendingCancellationRequest}
          role={role}
          loading={cancelReviewLoading}
          onApprove={() => handleCancellationReview("approved")}
          onReject={() => handleCancellationReview("rejected")}
        />
      )}

      <Card className="border-border/60 bg-card/95 shadow-[0_18px_42px_-30px_rgba(37,99,235,0.16)] dark:shadow-[0_22px_48px_-30px_rgba(0,0,0,0.48)]">
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className={sectionClass}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                Required Information
              </p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                Capture the essential customer identity details first so this lead is valid, searchable, and ready for follow-up.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className={labelClass}>Customer Name *</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => update("customer_name", e.target.value)}
                  className={fieldClass}
                  readOnly={isProcessor || isOpr}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Number Name *</Label>
                <NumberNameCombobox
                  value={form.number_name}
                  onChange={(value) => update("number_name", value)}
                  disabled={isProcessor || isOpr}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className={labelClass}>Cell Phone</Label>
                <Input
                  value={form.customer_phone}
                  onChange={(e) => update("customer_phone", e.target.value)}
                  maxLength={14}
                  className={`${fieldClass} ${isDuplicate ? "border-destructive ring-1 ring-destructive" : ""}`}
                  readOnly={isProcessor || isOpr}
                />
                {form.customer_phone && (
                  <QuoPhoneTrigger
                    contactName={form.customer_name || "Lead"}
                    phone={form.customer_phone}
                    className="mt-2 text-xs font-medium"
                  >
                    {form.customer_phone}
                  </QuoPhoneTrigger>
                )}
                {isDuplicate && (
                  <div className="flex items-center gap-1.5 text-destructive text-[11px] mt-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>
                      Duplicate: <strong>{duplicateLeadName}</strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Landline</Label>
                <Input
                  value={form.customer_landline}
                  onChange={(e) => update("customer_landline", e.target.value)}
                  maxLength={14}
                  className={fieldClass}
                  readOnly={isProcessor || isOpr}
                />
                <p className="text-[11px] text-muted-foreground">A cell phone or a landline is required.</p>
              </div>
            </div>
          </div>

          <Collapsible open={csOpen} onOpenChange={setCsOpen}>
            <CollapsibleTrigger className={collapsibleShellClass}>
              <SectionHeader
                icon={User}
                title="Customer Service Details"
                subtitle="Address, request details, customer expectations, and CS notes."
                open={csOpen}
              />
            </CollapsibleTrigger>

            <CollapsibleContent className="mt-3 space-y-4 px-1">
              <div className="space-y-1.5">
                <Label className={labelClass}>Address</Label>
                <Input
                  value={form.address}
                  onChange={(e) => update("address", e.target.value)}
                  placeholder="123 Main St, City, State, Zip"
                  className={fieldClass}
                  readOnly={isProcessor || isOpr}
                />
              </div>


              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className={labelClass}>Service Type</Label>
                  <ServiceCombobox
                    value={form.service_type || ""}
                    onChange={(val) => update("service_type", val)}
                    className={fieldClass}
                    disabled={isProcessor || isOpr}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Quote</Label>
                  <Input
                    value={form.quote}
                    onChange={(e) => update("quote", e.target.value)}
                    className={fieldClass}
                    readOnly={isProcessor || isOpr}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Service Details</Label>
                <Textarea
                  value={form.service_details}
                  onChange={(e) => update("service_details", e.target.value)}
                  rows={3}
                  className={`${fieldClass} resize-none min-h-[96px]`}
                  readOnly={isProcessor || isOpr}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Customer Schedule Requirements</Label>
                  <MultiDateTimePicker
                    value={form.customer_schedule_requirements}
                    onChange={(val) => update("customer_schedule_requirements", val)}
                    readOnly={isProcessor || isOpr}
                  />
                </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Reference</Label>
                <Input
                  value={form.reference_name}
                  onChange={(e) => update("reference_name", e.target.value)}
                  className={fieldClass}
                  readOnly={isProcessor || isOpr}
                />
              </div>

              {isNew ? (
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold text-foreground">CS Notes</Label>
                  <Textarea
                    value={form.cs_notes}
                    onChange={(e) => update("cs_notes", e.target.value)}
                    rows={4}
                    className={`${fieldClass} resize-none min-h-[110px]`}
                    readOnly={isProcessor || isOpr}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <Label className="text-[12px] font-semibold text-foreground">CS Notes</Label>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Customer service can update this thread. Processors can view it for context.
                    </p>
                  </div>
                  {leadId && <NoteThread leadId={leadId} noteType="cs" label="CS Notes" />}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          {!hideProcessorDetails && (
            <Collapsible open={processorOpen} onOpenChange={setProcessorOpen}>
              <CollapsibleTrigger className={collapsibleShellClass}>
                <SectionHeader
                  icon={Wrench}
                  title="Processor Details"
                  subtitle="Technician info, terms, pricing context, and processor notes."
                  open={processorOpen}
                />
              </CollapsibleTrigger>

              <CollapsibleContent className="mt-3 space-y-4 px-1">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className={labelClass}>Tech Name</Label>
                      <Input
                        value={form.tech_name}
                        onChange={(e) => update("tech_name", e.target.value)}
                        className={fieldClass}
                        readOnly={isOpr}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className={labelClass}>Tech Number</Label>
                    <Input
                      value={form.tech_number}
                      onChange={(e) => update("tech_number", e.target.value)}
                      maxLength={14}
                      className={fieldClass}
                      readOnly={isOpr}
                    />
                    {form.tech_number && (
                      <QuoPhoneTrigger
                        contactName={form.tech_name || "Technician"}
                        phone={form.tech_number}
                        chatType="tech"
                        className="mt-2 text-xs font-medium"
                      >
                        {form.tech_number}
                      </QuoPhoneTrigger>
                    )}
                  </div>
                  </div>

                  {currentCopyLead && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <CompleteLeadCopyButton lead={currentCopyLead} />
                      <ReminderButton
                        lead={currentCopyLead}
                        className="h-9 rounded-xl px-2.5 text-[10px]"
                      />
                      <CopyLeadButton
                        lead={currentCopyLead}
                        className="h-9 rounded-xl px-2.5 text-[10px]"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Terms</Label>
                  <Select value={form.terms} onValueChange={(v) => update("terms", v)} disabled={isOpr}>
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
                  <div className="crm-lead-card-soft rounded-[22px] p-4 space-y-3 shadow-[0_18px_28px_-24px_rgba(59,130,246,0.12)] dark:shadow-none">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                      Quoted Details
                    </p>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className={labelClass}>Customer Labor ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={form.labor_amount}
                          onChange={(e) => update("labor_amount", e.target.value)}
                          className={fieldClass}
                          readOnly={isOpr}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className={labelClass}>Materials ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={form.material_amount}
                          onChange={(e) => update("material_amount", e.target.value)}
                          className={fieldClass}
                          readOnly={isOpr}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className={labelClass}>For You ($ incl. material)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={form.for_you_amount}
                          onChange={(e) => update("for_you_amount", e.target.value)}
                          className={fieldClass}
                          readOnly={isOpr}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className={labelClass}>For Us ($ from labor)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={form.for_us_amount}
                          onChange={(e) => update("for_us_amount", e.target.value)}
                          className={fieldClass}
                          readOnly={isOpr}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {!isOpr && (
                  isNew ? (
                    <div className="space-y-1.5">
                      <Label className="text-[12px] font-semibold text-foreground">Processor Notes</Label>
                      <Textarea
                        value={form.processor_notes}
                        onChange={(e) => update("processor_notes", e.target.value)}
                        rows={4}
                        className={`${fieldClass} resize-none min-h-[110px]`}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <Label className="text-[12px] font-semibold text-foreground">Processor Notes</Label>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          This thread stays hidden from CS and is editable by processors and admins.
                        </p>
                      </div>
                      {leadId && <NoteThread leadId={leadId} noteType="processor" label="Processor Notes" />}
                    </div>
                  )
                )}
              </CollapsibleContent>
            </Collapsible>
          )}

          {!hideProcessorDetails && leadId && (
            <NearbyAreasList
              leadId={leadId}
              customerAddress={form.address ?? originalLead?.address ?? null}
              customerCity={form.city ?? originalLead?.city ?? null}
              customerState={form.state ?? originalLead?.state ?? null}
              customerZip={form.zip_code ?? originalLead?.zip_code ?? null}
              latitude={(originalLead as unknown as { latitude?: number | null } | null)?.latitude ?? null}
              longitude={(originalLead as unknown as { longitude?: number | null } | null)?.longitude ?? null}
              savedNearbyAreas={
                ((originalLead as unknown as { nearby_areas?: unknown } | null)?.nearby_areas as NearbyAreasData | null) ?? null
              }
              canManage={isAdmin || isProcessor}
            />
          )}

          <Collapsible open={scheduleOpen} onOpenChange={setScheduleOpen}>
            <CollapsibleTrigger className={collapsibleShellClass}>
              <SectionHeader
                icon={Calendar}
                title="Schedule & Status"
                subtitle="Control workflow stage, schedule timing, and payment state."
                open={scheduleOpen}
              />
            </CollapsibleTrigger>

            <CollapsibleContent className="mt-3 space-y-4 px-1">
              <div className="space-y-1.5">
                <Label className={labelClass}>Status</Label>
                <Select value={form.status} onValueChange={(v) => update("status", v)} disabled={isOpr}>
                  <SelectTrigger className={fieldClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getChangeableStatuses(role).map((key) => {
                      const cfg = LEAD_STATUS_CONFIG[key];
                      return cfg ? (
                        <SelectItem key={key} value={key}>
                          {cfg.label}
                        </SelectItem>
                      ) : null;
                    })}
                  </SelectContent>
                </Select>
              </div>

              {!isNew && originalLead && originalLead.status !== "scheduled" && (
                <div className="space-y-1.5">
                  <Label className={labelClass}>
                    Lead Tag <span className="font-normal normal-case tracking-normal text-muted-foreground">(saves immediately)</span>
                  </Label>
                  <LeadTagControl
                    lead={originalLead}
                    onSaved={(patch) => setOriginalLead((prev) => (prev ? { ...prev, ...patch } : prev))}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className={labelClass}>Job Scheduled For</Label>
                <Input
                  type="date"
                  value={form.scheduled_date}
                  onChange={(e) => update("scheduled_date", e.target.value)}
                  className={fieldClass}
                />
              </div>

              {form.scheduled_date && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <TimePicker prefix="start" label="Start Time" />
                  <TimePicker prefix="end" label="End Time" />
                </div>
              )}

              {(isAdmin || isProcessor) && (form.status === "job_in_progress" || form.expected_completion_date) && (
                <div className="space-y-2.5 rounded-2xl border border-sky-200/80 bg-sky-50/60 p-3.5 dark:border-sky-800/40 dark:bg-sky-950/20">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] font-semibold text-sky-950 dark:text-sky-200 flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
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
                        <Clock3 className="h-3 w-3" />
                        Due Today
                      </span>
                    )}
                  </div>
                  <Input
                    type="date"
                    value={form.expected_completion_date}
                    onChange={(e) => update("expected_completion_date", e.target.value)}
                    className={fieldClass}
                  />
                  {(isAdmin || isProcessor) && (jobCompletionState === "overdue" || jobCompletionState === "due_today") && (
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
                <div className="space-y-1.5">
                  <Label className={labelClass}>Amount ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => update("amount", e.target.value)}
                    className={fieldClass}
                  />
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          <div className={sectionClass}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">Photos</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                Add supporting images so the next teammate can understand the job without back-and-forth.
              </p>
            </div>

            <LeadPhotoActions paths={photos.map((photo) => photo.path)} techNumber={originalLead?.tech_number} />

            {photos.length > PHOTO_PREVIEW_LIMIT && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-muted/[0.12] px-3.5 py-2.5">
                <p className="text-[12px] text-muted-foreground">
                  Showing {displayedPhotos.length} of {photos.length} uploaded photos by default.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setShowAllPhotos((value) => !value)}
                >
                  {showAllPhotos ? "Show less" : `Show all ${photos.length}`}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2.5">
              {displayedPhotos.map((photo, i) => {
                const lightboxTargetIndex = photos.findIndex((item) => item.id === photo.id);
                return (
                <div
                  key={photo.id}
                  className="group crm-lead-card-inner relative h-20 w-20 overflow-hidden rounded-2xl shadow-[0_16px_24px_-22px_rgba(59,130,246,0.12)] dark:shadow-none"
                >
                  <img
                    src={photo.previewUrl}
                    alt=""
                    loading="lazy"
                    onError={() => {
                      // Bucket transforms unsupported (Free tier) — disable session-wide and refetch.
                      void import("@/lib/storage").then(({ markTransformsBroken, areTransformsBroken }) => {
                        if (!areTransformsBroken()) {
                          markTransformsBroken();
                          if (leadId) void fetchPhotos(leadId);
                        }
                      });
                    }}
                    className="h-full w-full object-cover cursor-pointer"
                    onClick={() => {
                      openLightbox(lightboxTargetIndex >= 0 ? lightboxTargetIndex : i);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeExistingPhoto(photo.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
                );
              })}

              {!showAllPhotos && hiddenPhotoCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllPhotos(true)}
                  className="crm-lead-card-soft flex h-20 w-20 items-center justify-center rounded-2xl border text-[12px] font-semibold text-foreground/75 transition-colors hover:border-primary/40"
                >
                  +{hiddenPhotoCount}
                </button>
              )}

              {newPhotos.map((photo, i) => (
                <div
                  key={`new-${i}`}
                  className="group crm-lead-card-inner relative h-20 w-20 overflow-hidden rounded-2xl shadow-[0_16px_24px_-22px_rgba(59,130,246,0.12)] dark:shadow-none"
                >
                  <img src={URL.createObjectURL(photo)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeNewPhoto(i)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}

              <label className="crm-lead-card-soft flex h-20 w-20 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed transition-colors hover:border-primary/40">
                <ImagePlus className="h-5 w-5 text-muted-foreground/55" />
                <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoAdd} />
              </label>
            </div>
          </div>

          <div className={sectionClass}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">General Notes</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                Leave context that should stay visible no matter which role opens this lead later.
              </p>
            </div>
            {isNew ? (
              <Textarea
                value={form.general_notes}
                onChange={(e) => update("general_notes", e.target.value)}
                rows={4}
                className={`${fieldClass} resize-none min-h-[110px]`}
              />
            ) : (
              leadId && <NoteThread leadId={leadId} noteType="general" label="General Notes" />
            )}
          </div>

          {(isAdmin || isProcessor || isOpr) && leadId && (
            <div className={sectionClass}>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">OPR Notes</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Notes shared with assigned operators.
                </p>
              </div>
              <NoteThread leadId={leadId} noteType="opr" label="OPR Notes" />
            </div>
          )}
        </CardContent>
      </Card>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        onConfirm={handlePaymentConfirm}
        loading={paymentLoading}
      />

      <CancellationRequestSheet
        open={cancelRequestOpen}
        onOpenChange={setCancelRequestOpen}
        onSubmit={handleCancellationRequestSubmit}
        loading={cancelRequestLoading}
        requesterLabel={isProcessor ? "Admin" : "Processor or Admin"}
        leadId={leadId || undefined}
      />

      <UrgentAICheckDialog
        open={urgentCheckOpen}
        onOpenChange={handleUrgentCheckOpenChange}
        leadId={leadId ?? ""}
        onProceed={() => {
          setForm((previous) => ({ ...previous, status: "urgent_job" }));
          setOriginalLead((previous) => previous ? { ...previous, status: "urgent_job" } : previous);
          setSaved(true);
          clearUrgentCheckParam();
        }}
      />

      <CancellationRequestSheet
        open={adminCancelOpen}
        onOpenChange={setAdminCancelOpen}
        onSubmit={handleAdminCancelSubmit}
        loading={adminCancelLoading}
        mode="direct"
        leadId={leadId || undefined}
      />

      <ImageLightbox
        images={allImageUrls}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      />
    </div>
  );
}
