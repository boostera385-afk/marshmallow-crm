import { useState } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { geocodeAddress, geocodeWithFallback, normalizeAddress } from "@/lib/geo";
import { isLikelyPhone } from "@/lib/phone";
import { Loader2, FileSpreadsheet, Download, MapPin, Copy } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

interface Row {
  rowNumber: number;
  name: string;
  code?: string;
  opr_code?: string;
  phone_number: string;
  phoneInvalid: boolean;
  area: string;
  service: string;
  chat_link: string;
  notes: string;
}

interface FailedRow {
  rowNumber: number;
  name: string;
  oprCode: string;
  phoneNumber: string;
  service: string;
  area: string;
  reason: string;
}

function failedRow(row: Row, reason: string): FailedRow {
  return {
    rowNumber: row.rowNumber,
    name: row.name,
    oprCode: row.opr_code ?? "",
    phoneNumber: row.phone_number,
    service: row.service,
    area: row.area,
    reason,
  };
}

// Normalize header for tolerant matching: lowercase, strip harmless punctuation,
// collapse spaces/underscores/hyphens into a single space.
function normalizeHeader(k: string) {
  return k
    .trim()
    .toLowerCase()
    .replace(/[._\-#]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Legacy key style used elsewhere (snake_case) — kept for internal object keys.
function normalizeKey(k: string) {
  return normalizeHeader(k).replace(/\s+/g, "_");
}

const PHONE_ALIASES = new Set(
  [
    "phone number",
    "phone",
    "phone no",
    "tech phone",
    "technician phone",
    "tech number",
    "tech no",
    "mobile",
    "mobile number",
    "cell",
    "cell phone",
    "cell number",
    "contact",
    "contact number",
    "contact phone",
    "telephone",
    "tel",
  ].map(normalizeHeader),
);

const NAME_ALIASES = new Set(["name", "technician", "technician name", "tech name", "full name"].map(normalizeHeader));
const AREA_ALIASES = new Set(["area", "location", "city", "region", "coverage area"].map(normalizeHeader));
const SERVICE_ALIASES = new Set(["service", "services", "trade", "specialty"].map(normalizeHeader));
const CHAT_ALIASES = new Set(["quo chat link", "chat link", "chat", "link"].map(normalizeHeader));
const NOTES_ALIASES = new Set(["notes", "note", "comments", "remarks"].map(normalizeHeader));
const CODE_ALIASES = new Set(["name code", "code", "technician code", "tech code"].map(normalizeHeader));
const OPR_ALIASES = new Set(["opr code", "opr", "operator code", "operator"].map(normalizeHeader));

// The columns the import understands, shown in the copyable header / template.
const TEMPLATE_HEADERS = ["Name", "OPR Code", "Phone Number", "Service", "Area", "Quo Chat Link", "Notes"] as const;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { current.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        current.push(field); field = "";
        if (current.some((x) => x.trim() !== "")) rows.push(current);
        current = [];
      } else field += c;
    }
  }
  if (field !== "" || current.length) { current.push(field); if (current.some((x) => x.trim() !== "")) rows.push(current); }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => normalizeKey(h));
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
}

// Convert an incoming cell value to a safe phone-number text string.
// Handles: numeric imports (3055550123), floats (3055550123.0), scientific notation.
function cellToPhoneText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "number") {
    if (!isFinite(raw)) return "";
    // Convert to plain integer string when whole; else drop trailing .0
    if (Number.isInteger(raw)) return String(raw);
    const s = raw.toFixed(20).replace(/\.?0+$/, "");
    return s;
  }
  const s = String(raw).trim();
  if (!s) return "";
  // Scientific notation like 3.05555e+9 — parse and re-stringify as integer if safe
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && Math.abs(n) < 1e16) {
      return String(Math.round(n));
    }
  }
  // Trailing ".0" from spreadsheet coercion
  if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, "");
  return s;
}

function pickHeaderValue(r: Record<string, string>, aliases: Set<string>): string {
  for (const key in r) {
    const norm = key.replace(/_/g, " ");
    if (aliases.has(norm)) {
      const v = r[key];
      if (v != null && v !== "") return v;
    }
  }
  return "";
}

export function ImportTechniciansDialog({ open, onOpenChange, onImported }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedRow[]>([]);
  const [insertedCount, setInsertedCount] = useState<number | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ processed: 0, total: 0 });

  const reset = () => { setRows([]); setFileName(null); setFailed([]); setInsertedCount(null); setIsGeocoding(false); setGeocodeProgress({ processed: 0, total: 0 }); };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setFailed([]);
    setInsertedCount(null);
    const ext = file.name.toLowerCase().split(".").pop();
    let raw: Record<string, string>[] = [];
    try {
      if (ext === "csv") {
        const text = await file.text();
        raw = parseCsv(text);
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // Read as raw values so numeric phone cells arrive as numbers/strings we can normalize.
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
        raw = json.map((r) => {
          const out: Record<string, string> = {};
          for (const k in r) {
            const key = normalizeKey(k);
            const isPhoneCol = PHONE_ALIASES.has(key.replace(/_/g, " "));
            out[key] = isPhoneCol ? cellToPhoneText(r[k]) : String(r[k] ?? "").trim();
          }
          return out;
        });
      } else {
        toast({ title: "Unsupported file", description: "Use .csv or .xlsx", variant: "destructive" });
        return;
      }
    } catch (e) {
      toast({ title: "Could not read file", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      return;
    }

    const parsed: Row[] = raw.map((r, idx) => {
      const phoneRaw = pickHeaderValue(r, PHONE_ALIASES);
      const phone = cellToPhoneText(phoneRaw).trim();
      return {
        rowNumber: idx + 2,
        name: pickHeaderValue(r, NAME_ALIASES).trim(),
        code: pickHeaderValue(r, CODE_ALIASES).trim() || undefined,
        opr_code: pickHeaderValue(r, OPR_ALIASES).trim() || undefined,
        phone_number: phone,
        phoneInvalid: phone.length > 0 && !isLikelyPhone(phone),
        service: pickHeaderValue(r, SERVICE_ALIASES).trim(),
        area: pickHeaderValue(r, AREA_ALIASES).trim(),
        chat_link: pickHeaderValue(r, CHAT_ALIASES).trim(),
        notes: pickHeaderValue(r, NOTES_ALIASES).trim(),
      };
    });
    setRows(parsed);
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setImporting(true);
    setFailed([]);
    setInsertedCount(null);
    try {
      const [{ data: existing }, oprResult] = await Promise.all([
        supabase.from("technicians").select("name, area, phone_number"),
        supabase.rpc("list_opr_codes" as never),
      ]);
      // Duplicate detection is based on the phone number ONLY.
      const seenPhones = new Set(
        (existing ?? [])
          .map((t) => String(t.phone_number ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))
          .filter((d) => d.length >= 7),
      );
      const validOprCodes = oprResult.error
        ? null
        : new Set(((oprResult.data ?? []) as Array<{ opr_code: string }>).map((row) => row.opr_code.trim().toUpperCase()));

      const failures: FailedRow[] = [];
      const { data: { user } } = await supabase.auth.getUser();

      type InsertPayload = {
        row: Row;
        payload: {
          name: string;
          code: string | null;
          opr_code: string | null;
          area: string;
          phone_number: string | null;
          service: string | null;
          chat_link: string | null;
          notes: string | null;
          latitude: null;
          longitude: null;
          created_by: string | null;
        };
      };
      const toInsert: InsertPayload[] = [];

      for (const r of rows) {
        if (!r.name && !r.area && !r.service && !r.chat_link && !r.notes && !r.phone_number && !r.code && !r.opr_code) {
          failures.push(failedRow(r, "Row is empty"));
          continue;
        }

        const missing = [
          !r.name && "Name",
          !r.opr_code && "OPR Code",
          !r.phone_number && "Phone Number",
          !r.service && "Service",
          !r.area && "Area",
        ].filter(Boolean) as string[];
        if (missing.length > 0) {
          failures.push(failedRow(r, `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`));
          continue;
        }

        if (r.phoneInvalid || r.phone_number.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) {
          failures.push(failedRow(r, `Invalid phone number: ${r.phone_number}`));
          continue;
        }

        const cleanOprCode = r.opr_code!.trim().toUpperCase();
        if (validOprCodes && !validOprCodes.has(cleanOprCode)) {
          failures.push(failedRow(r, `Unknown OPR Code: ${r.opr_code}`));
          continue;
        }

        const validPhone = r.phone_number;
        const digits = validPhone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
        if (seenPhones.has(digits)) {
          failures.push(failedRow(r, `Duplicate technician: phone ${validPhone} is already present`));
          continue;
        }
        seenPhones.add(digits);
        toInsert.push({
          row: r,
          payload: {
            name: r.name,
            code: r.code ? r.code.trim() : null,
            opr_code: cleanOprCode,
            area: r.area,
            phone_number: validPhone,
            service: r.service || null,
            chat_link: r.chat_link || null,
            notes: r.notes || null,
            latitude: null,
            longitude: null,
            created_by: user?.id ?? null,
          },
        });
      }

      let inserted = 0;
      const insertedIds: Array<{ id: string; area: string }> = [];

      for (let i = 0; i < toInsert.length; i += 100) {
        const chunk = toInsert.slice(i, i + 100);
        let { data, error } = await supabase
          .from("technicians")
          .insert(chunk.map((c) => c.payload))
          .select("id, area");

        if (error && (error.message?.includes("code") || error.code === "42703")) {
          const chunkWithoutCode = chunk.map((c) => {
            const { code: _, ...rest } = c.payload;
            return rest;
          });
          const res = await supabase.from("technicians").insert(chunkWithoutCode).select("id, area");
          data = res.data;
          error = res.error;
        }

        if (!error && data) {
          inserted += data.length;
          data.forEach((d) => insertedIds.push({ id: d.id as string, area: (d.area as string) ?? "" }));
          continue;
        }

        for (const c of chunk) {
          const { data: single, error: singleErr } = await supabase
            .from("technicians")
            .insert(c.payload)
            .select("id, area")
            .single();
          if (singleErr || !single) {
            const duplicate = (singleErr as { code?: string } | null)?.code === "23505"
              || singleErr?.message?.toLowerCase().includes("duplicate technician phone");
            failures.push(failedRow(
              c.row,
              duplicate ? `Duplicate technician: phone ${c.row.phone_number} is already present` : singleErr?.message ?? "Insert failed",
            ));
          } else {
            inserted++;
            insertedIds.push({ id: single.id as string, area: (single.area as string) ?? "" });
          }
        }
      }

      setInsertedCount(inserted);
      setFailed(failures);

      toast({
        title: "Import complete",
        description: `${inserted} imported. ${failures.length} issue${failures.length === 1 ? "" : "s"}. Starting map backfill...`,
      });
      
      onImported?.();
      
      // Start background geocoding backfill
      startGeocodeBackfill();
    } catch (e) {
      toast({ title: "Import failed", description: (e as { message?: string }).message || "An error occurred", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const startGeocodeBackfill = async () => {
    setIsGeocoding(true);
    setGeocodeProgress({ processed: 0, total: 0 });
    
    try {
      const { data: missing, error } = await supabase
        .from("technicians")
        .select("id, area")
        .is("latitude", null)
        .not("area", "is", null)
        .neq("area", "");

      if (error || !missing || missing.length === 0) {
        setIsGeocoding(false);
        return;
      }

      setGeocodeProgress({ processed: 0, total: missing.length });

      let processed = 0;
      for (const row of missing) {
        const result = await geocodeWithFallback({ address: row.area });
        if (result.coords) {
          await supabase
            .from("technicians")
            .update({ latitude: result.coords.latitude, longitude: result.coords.longitude })
            .eq("id", row.id);
        }
        
        processed++;
        setGeocodeProgress({ processed, total: missing.length });
        
        await new Promise((r) => setTimeout(r, 1100));
      }
      
      onImported?.();
    } catch (e) {
      console.error("Geocoding backfill error", e);
    } finally {
      setIsGeocoding(false);
    }
  };

  const downloadFailedCsv = () => {
    if (!failed.length) return;
    const headers = ["Row", "Name", "OPR Code", "Phone Number", "Service", "Area", "Reason"];
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = [
      headers.join(","),
      ...failed.map((f) => [f.rowNumber, f.name, f.oprCode, f.phoneNumber, f.service, f.area, f.reason].map((x) => esc(String(x ?? ""))).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `technicians-import-failed-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const copyTemplateHeaders = async () => {
    const header = TEMPLATE_HEADERS.join("\t");
    try {
      await navigator.clipboard.writeText(header);
      toast({ title: "Header row copied", description: "Paste it into row 1 of your sheet." });
    } catch {
      toast({ title: "Copy failed", description: header, variant: "destructive" });
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [...TEMPLATE_HEADERS],
      ["John Smith", "OPR001", "(305) 555-0123", "Plumbing", "Miami, FL", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Technicians");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "technicians-import-template.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Technicians</DialogTitle>
          <DialogDescription>
            Upload a .csv or .xlsx. Name, OPR Code, Phone Number, Service, and Area are required for every row.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2">
            <div className="min-w-0 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Expected headers: </span>
              <code className="break-words">{TEMPLATE_HEADERS.join(", ")}</code>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyTemplateHeaders}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy header
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Template
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>
          {fileName && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{fileName}</span>
            </div>
          )}
          {rows.length > 0 && insertedCount === null && (
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
                <span className="font-medium">Preview</span>
                <span className="text-muted-foreground">{rows.length} rows detected</span>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-1.5">Tech (Name)</th>
                      <th className="px-3 py-1.5">Number</th>
                      <th className="px-3 py-1.5">Service</th>
                      <th className="px-3 py-1.5">Area</th>
                      <th className="px-3 py-1.5">Chat Link</th>
                      <th className="px-3 py-1.5">Notes</th>
                      <th className="px-3 py-1.5">OPR Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5">{r.name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">
                          {r.phone_number ? (
                            <span className={r.phoneInvalid ? "text-destructive" : ""} title={r.phoneInvalid ? "Invalid — row will not be imported" : undefined}>
                              {r.phone_number}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">{r.service || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">{r.area || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5 max-w-[160px] truncate" title={r.chat_link}>{r.chat_link || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5 max-w-[160px] truncate" title={r.notes}>{r.notes || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">{r.opr_code || <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {insertedCount !== null && (
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
                <span className="font-medium">Import Report</span>
                <span>
                  <span className="text-emerald-600 dark:text-emerald-400">{insertedCount} imported</span>
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-400">{failed.length} issues</span>
                </span>
              </div>
              {failed.length > 0 ? (
                <>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          <th className="px-3 py-1.5 w-14">Row</th>
                          <th className="px-3 py-1.5">Name</th>
                          <th className="px-3 py-1.5">OPR Code</th>
                          <th className="px-3 py-1.5">Phone</th>
                          <th className="px-3 py-1.5">Service</th>
                          <th className="px-3 py-1.5">Area</th>
                          <th className="px-3 py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failed.map((f, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5">{f.rowNumber}</td>
                            <td className="px-3 py-1.5">{f.name || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-1.5">{f.oprCode || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-1.5">{f.phoneNumber || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-1.5">{f.service || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-1.5">{f.area || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-1.5 text-amber-600 dark:text-amber-400">{f.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t px-3 py-2">
                    <Button variant="outline" size="sm" onClick={downloadFailedCsv}>
                      <Download className="mr-1.5 h-3.5 w-3.5" /> Download issues (CSV)
                    </Button>
                  </div>
                </>
              ) : (
                <div className="px-3 py-4 text-center text-xs text-emerald-600 dark:text-emerald-400">
                  All rows imported successfully.
                </div>
              )}
            </div>
          )}

          {isGeocoding && (
            <div className="rounded-md border p-4 flex flex-col items-center justify-center space-y-2 mt-4 bg-muted/20">
              <div className="flex items-center space-x-2 text-primary">
                <MapPin className="h-5 w-5 animate-bounce" />
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div className="text-sm font-medium">Resolving Map Locations...</div>
              <div className="text-xs text-muted-foreground">
                {geocodeProgress.processed} of {geocodeProgress.total} technicians processed. This ensures they appear on the map.
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            {insertedCount !== null ? "Close" : "Cancel"}
          </Button>
          {insertedCount === null && (
            <Button onClick={handleImport} disabled={importing || rows.length === 0}>
              {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import {rows.length} rows
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
