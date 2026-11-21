import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { geocodeAddress } from "@/lib/geo";
import { formatUSPhone, formatUSPhoneInput, stripPhone, validateUSPhone } from "@/lib/phone";
import { PhoneInput } from "@/components/ui/phone-input";
import { lookupZipCentroid, resolveZip } from "@/lib/zipCentroids";
import { TECHNICIANS_QUERY_KEY, upsertTechnicianInList } from "@/lib/technicians";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Star } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { mustChooseOprCode } from "@/lib/access";
import { AreaCombobox } from "@/components/technicians/AreaCombobox";

export interface TechnicianRecord {
  id: string;
  name: string;
  is_active: boolean;
  created_by?: string | null;
  updated_at?: string | null;
  area: string;
  service: string | null;
  notes: string | null;
  chat_link: string | null;
  phone_number: string | null;
  latitude: number | null;
  longitude: number | null;
  code?: string | null;
  opr_code?: string | null;
  created_at?: string | null;
  is_good_tech?: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician?: TechnicianRecord | null;
  onSaved?: (saved: TechnicianRecord) => void;
}

interface OprCodeOption {
  opr_code: string;
  full_name: string | null;
}

export function TechnicianDialog({ open, onOpenChange, technician, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { role, profile } = useAuth();
  const [name, setName] = useState("");
  const [oprCode, setOprCode] = useState("");
  const [oprCodeOptions, setOprCodeOptions] = useState<OprCodeOption[]>([]);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [service, setService] = useState("");
  const [chatLink, setChatLink] = useState("");
  const [notes, setNotes] = useState("");
  const [isGoodTech, setIsGoodTech] = useState(false);
  const [saving, setSaving] = useState(false);

  // A regular opr is locked to their own code; opr_admin / admin pick one.
  const myOprCode = profile?.opr_code ?? "";
  const canSetGoodTech = role === "admin";
  const canChooseOprCode = mustChooseOprCode(role);

  useEffect(() => {
    if (open) {
      setName(technician?.name ?? "");
      // Existing tech keeps its code; a new one defaults to the opr's own code.
      setOprCode(technician?.opr_code ?? (canChooseOprCode ? "" : myOprCode));
      setPhone(formatUSPhone(technician?.phone_number ?? ""));
      setPhoneError(null);
      setArea(technician?.area ?? "");
      setService(technician?.service ?? "");
      setChatLink(technician?.chat_link ?? "");
      setNotes(technician?.notes ?? "");
      setIsGoodTech(technician?.is_good_tech ?? false);

      // Load the list of OPR codes for the picker (admins / opr_admins choose).
      if (canChooseOprCode) {
        supabase.rpc("list_opr_codes" as never).then(({ data }) => {
          const rows = (data ?? []) as OprCodeOption[];
          setOprCodeOptions(rows);
        });
      }
    }
  }, [open, technician, canChooseOprCode, myOprCode]);

  const handleSubmit = async () => {
    const cleanName = name.trim();
    const cleanArea = area.trim();
    const cleanService = service.trim();
    const cleanPhone = formatUSPhoneInput(phone);
    const phoneDigits = stripPhone(cleanPhone);

    // Required fields: Technician Name, OPR Code, Number, Service, and Area.
    if (!cleanName) {
      toast({ title: "Technician Name is required", variant: "destructive" });
      return;
    }
    if (!phoneDigits) {
      setPhoneError("Phone number is required");
      return;
    }
    const invalidPhone = validateUSPhone(cleanPhone);
    if (invalidPhone) {
      setPhoneError(invalidPhone);
      return;
    }
    if (!cleanService) {
      toast({ title: "Service is required", variant: "destructive" });
      return;
    }
    if (!cleanArea) {
      toast({ title: "Area is required", variant: "destructive" });
      return;
    }

    // OPR code: a regular OPR is locked to their own; managing roles choose one.
    const cleanOprCode = (canChooseOprCode ? oprCode : myOprCode).trim();
    if (!cleanOprCode) {
      toast({
        title: "OPR Code is required",
        description: role === "opr" ? "Ask an admin to assign an OPR code to your account." : "Choose which OPR this technician belongs to.",
        variant: "destructive",
      });
      return;
    }

    setPhoneError(null);
    setSaving(true);
    try {
      let latitude = technician?.latitude ?? null;
      let longitude = technician?.longitude ?? null;
      const areaChanged = !technician || technician.area !== cleanArea;
      if (areaChanged && cleanArea) {
        const zip = resolveZip({ address: cleanArea });
        const centroid = await lookupZipCentroid(zip);
        const coords = centroid ?? await geocodeAddress(cleanArea);
        if (coords) {
          latitude = coords.latitude;
          longitude = coords.longitude;
        } else {
          latitude = null;
          longitude = null;
        }
      } else if (!cleanArea) {
        latitude = null;
        longitude = null;
      }

      const payload = {
        name: cleanName,
        area: cleanArea,
        phone_number: cleanPhone,
        service: cleanService,
        chat_link: chatLink.trim() || null,
        notes: notes.trim() || null,
        opr_code: cleanOprCode || null,
        latitude,
        longitude,
        // is_good_tech is admin-only now. Sending it from anyone else would be
        // rejected by the trigger on technicians, which would take the whole
        // save down with it: editing a note would fail because an untouched
        // flag was carried along. Omitting the key leaves the column alone.
        ...(canSetGoodTech ? { is_good_tech: isGoodTech } : {}),
      };

      const SELECT = "id, name, area, service, notes, chat_link, phone_number, latitude, longitude, code, opr_code, is_active, created_by, created_at, updated_at, is_good_tech";
      let saved: TechnicianRecord | null = null;
      let error: { message: string; code?: string } | null = null;
      if (technician) {
        const res = await supabase.from("technicians").update(payload as never).eq("id", technician.id).select(SELECT).single();
        error = res.error;
        saved = (res.data as TechnicianRecord | null) ?? null;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const res = await supabase.from("technicians").insert({ ...payload, created_by: user?.id ?? null } as never).select(SELECT).single();
        error = res.error;
        saved = (res.data as TechnicianRecord | null) ?? null;
      }

      if (error || !saved?.id) {
        const duplicate = error?.code === "23505" || error?.message?.toLowerCase().includes("duplicate technician phone");
        if (duplicate) setPhoneError("A technician with this phone number already exists");
        toast({
          title: duplicate ? "Duplicate technician" : "Save failed",
          description: duplicate ? "This phone number is already assigned to another technician." : error?.message ?? "Could not verify the saved technician.",
          variant: "destructive",
        });
      } else {
        const geoWarn = !!cleanArea && (latitude == null || longitude == null);
        queryClient.setQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY, (current) =>
          upsertTechnicianInList(current, saved),
        );
        toast({
          title: technician ? "Technician updated" : "Technician added",
          description: geoWarn ? "Saved, but the area could not be located on the map." : undefined,
        });
        if (!technician) {
          setPhone("");
          setOprCode(canChooseOprCode ? "" : myOprCode);
        }
        onSaved?.(saved);
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{technician ? "Edit Technician" : "Add Technician"}</DialogTitle>
          <DialogDescription>Manage a technician for the Map View.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="tech-name">Technician Name <span className="text-destructive">*</span></Label>
              <button
                type="button"
                onClick={() => canSetGoodTech && setIsGoodTech(!isGoodTech)}
                disabled={!canSetGoodTech}
                className={`flex items-center gap-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isGoodTech ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground hover:text-foreground"
                }`}
                title={
                  canSetGoodTech
                    ? "Mark as Good Tech"
                    : "Only an admin can change Good Tech. Request it from the Technicians list."
                }
              >
                <Star
                  className={`h-4 w-4 ${isGoodTech ? "fill-amber-500 text-amber-500" : ""}`}
                />
                Good Tech
              </button>
            </div>
            <Input id="tech-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Smith" />
          </div>

          {/* OPR Code: locked to the opr's own code; admins / opr_admins choose. */}
          <div className="space-y-1.5">
            <Label htmlFor="tech-opr-code">
              OPR Code <span className="text-destructive">*</span>
            </Label>
            {canChooseOprCode ? (
              <Select value={oprCode || "__none__"} onValueChange={(val) => setOprCode(val === "__none__" ? "" : val)}>
                <SelectTrigger id="tech-opr-code" className="text-xs">
                  <SelectValue placeholder="Choose an OPR..." />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {oprCodeOptions.map((item) => (
                    <SelectItem key={item.opr_code} value={item.opr_code}>
                      {item.opr_code}{item.full_name ? ` — ${item.full_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="tech-opr-code"
                value={oprCode || "Not assigned"}
                readOnly
                className="font-mono tracking-wider text-foreground/80"
              />
            )}
            <p className="text-[11px] text-muted-foreground">
              {canChooseOprCode
                ? "The OPR this technician belongs to. It controls who can see this technician."
                : "This technician is added under your OPR code."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tech-phone">Phone Number <span className="text-destructive">*</span></Label>
            <PhoneInput
              id="tech-phone"
              value={phone}
              onValueChange={(value) => { setPhone(value); if (phoneError) setPhoneError(null); }}
              placeholder="e.g. (305) 555-0123"
              error={phoneError}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-area">Area <span className="text-destructive">*</span></Label>
            <AreaCombobox id="tech-area" value={area} onChange={setArea} placeholder="Start typing a city or area..." />
            <p className="text-[11px] text-muted-foreground">City & state, ZIP code, or full address. Used to place the marker.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-service">Service <span className="text-destructive">*</span></Label>
            <Input id="tech-service" value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. Plumbing" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-chat">Quo Chat Link</Label>
            <Input id="tech-chat" value={chatLink} onChange={(e) => setChatLink(e.target.value)} placeholder="https://app.openphone.com/..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tech-notes">Notes</Label>
            <Textarea id="tech-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t border-border/40 bg-[hsl(var(--background)/0.96)] px-6 pb-6 pt-3 backdrop-blur">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {technician ? "Save Changes" : "Add Technician"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
