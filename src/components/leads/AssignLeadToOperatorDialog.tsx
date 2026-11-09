import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Lead } from "@/lib/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ServiceCombobox } from "@/components/service-combobox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { UserPlus, MapPin, Wrench, FileText, Image as ImageIcon, X, ImagePlus, Send, Loader2 } from "lucide-react";
import { optimizeImageForUpload } from "@/lib/image-upload";
import { logActivity } from "@/lib/activity";
import { motion, AnimatePresence } from "framer-motion";
import MultiDateTimePicker from "./MultiDateTimePicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  onSuccess: () => void;
}

interface OprUser {
  id: string;
  full_name: string;
}

export default function AssignLeadToOperatorDialog({ open, onOpenChange, lead, onSuccess }: Props) {
  const { user, profile } = useAuth();

  // Form state (editable, auto-filled from lead)
  const [address, setAddress] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [serviceDetails, setServiceDetails] = useState("");
  const [quote, setQuote] = useState("");
  const [showQuote, setShowQuote] = useState(true);
  const [customerScheduleRequirements, setCustomerScheduleRequirements] = useState("");
  const [oprNotes, setOprNotes] = useState("");

  // Photo management
  const [existingPhotoPaths, setExistingPhotoPaths] = useState<string[]>([]);
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([]);
  const [removedPhotoPaths, setRemovedPhotoPaths] = useState<Set<string>>(new Set());
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const [newPhotoPreviews, setNewPhotoPreviews] = useState<string[]>([]);

  // Operator selection
  const [oprUsers, setOprUsers] = useState<OprUser[]>([]);
  const [selectedOprIds, setSelectedOprIds] = useState<Set<string>>(new Set());
  const [existingAssignments, setExistingAssignments] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [loadingOprUsers, setLoadingOprUsers] = useState(false);

  // Auto-fill form when dialog opens
  useEffect(() => {
    if (open) {
      setAddress([lead.city, lead.state].filter(Boolean).join(", "));
      setServiceType(lead.service_type || "");
      setServiceDetails(lead.service_details || "");
      setQuote(lead.quote || "");
      setShowQuote(lead.show_quote_to_opr !== false);
      setCustomerScheduleRequirements(lead.customer_schedule_requirements || "");
      setOprNotes("");
      setRemovedPhotoPaths(new Set());
      setNewPhotoFiles([]);
      setNewPhotoPreviews([]);
      setSelectedOprIds(new Set());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load existing photos
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const loadPhotos = async () => {
      const { data } = await supabase
        .from("lead_photos")
        .select("photo_url")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: true });

      if (!data || cancelled) return;

      const paths = data.map((p: { photo_url: string }) => p.photo_url);
      setExistingPhotoPaths(paths);

      const { getSignedUrls } = await import("@/lib/storage");
      const urls = await getSignedUrls(paths, { width: 160, height: 160, resize: "cover", quality: 55 });
      if (!cancelled) setExistingPhotoUrls(urls);
    };

    void loadPhotos();
    return () => { cancelled = true; };
  }, [open, lead.id]);

  // Load OPR users
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const loadOprUsers = async () => {
      setLoadingOprUsers(true);

      // Get user IDs with opr role
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "opr");

      if (!roleData || cancelled) {
        setLoadingOprUsers(false);
        return;
      }

      const oprUserIds = roleData.map((r: { user_id: string }) => r.user_id);

      if (oprUserIds.length === 0) {
        setOprUsers([]);
        setLoadingOprUsers(false);
        return;
      }

      // Get profiles for these users
      const { data: profileData } = await supabase
        .from("profiles_public" as never)
        .select("id, full_name")
        .in("id", oprUserIds) as { data: { id: string; full_name: string | null }[] | null };

      if (!cancelled && profileData) {
        setOprUsers(
          profileData.map((p) => ({
            id: p.id,
            full_name: p.full_name || "Unknown",
          }))
        );
      }

      // Load existing assignments for this lead
      const { data: assignData } = await supabase
        .from("lead_operator_assignments")
        .select("operator_user_id")
        .eq("lead_id", lead.id);

      if (!cancelled && assignData) {
        setExistingAssignments(
          new Set(assignData.map((a: { operator_user_id: string }) => a.operator_user_id))
        );
      }

      setLoadingOprUsers(false);
    };

    void loadOprUsers();
    return () => { cancelled = true; };
  }, [open, lead.id]);

  const toggleOperator = useCallback((oprId: string) => {
    setSelectedOprIds((prev) => {
      const next = new Set(prev);
      if (next.has(oprId)) next.delete(oprId);
      else next.add(oprId);
      return next;
    });
  }, []);

  const handleRemoveExistingPhoto = (index: number) => {
    const path = existingPhotoPaths[index];
    if (path) {
      setRemovedPhotoPaths((prev) => new Set([...prev, path]));
    }
  };

  const handleAddPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const fileArr = Array.from(files);
    setNewPhotoFiles((prev) => [...prev, ...fileArr]);

    fileArr.forEach((file) => {
      const url = URL.createObjectURL(file);
      setNewPhotoPreviews((prev) => [...prev, url]);
    });

    e.target.value = "";
  };

  const handleRemoveNewPhoto = (index: number) => {
    URL.revokeObjectURL(newPhotoPreviews[index]);
    setNewPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setNewPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!user) return;

    if (selectedOprIds.size === 0) {
      toast.error("Please select at least one operator to assign");
      return;
    }

    setSubmitting(true);

    try {
      // 1. Update lead fields if changed
      const updates: Record<string, unknown> = {};
      
      const addressParts = address.split(",").map(s => s.trim());
      const newCity = addressParts[0] || "";
      const newState = addressParts.slice(1).join(", ") || "";
      
      if (newCity !== (lead.city || "")) updates.city = newCity;
      if (newState !== (lead.state || "")) updates.state = newState;
      if (serviceType !== (lead.service_type || "")) updates.service_type = serviceType;
      if (serviceDetails !== (lead.service_details || "")) updates.service_details = serviceDetails;
      if (quote !== (lead.quote || "")) updates.quote = quote;
      if (showQuote !== (lead.show_quote_to_opr !== false)) updates.show_quote_to_opr = showQuote;
      if (customerScheduleRequirements !== (lead.customer_schedule_requirements || "")) updates.customer_schedule_requirements = customerScheduleRequirements;

      if (Object.keys(updates).length > 0) {
        updates.last_edited_by = user.id;
        updates.last_edited_by_name = profile?.full_name || user.email || "Unknown user";
        updates.updated_at = new Date().toISOString();
        updates.last_edited_at = new Date().toISOString();

        const { error: updateError } = await supabase
          .from("leads")
          .update(updates as never)
          .eq("id", lead.id);

        if (updateError) {
          toast.error("Failed to update lead fields: " + updateError.message);
          setSubmitting(false);
          return;
        }
      }

      // 2. Remove deleted photos
      if (removedPhotoPaths.size > 0) {
        const pathsToRemove = Array.from(removedPhotoPaths);
        await supabase.from("lead_photos").delete().in("photo_url", pathsToRemove);
        await supabase.storage.from("lead-photos").remove(pathsToRemove);
      }

      // 3. Upload new photos
      for (const file of newPhotoFiles) {
        const optimized = await optimizeImageForUpload(file);
        const ext = optimized.name.split(".").pop() || "jpg";
        const path = `${lead.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("lead-photos").upload(path, optimized);
        if (!uploadError) {
          await supabase.from("lead_photos").insert({
            lead_id: lead.id,
            photo_url: path,
            uploaded_by: user.id,
            uploaded_by_name: profile?.full_name || user.email || "Unknown user",
          });
        }
      }

      // 4. Create assignments (skip already-assigned operators)
      const newAssignments = Array.from(selectedOprIds).filter(
        (id) => !existingAssignments.has(id)
      );

      if (newAssignments.length > 0) {
        const rows = newAssignments.map((oprId) => ({
          lead_id: lead.id,
          operator_user_id: oprId,
          assigned_by: user.id,
          assigned_by_name: profile?.full_name || user.email || "Unknown user",
        }));

        const { error: assignError } = await supabase
          .from("lead_operator_assignments")
          .insert(rows);

        if (assignError) {
          toast.error("Failed to assign: " + assignError.message);
          setSubmitting(false);
          return;
        }
      }

      // 5. Add OPR notes if provided
      if (oprNotes.trim()) {
        await supabase.from("lead_notes").insert({
          lead_id: lead.id,
          user_id: user.id,
          user_name: profile?.full_name || user.email || "Unknown user",
          note_type: "opr",
          content: oprNotes.trim(),
        });
      }

      // 6. Assigned operators are notified by the database (lead_operator_assignments_notify).

      // 7. Log activity
      await logActivity(user.id, "lead_assigned_to_opr", "lead", lead.id, {
        target_name: lead.job_id,
        customer_name: lead.customer_name,
        job_id: lead.job_id,
        assigned_operators: newAssignments.length,
      });

      const assignedCount = newAssignments.length;
      const alreadyCount = selectedOprIds.size - assignedCount;
      let msg = `Lead assigned to ${assignedCount} operator${assignedCount !== 1 ? "s" : ""}`;
      if (alreadyCount > 0) msg += ` (${alreadyCount} already assigned)`;
      toast.success(msg);

      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const visibleExistingPhotos = existingPhotoPaths
    .map((path, i) => ({ path, url: existingPhotoUrls[i] || "", index: i }))
    .filter(({ path }) => !removedPhotoPaths.has(path));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 rounded-[28px] border-border/40 shadow-premium-xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserPlus className="h-5 w-5" />
            </div>
            Assign Lead to Operator
          </DialogTitle>
          <p className="text-[13px] text-muted-foreground mt-1">
            Review and edit lead details, then select operator(s) to assign.
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto px-6 pb-4">
          <div className="space-y-5">
            {/* Address Fields */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Customer Address
              </div>
              <div>
                <Label htmlFor="assign-address" className="text-[12px]">Address (City, State)</Label>
                <Input
                  id="assign-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="City, State"
                  className="mt-1 h-9 rounded-xl text-[13px]"
                />
              </div>
            </div>

            {/* Service Fields */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Wrench className="h-3.5 w-3.5" />
                Service Info
              </div>
              <div>
                <Label htmlFor="assign-service-type" className="text-[12px]">Service Type</Label>
                <ServiceCombobox
                  id="assign-service-type"
                  value={serviceType}
                  onChange={(val) => setServiceType(val)}
                  placeholder="Service type"
                  className="mt-1 h-9 rounded-xl text-[13px]"
                />
              </div>
              <div>
                <Label htmlFor="assign-service-details" className="text-[12px]">Service Details</Label>
                <Textarea
                  id="assign-service-details"
                  value={serviceDetails}
                  onChange={(e) => setServiceDetails(e.target.value)}
                  placeholder="Service details..."
                  className="mt-1 min-h-[72px] resize-none rounded-xl text-[13px]"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label htmlFor="assign-quote" className="text-[12px]">Quote</Label>
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id="show-quote"
                        checked={showQuote}
                        onCheckedChange={(checked) => setShowQuote(checked as boolean)}
                        className="h-3.5 w-3.5 rounded-[4px]"
                      />
                      <Label htmlFor="show-quote" className="text-[10px] font-medium leading-none cursor-pointer">
                        Show to OPR
                      </Label>
                    </div>
                  </div>
                  <Input
                    id="assign-quote"
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    placeholder="Quote amount/details"
                    className="h-9 rounded-xl text-[13px]"
                  />
                </div>
                <div>
                  <Label className="text-[12px]">Customer Schedule Req.</Label>
                  <div className="mt-1">
                    <MultiDateTimePicker
                      value={customerScheduleRequirements}
                      onChange={setCustomerScheduleRequirements}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Photos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Pictures ({visibleExistingPhotos.length + newPhotoPreviews.length})
                </div>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={handleAddPhotos}
                  />
                  <span className="inline-flex items-center gap-1 rounded-lg border border-dashed border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors">
                    <ImagePlus className="h-3 w-3" />
                    Add Photos
                  </span>
                </label>
              </div>

              {(visibleExistingPhotos.length > 0 || newPhotoPreviews.length > 0) && (
                <div className="grid grid-cols-4 gap-2">
                  <AnimatePresence>
                    {visibleExistingPhotos.map(({ url, index }) => (
                      <motion.div
                        key={`existing-${index}`}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="group relative aspect-square overflow-hidden rounded-xl border border-border/60"
                      >
                        {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                        <button
                          type="button"
                          onClick={() => handleRemoveExistingPhoto(index)}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </motion.div>
                    ))}

                    {newPhotoPreviews.map((url, i) => (
                      <motion.div
                        key={`new-${i}`}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="group relative aspect-square overflow-hidden rounded-xl border-2 border-dashed border-primary/30"
                      >
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemoveNewPhoto(i)}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <span className="absolute bottom-1 left-1 rounded bg-primary/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          NEW
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* OPR Notes */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                OPR Notes
              </div>
              <Textarea
                value={oprNotes}
                onChange={(e) => setOprNotes(e.target.value)}
                placeholder="Add notes for the operator..."
                className="min-h-[72px] resize-none rounded-xl text-[13px]"
                rows={3}
              />
            </div>

            {/* Operator Selection */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <UserPlus className="h-3.5 w-3.5" />
                Assign to Operator(s)
              </div>

              {loadingOprUsers ? (
                <div className="flex items-center justify-center py-4 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-[13px]">Loading operators...</span>
                </div>
              ) : oprUsers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-muted-foreground/30 py-4 text-center text-[13px] text-muted-foreground">
                  No operators found. Add users with the "opr" role first.
                </div>
              ) : (
                <div className="space-y-1.5 rounded-xl border border-border/60 p-2">
                  {oprUsers.map((opr) => {
                    const isExisting = existingAssignments.has(opr.id);
                    const isSelected = selectedOprIds.has(opr.id);
                    return (
                      <label
                        key={opr.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-primary/10 border border-primary/20"
                            : isExisting
                              ? "bg-muted/50 border border-transparent"
                              : "hover:bg-muted/40 border border-transparent"
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOperator(opr.id)}
                          className="h-4 w-4"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">
                            {opr.full_name}
                          </p>
                          {isExisting && (
                            <p className="text-[10px] text-muted-foreground">Already assigned</p>
                          )}
                        </div>
                        {isExisting && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">
                            Assigned
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border/30 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || selectedOprIds.size === 0}
            className="rounded-xl gap-2 min-w-[140px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Assigning...
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Assign ({selectedOprIds.size})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
