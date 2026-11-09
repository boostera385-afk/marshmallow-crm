import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChangeEvent, ElementType, FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ServiceCombobox } from "@/components/service-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  AlertCircle,
  ImagePlus,
  X,
  ChevronDown,
  User,
  Wrench,
  Calendar,
  Sparkles,
  UploadCloud,
  Phone,
} from "lucide-react";
import { LEAD_STATUS_CONFIG, type LeadStatus } from "@/types";
import { getChangeableStatuses, canChangeStatus } from "@/lib/constants";
import { useDuplicatePhoneCheck } from "@/hooks/useDuplicatePhoneCheck";
import { formatUSPhone, hasContactNumber } from "@/lib/phone";
import { logActivity } from "@/lib/activity";
import { showsUrgentCheck } from "@/lib/urgent-verification";
import { optimizeImageForUpload } from "@/lib/image-upload";
import { requestQuoteApproval } from "@/lib/quote-approval-requests";
import { motion, AnimatePresence } from "framer-motion";
import NumberNameCombobox from "./NumberNameCombobox";
import MultiDateTimePicker from "./MultiDateTimePicker";
import { geocodeAndPersistLeadAddress } from "@/lib/lead-address-geocoding";
import { DateInput } from "@/components/ui/date-input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialData?: {
    customer_name?: string;
    customer_phone?: string;
    direction?: "incoming" | "outgoing" | "";
  };
  /**
   * Called after a lead is created in a safe status because the user asked for
   * it to be urgent. The parent opens the verification dialog against the new
   * lead, which now has an id and can be read back from the database.
   */
  onUrgentCheckCreated?: (lead: {
    leadId: string;
    jobId: string;
    customerName: string;
    previousStatus: string;
  }) => void;
}

const initialFormState = {
  customer_name: "",
  customer_phone: "",
  customer_landline: "",
  number_name: "",
  direction: "" as "" | "incoming" | "outgoing",
  address: "",
  half_address: "",
  service_type: "",
  status: "waiting_complete_details" as LeadStatus,
  scheduled_date: "",
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
  tech_name: "",
  tech_number: "",
  terms: "" as "" | "free_estimate" | "quoted",
  labor_amount: "",
  material_amount: "",
  for_you_amount: "",
  for_us_amount: "",
  cs_notes: "",
  processor_notes: "",
  general_notes: "",
};

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
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[0.10] to-primary/[0.04] shadow-inner">
      <Icon className="h-4 w-4 text-primary/80" />
    </div>

    <div className="min-w-0 flex-1 text-left">
      <div className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">{title}</div>
      {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
    </div>

    <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
      <ChevronDown className="h-4 w-4 text-muted-foreground/70" />
    </motion.span>
  </div>
);

const AddLeadDialog = ({ open, onOpenChange, onSuccess, initialData, onUrgentCheckCreated }: Props) => {
  const { user, role, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [shouldResetOnClose, setShouldResetOnClose] = useState(true);

  const [form, setForm] = useState({
    ...initialFormState,
    customer_name: initialData?.customer_name || "",
    customer_phone: initialData?.customer_phone || "",
    direction: initialData?.direction || ""
  });

  const [photos, setPhotos] = useState<File[]>([]);
  const [csOpen, setCsOpen] = useState(true);
  const [processorOpen, setProcessorOpen] = useState(role !== "customer_service" && role !== "cs_admin");
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const { isDuplicate, duplicateLeadName } = useDuplicatePhoneCheck(form.customer_phone);

  const isCS = role === "customer_service";
  const isProcessor = role === "processor";
  // CS Admins create leads with the same access as a CS: same status choices, same defaults,
  // and the new lead is assigned to them. Their wider status list applies to editing, not to
  // creating, where most of those statuses cannot apply to a brand new lead anyway.
  const createsAsCs = isCS || role === "cs_admin";
  const creationRole = createsAsCs ? "customer_service" : role;

  const fieldClass =
    "h-11 rounded-xl border-border/60 bg-background text-foreground shadow-sm placeholder:text-muted-foreground/55";
  const labelClass = "text-[12px] font-semibold tracking-[-0.01em] text-foreground/82";
  const sectionShell = "rounded-2xl border border-border/60 bg-card/90 shadow-[0_14px_38px_-28px_rgba(0,0,0,0.35)]";

  const update = (key: string, value: string) => {
    setShouldResetOnClose(false);
    if (key === "customer_phone" || key === "customer_landline" || key === "tech_number") {
      setForm((prev) => ({ ...prev, [key]: formatUSPhone(value) }));
    } else {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
  };

  const handlePhotoAdd = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setShouldResetOnClose(false);
      setPhotos((prev) => [...prev, ...Array.from(e.target.files)]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const parseTime = (hour: string, minute: string, ampm: string) => {
    let h = parseInt(hour);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${minute}`;
  };

  const resetForm = () => {
    setForm({
      ...initialFormState,
      customer_name: initialData?.customer_name || "",
      customer_phone: initialData?.customer_phone || "",
      direction: initialData?.direction || ""
    });
    setPhotos([]);
    setCsOpen(true);
    setProcessorOpen(!createsAsCs);
    setScheduleOpen(false);
    setShouldResetOnClose(true);
  };

  // Also reset when opened to capture fresh initialData.
  // We explicitly exclude initialData from the dependency array so that if
  // a background refresh updates the lead prop while the user is typing,
  // we do not blow away their unsaved edits.
  useEffect(() => {
    if (open) {
      resetForm();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const closeDialog = (resetDraft: boolean) => {
    setShouldResetOnClose(resetDraft);
    onOpenChange(false);
    if (resetDraft) {
      resetForm();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

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
    if (!form.direction) {
      toast.error("Please select Incoming or Outgoing");
      return;
    }
    if (isDuplicate) {
      toast.error(`A lead with this phone number already exists (${duplicateLeadName})`);
      return;
    }
    if (!canChangeStatus(creationRole, form.status)) {
      toast.error("You do not have permission to set that status");
      return;
    }

    setLoading(true);

    const jobId = generateJobId();
    const currentUserName = profile?.full_name || user.email || "Unknown user";
    const requestsQuoteApproval = role === "customer_service" && form.status === "pending_to_send";
    // A new lead cannot be verified before it exists, since the check reads the
    // stored record and the function looks it up by id. So a lead asked for as
    // urgent is always created in its ordinary starting status and the check runs
    // against the row that now exists.
    //
    // This applies to every role, not just customer_service. Admin, processor and
    // cs_admin are allowed by the database to insert urgent_job directly, but
    // routing them through the same dialog means they get the same comparison and
    // the same suggested fixes. One path, one set of wording, and the role only
    // decides whether the result is advisory or enforcing.
    const requestsUrgentCheck = form.status === "urgent_job" && showsUrgentCheck(role);
    const createdStatus: LeadStatus =
      requestsQuoteApproval || requestsUrgentCheck ? "waiting_complete_details" : form.status;

    let scheduled_time_start: string | null = null;
    let scheduled_time_end: string | null = null;

    if (form.scheduled_date) {
      scheduled_time_start = parseTime(form.start_hour, form.start_minute, form.start_ampm);
      scheduled_time_end = parseTime(form.end_hour, form.end_minute, form.end_ampm);
    }

    const insertData = {
      job_id: jobId,
      customer_name: form.customer_name,
      customer_phone: form.customer_phone || "",
      ...(form.customer_landline ? { customer_landline: form.customer_landline } : {}),
      number_name: form.number_name || null,
      direction: form.direction || null,
      address: form.address || null,
      half_address: form.half_address || null,
      service_type: form.service_type?.trim() || "",
      status: createdStatus,
      scheduled_date: form.scheduled_date || null,
      scheduled_time_start,
      scheduled_time_end,
      created_by: user.id,
      created_by_name: currentUserName,
      assigned_cs: createsAsCs ? user.id : null,
      // Manual CRM entry. The Chrome extension leaves this false, and RLS
      // only lets a CS through when Settings granted Manual Lead Addition.
      manual_entry: true,

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
    };

    const { data, error } = await supabase.from("leads").insert(insertData).select().single();

    if (error) {
      toast.error("Failed to create lead: " + error.message);
      setLoading(false);
      return;
    }

    if (data) {
      // Save first; address lookup is best-effort and must never hold up lead creation.
      void geocodeAndPersistLeadAddress(data.id, form.address);

      let quoteApprovalRequested = false;
      if (requestsQuoteApproval) {
        try {
          await requestQuoteApproval({
            lead: {
              id: data.id,
              job_id: data.job_id,
              customer_name: data.customer_name,
              status: createdStatus,
            },
            requesterId: user.id,
          });
          quoteApprovalRequested = true;
        } catch (approvalError) {
          toast.error(
            approvalError instanceof Error
              ? `Lead created, but approval request failed: ${approvalError.message}`
              : "Lead created, but approval request failed",
          );
        }
      }

      // The lead has an id now, so the check can read the real record. Opening
      // the same dialog used for existing leads keeps one set of wording and one
      // set of outcomes rather than a second implementation for new leads.
      if (requestsUrgentCheck) {
        onUrgentCheckCreated?.({
          leadId: data.id,
          jobId: data.job_id,
          customerName: data.customer_name,
          previousStatus: createdStatus,
        });
      }

      for (const photo of photos) {
        const optimizedPhoto = await optimizeImageForUpload(photo);
        const ext = optimizedPhoto.name.split(".").pop();
        const path = `leads/${data.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadErr } = await supabase.storage.from("lead-photos").upload(path, optimizedPhoto);

        if (!uploadErr) {
          await supabase.from("lead_photos").insert({
            lead_id: data.id,
            photo_url: path,
            uploaded_by: user.id,
            uploaded_by_name: currentUserName,
          });
        }
      }

      const noteInserts: { lead_id: string; user_id: string; user_name: string; note_type: string; content: string }[] = [];
      if (!isProcessor && form.cs_notes.trim()) {
        noteInserts.push({ lead_id: data.id, user_id: user.id, user_name: currentUserName, note_type: "cs", content: form.cs_notes.trim() });
      }
      if (!isCS && form.processor_notes.trim()) {
        noteInserts.push({
          lead_id: data.id,
          user_id: user.id,
          user_name: currentUserName,
          note_type: "processor",
          content: form.processor_notes.trim(),
        });
      }
      if (form.general_notes.trim()) {
        noteInserts.push({
          lead_id: data.id,
          user_id: user.id,
          user_name: currentUserName,
          note_type: "general",
          content: form.general_notes.trim(),
        });
      }
      if (noteInserts.length > 0) {
        await supabase.from("lead_notes").insert(noteInserts);
      }

      // Status alerts are sent by the database (leads_notify_change).
      await logActivity(user.id, "created", "lead", data.id, {
        customer_name: form.customer_name,
        status: createdStatus,
      });

      if (quoteApprovalRequested) {
        toast.success("Lead created and quote sent for approval");
      } else if (!requestsQuoteApproval) {
        toast.success("Lead created successfully!");
      }
      onSuccess();
      closeDialog(true);
    }

    setLoading(false);
  };

  const TimePicker = ({ prefix, label }: { prefix: "start" | "end"; label: string }) => (
    <div className="space-y-1.5">
      <Label className={labelClass}>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Select value={form[`${prefix}_hour` as keyof typeof form]} onValueChange={(v) => update(`${prefix}_hour`, v)}>
          <SelectTrigger className="h-10 w-[66px] rounded-xl border-border/60 bg-background shadow-sm">
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
          <SelectTrigger className="h-10 w-[66px] rounded-xl border-border/60 bg-background shadow-sm">
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
          <SelectTrigger className="h-10 w-[70px] rounded-xl border-border/60 bg-background shadow-sm">
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

  const renderCollapsible = ({
    openState,
    setOpenState,
    icon,
    title,
    subtitle,
    children,
  }: {
    openState: boolean;
    setOpenState: (v: boolean) => void;
    icon: React.ElementType;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }) => (
    <Collapsible open={openState} onOpenChange={setOpenState}>
      <div className={sectionShell}>
        <CollapsibleTrigger className="w-full p-4 text-left transition-colors hover:bg-muted/[0.18] rounded-2xl">
          <SectionHeader icon={icon} title={title} subtitle={subtitle} open={openState} />
        </CollapsibleTrigger>

        <AnimatePresence initial={false}>
          {openState && (
            <CollapsibleContent forceMount asChild>
              <motion.div
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                <div className="border-t border-border/50 px-4 pb-4 pt-4">{children}</div>
              </motion.div>
            </CollapsibleContent>
          )}
        </AnimatePresence>
      </div>
    </Collapsible>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next && !loading && shouldResetOnClose) {
          resetForm();
        }
      }}
    >
      <DialogContent className="max-h-[94vh] w-[min(96vw,60rem)] overflow-y-auto rounded-[24px] border border-border/60 bg-card p-0 shadow-[0_24px_70px_-36px_rgba(0,0,0,0.50)] sm:rounded-[28px]">
        <DialogHeader className="sticky top-0 z-10 border-b border-border/60 bg-card/95 px-4 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-primary/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                <Sparkles className="h-2.5 w-2.5" />
                New Lead
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Phone className="h-2.5 w-2.5" />
                CRM Intake
              </span>
            </div>

              <div>
                <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-foreground">
                  Add New Lead
                </DialogTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add customer details, status, schedule, notes, and photos.
                </p>
              </div>
            </div>
          </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4 sm:space-y-5 sm:px-6 sm:py-6">
          <div className={`${sectionShell} p-5`}>
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                Required Information
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Start with the essentials so the lead is valid and trackable.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className={labelClass}>Customer Name *</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => update("customer_name", e.target.value)}
                  placeholder="John Doe"
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Number Name *</Label>
                <NumberNameCombobox
                  value={form.number_name}
                  onChange={(value) => update("number_name", value)}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className={labelClass}>Cell Phone</Label>
                <Input
                  value={form.customer_phone}
                  onChange={(e) => update("customer_phone", e.target.value)}
                  placeholder="(555) 123-4567"
                  maxLength={14}
                  className={`${fieldClass} ${isDuplicate ? "border-destructive ring-1 ring-destructive/40" : ""}`}
                />
                {isDuplicate && (
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-destructive/15 bg-destructive/[0.07] px-2.5 py-1 text-[11px] text-destructive">
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
                  placeholder="(555) 123-4567"
                  maxLength={14}
                  className={fieldClass}
                />
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">A cell phone or a landline is required.</p>

            <div className="mt-4 space-y-1.5">
              <Label className={labelClass}>Direction *</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["incoming", "outgoing"] as const).map((dir) => {
                  const selected = form.direction === dir;
                  return (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => update("direction", dir)}
                      className={`flex items-center justify-center gap-2 h-11 rounded-xl border text-[13px] font-medium capitalize transition-all ${
                        selected
                          ? "border-primary bg-primary/[0.08] text-primary shadow-sm"
                          : "border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${selected ? "border-primary" : "border-muted-foreground/40"}`}>
                        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      {dir}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {renderCollapsible({
            openState: csOpen,
            setOpenState: setCsOpen,
            icon: User,
            title: "Customer Service Details",
            subtitle: "Address, service request, quote context, reference, and CS notes.",
            children: (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className={labelClass}>Address</Label>
                  <Input
                    value={form.address}
                    onChange={(e) => update("address", e.target.value)}
                    placeholder="123 Main St, City, State, Zip"
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Half Address</Label>
                  <Input
                    value={form.half_address}
                    onChange={(e) => update("half_address", e.target.value)}
                    placeholder="Partial address shown to operators (e.g. street + city only)"
                    className={fieldClass}
                  />
                </div>


                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className={labelClass}>Service Type</Label>
                    <ServiceCombobox
                      value={form.service_type}
                      onChange={(val) => update("service_type", val)}
                      placeholder="HVAC, Plumbing, etc."
                      className={fieldClass}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className={labelClass}>Quote</Label>
                    <Input
                      value={form.quote}
                      onChange={(e) => update("quote", e.target.value)}
                      placeholder="Quote amount or details"
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Service Details</Label>
                  <Textarea
                    value={form.service_details}
                    onChange={(e) => update("service_details", e.target.value)}
                    placeholder="Detailed description of the service needed..."
                    rows={4}
                    className="min-h-[120px] rounded-xl border-border/60 bg-background text-foreground shadow-sm placeholder:text-muted-foreground/55 resize-none"
                  />
                </div>

                  <div className="space-y-1.5">
                    <Label className={labelClass}>Customer Schedule Requirements</Label>
                    <MultiDateTimePicker
                      value={form.customer_schedule_requirements}
                      onChange={(val) => update("customer_schedule_requirements", val)}
                    />
                  </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Reference</Label>
                  <Input
                    value={form.reference_name}
                    onChange={(e) => update("reference_name", e.target.value)}
                    placeholder="Referral name or source"
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>CS Notes</Label>
                  <Textarea
                    value={form.cs_notes}
                    onChange={(e) => update("cs_notes", e.target.value)}
                    placeholder={isProcessor ? "Processors can view CS notes later, but cannot create them." : "Write CS notes here..."}
                    rows={5}
                    className="min-h-[130px] rounded-xl border-border/60 bg-background text-foreground shadow-sm placeholder:text-muted-foreground/55 resize-none"
                    readOnly={isProcessor}
                  />
                </div>
              </div>
            ),
          })}

          {!isCS &&
            renderCollapsible({
              openState: processorOpen,
              setOpenState: setProcessorOpen,
              icon: Wrench,
              title: "Processor Details",
              subtitle: "Technician assignment, terms, pricing breakdown, and processor notes.",
              children: (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className={labelClass}>Tech Name</Label>
                      <Input
                        value={form.tech_name}
                        onChange={(e) => update("tech_name", e.target.value)}
                        placeholder="Technician name"
                        className={fieldClass}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className={labelClass}>Tech Number</Label>
                      <Input
                        value={form.tech_number}
                        onChange={(e) => update("tech_number", e.target.value)}
                        placeholder="(555) 123-4567"
                        maxLength={14}
                        className={fieldClass}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={labelClass}>Terms</Label>
                    <Select value={form.terms} onValueChange={(v) => update("terms", v)}>
                      <SelectTrigger className={fieldClass}>
                        <SelectValue placeholder="Select terms..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free_estimate">Free Estimate Visit</SelectItem>
                        <SelectItem value="quoted">Quoted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <AnimatePresence initial={false}>
                    {form.terms === "quoted" && (
                      <motion.div
                        initial={{ opacity: 0, y: -6, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -6, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-2xl border border-border/50 bg-muted/[0.18] p-4">
                          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                            Quoted Details
                          </p>

                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className={labelClass}>Customer Labor ($)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={form.labor_amount}
                                onChange={(e) => update("labor_amount", e.target.value)}
                                placeholder="0.00"
                                className={fieldClass}
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label className={labelClass}>Materials ($)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={form.material_amount}
                                onChange={(e) => update("material_amount", e.target.value)}
                                placeholder="0.00"
                                className={fieldClass}
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label className={labelClass}>For You ($ incl. material)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={form.for_you_amount}
                                onChange={(e) => update("for_you_amount", e.target.value)}
                                placeholder="0.00"
                                className={fieldClass}
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label className={labelClass}>For Us ($ from labor)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={form.for_us_amount}
                                onChange={(e) => update("for_us_amount", e.target.value)}
                                placeholder="0.00"
                                className={fieldClass}
                              />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-1.5">
                    <Label className={labelClass}>Processor Notes</Label>
                    <Textarea
                      value={form.processor_notes}
                      onChange={(e) => update("processor_notes", e.target.value)}
                      placeholder="Write processor notes here..."
                      rows={5}
                      className="min-h-[130px] rounded-xl border-border/60 bg-background text-foreground shadow-sm placeholder:text-muted-foreground/55 resize-none"
                    />
                  </div>
                </div>
              ),
            })}

          {renderCollapsible({
            openState: scheduleOpen,
            setOpenState: setScheduleOpen,
            icon: Calendar,
            title: "Schedule & Status",
            subtitle: "Choose the lead status and optionally set a job date and time window.",
            children: (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className={labelClass}>Status</Label>
                  <Select value={form.status} onValueChange={(v) => update("status", v)}>
                    <SelectTrigger className={fieldClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getChangeableStatuses(creationRole)
                        .filter((key) => key !== "paid")
                        .map((key) => {
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

                <div className="space-y-1.5">
                  <Label className={labelClass}>Job Scheduled For</Label>
                  <DateInput
                    aria-label="Job Scheduled For"
                    value={form.scheduled_date}
                    onChange={(value) => update("scheduled_date", value)}
                    className={fieldClass}
                  />
                </div>

                {form.scheduled_date && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TimePicker prefix="start" label="Start Time" />
                    <TimePicker prefix="end" label="End Time" />
                  </div>
                )}
              </div>
            ),
          })}

          <div className={sectionShell}>
            <div className="p-5">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">Photos</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Add supporting images for the lead intake. These help technicians and processors later.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                {photos.map((photo, i) => (
                  <div
                    key={i}
                    className="group relative h-20 w-20 overflow-hidden rounded-2xl border border-border/50 bg-muted/[0.2] shadow-sm"
                  >
                    <img src={URL.createObjectURL(photo)} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/50 bg-background/60 transition-all duration-200 hover:border-primary/35 hover:bg-primary/[0.03]">
                  <UploadCloud className="h-5 w-5 text-muted-foreground/50" />
                  <span className="mt-1 text-[10px] text-muted-foreground/60">Upload</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoAdd} />
                </label>

                <label className="flex min-h-[80px] min-w-[220px] flex-1 cursor-pointer items-center gap-3 rounded-2xl border border-border/50 bg-muted/[0.12] px-4 transition-all duration-200 hover:border-primary/25 hover:bg-primary/[0.03]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/10 bg-primary/[0.06]">
                    <ImagePlus className="h-4 w-4 text-primary/80" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">Add lead photos</p>
                    <p className="text-[11px] text-muted-foreground">Upload one or multiple images</p>
                  </div>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoAdd} />
                </label>
              </div>
            </div>
          </div>

          <div className={sectionShell}>
            <div className="p-5">
              <div className="mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
                  General Notes
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Add shared notes that anyone working the lead should know.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>General Notes</Label>
                <Textarea
                  value={form.general_notes}
                  onChange={(e) => update("general_notes", e.target.value)}
                  placeholder="Write general notes about this lead..."
                  rows={5}
                  className="min-h-[130px] rounded-xl border-border/60 bg-background text-foreground shadow-sm placeholder:text-muted-foreground/55 resize-none"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 border-t border-border/60 bg-card/95 px-0 pb-0 pt-4">
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => closeDialog(true)}
                className="w-full rounded-xl sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || isDuplicate || !form.direction} className="w-full rounded-xl px-5 sm:w-auto">
                {loading ? "Creating..." : "Create Lead"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddLeadDialog;



