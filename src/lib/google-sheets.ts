import { supabase } from "@/integrations/supabase/client";
import { LEAD_STATUS_CONFIG, CS_TAG_LABELS, type Lead, type LeadStatus, type CsTag } from "@/types";
import { formatUSPhone } from "@/lib/phone";

import { formatDateTime } from "@/lib/date-time-format";
export const TARGET_SPREADSHEET_URL =
  "https://docs.google.com/spreadsheets/d/1zGnzG0ovA2ICiUNoOVgVjleVt0CDeN1yCfHEx83ucxs/edit?gid=0#gid=0";

export interface GoogleSheetsConfig {
  webhookUrl: string;
  autoSync: boolean;
  spreadsheetUrl: string;
}

export interface GoogleSheetLeadRow {
  "Lead ID": string;
  "Lead Creation Date": string;
  "Customer Name": string;
  "Customer Phone No": string;
  Address: string;
  "Service Type": string;
  "Service Details": string;
  "Number Name": string;
  "Schedule Requirements": string;
  Pictures: string;
  Tag: string;
  Status: string;
  "Tech Name": string;
  "Tech Number": string;
  "Cs Notes": string;
  "Processor Notes": string;
  "Opr Notes": string;
  _created_at?: string;
  _id?: string;
  _job_id?: string;
}

interface NoteSummary {
  cs: string;
  processor: string;
  opr: string;
}

/**
 * Get Google Sheets Configuration
 * Reads the server-side configuration used by both the browser and cron worker.
 */
export async function getGoogleSheetsConfig(): Promise<GoogleSheetsConfig> {
  const defaultConfig: GoogleSheetsConfig = {
    webhookUrl: "",
    autoSync: false,
    spreadsheetUrl: TARGET_SPREADSHEET_URL,
  };

  const { data, error } = await supabase
    .from("quo_ai_settings" as never)
    .select("value")
    .eq("key", "google_sheets_sync_config")
    .maybeSingle();
  if (error) throw new Error(`Could not load server-side Google Sheets settings: ${error.message}`);

  const dbConfig = (data as { value?: Partial<GoogleSheetsConfig> } | null)?.value;
  return dbConfig ? { ...defaultConfig, ...dbConfig } : defaultConfig;
}

/**
 * Save Google Sheets Configuration
 */
export async function saveGoogleSheetsConfig(config: GoogleSheetsConfig): Promise<void> {
  if (config.autoSync && !isGoogleAppsScriptUrl(config.webhookUrl)) {
    throw new Error("Enter a valid Google Apps Script Web App URL before enabling automatic sync.");
  }
  if (config.webhookUrl && !isGoogleAppsScriptUrl(config.webhookUrl)) {
    throw new Error("The webhook must be an HTTPS Google Apps Script Web App URL ending in /exec.");
  }
  const { error } = await supabase.from("quo_ai_settings" as never).upsert(
    {
      key: "google_sheets_sync_config",
      value: config,
      description: "Google Sheets transactional outbox configuration",
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "key" }
  );
  if (error) throw new Error(`Could not save server-side Google Sheets settings: ${error.message}`);
}

function isGoogleAppsScriptUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com"
      && url.pathname.includes("/macros/s/") && url.pathname.endsWith("/exec");
  } catch {
    return false;
  }
}

/**
 * Format a Lead into the 17 exact columns requested
 */
/**
 * The sheet has one phone column. It carries the cell phone; a lead reachable only by landline
 * shows that number instead, marked, so the column is not blank for a lead that has a number.
 */
export function formatSheetPhone(lead: { customer_phone?: string | null; customer_landline?: string | null }): string {
  if (lead.customer_phone) return formatUSPhone(lead.customer_phone);
  if (lead.customer_landline) return `${formatUSPhone(lead.customer_landline)} (Landline)`;
  return "";
}

export function formatLeadForGoogleSheet(
  lead: Lead,
  noteSummary?: NoteSummary,
  photoUrls?: string[]
): GoogleSheetLeadRow {
  const addressParts = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean);
  const fullAddress = addressParts.join(", ");

  const statusLabel =
    LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.label ||
    lead.status?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "";

  const tagLabel = lead.cs_tag
    ? CS_TAG_LABELS[lead.cs_tag as CsTag] || lead.cs_tag
    : "";

  const picture = photoUrls && photoUrls.length > 0 ? photoUrls.join("\n") : "";

  // Format Lead Creation Date
  let leadCreationDate = "";
  if (lead.created_at) {
    try {
      const d = new Date(lead.created_at);
      leadCreationDate = d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      leadCreationDate = lead.created_at;
    }
  }

  return {
    "Lead ID": lead.job_id || lead.id,
    "Lead Creation Date": leadCreationDate,
    "Customer Name": lead.customer_name || "",
    "Customer Phone No": formatSheetPhone(lead),
    Address: fullAddress,
    "Service Type": lead.service_type || "",
    "Service Details": lead.service_details || "",
    "Number Name": lead.number_name || "",
    "Schedule Requirements": lead.customer_schedule_requirements || "",
    Pictures: picture,
    Tag: tagLabel,
    Status: statusLabel,
    "Tech Name": lead.tech_name || "",
    "Tech Number": lead.tech_number ? formatUSPhone(lead.tech_number) : "",
    "Cs Notes": noteSummary?.cs || "",
    "Processor Notes": noteSummary?.processor || "",
    "Opr Notes": noteSummary?.opr || "",
    _created_at: lead.created_at,
    _id: lead.id,
    _job_id: lead.job_id || undefined,
  };
}

/**
 * Fetch all leads along with their notes threads and photos
 */
export async function fetchAllLeadsWithDetails(): Promise<GoogleSheetLeadRow[]> {
  // 1. Fetch ALL leads in batches of 1000 using range pagination so we are never capped
  const allLeads: Lead[] = [];
  const PAGE_SIZE = 1000;
  let from = 0;

  while (true) {
    const { data: chunk, error: leadsError } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (leadsError) {
      throw new Error(`Failed to load leads: ${leadsError.message}`);
    }

    if (!chunk || chunk.length === 0) {
      break;
    }

    allLeads.push(...(chunk as Lead[]));

    if (chunk.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  if (allLeads.length === 0) {
    return [];
  }

  const typedLeads = allLeads;
  const leadIds = typedLeads.map((l) => l.id);

  // 2. Batch fetch lead_notes in chunks of 100. A child-table query failure
  //    must fail reconciliation rather than silently claiming notes were backed up.
  const noteSummaryByLead: Record<string, NoteSummary> = {};
  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    const { data: notes, error: notesError } = await supabase
      .from("lead_notes")
      .select("lead_id, note_type, content, user_id, user_name, created_at")
      .in("lead_id", chunk)
      .order("created_at", { ascending: true });

    if (notesError) throw new Error(`Failed to load lead notes: ${notesError.message}`);

    if (notes) {
      notes.forEach((note) => {
        if (!noteSummaryByLead[note.lead_id]) {
          noteSummaryByLead[note.lead_id] = { cs: "", processor: "", opr: "" };
        }
        const author = note.user_name || note.user_id || "Unknown";
        const time = note.created_at ? formatDateTime(note.created_at) : "";
        const line = time ? `[${time}] ${author}: ${note.content}` : `${author}: ${note.content}`;

        if (note.note_type === "cs") {
          noteSummaryByLead[note.lead_id].cs = noteSummaryByLead[note.lead_id].cs
            ? `${noteSummaryByLead[note.lead_id].cs}\n${line}`
            : line;
        } else if (note.note_type === "processor") {
          noteSummaryByLead[note.lead_id].processor = noteSummaryByLead[note.lead_id].processor
            ? `${noteSummaryByLead[note.lead_id].processor}\n${line}`
            : line;
        } else if (note.note_type === "opr" || note.note_type === "general") {
          noteSummaryByLead[note.lead_id].opr = noteSummaryByLead[note.lead_id].opr
            ? `${noteSummaryByLead[note.lead_id].opr}\n${line}`
            : line;
        }
      });
    }
  }

  // 3. Batch fetch photos in chunks of 100. Never report a successful backup
  //    when the Pictures column could not be read.
  const photoUrlsByLead: Record<string, string[]> = {};
  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    const { data: photos, error: photosError } = await supabase
      .from("lead_photos")
      .select("lead_id, photo_url")
      .in("lead_id", chunk)
      .order("created_at", { ascending: true });

    if (photosError) throw new Error(`Failed to load lead photos: ${photosError.message}`);

    if (photos) {
      photos.forEach((p) => {
        if (!photoUrlsByLead[p.lead_id]) {
          photoUrlsByLead[p.lead_id] = [];
        }
        // Build public URL from Supabase storage
        const publicUrl = supabase.storage.from("lead-photos").getPublicUrl(p.photo_url).data.publicUrl;
        photoUrlsByLead[p.lead_id].push(publicUrl || p.photo_url);
      });
    }
  }

  // 4. Combine everything
  return typedLeads.map((lead) => {
    const notes = noteSummaryByLead[lead.id];
    const photos = photoUrlsByLead[lead.id];
    return formatLeadForGoogleSheet(lead, notes, photos);
  });
}

/**
 * Invoke a verified Apps Script action through the authenticated Edge Function.
 * No browser fetch/no-cors fallback is allowed because an opaque response
 * cannot confirm the write.
 */
async function invokeAppsScript(
  payload: Record<string, unknown>,
  explicitWebhookUrl?: string
): Promise<{ success: boolean; message?: string; [key: string]: unknown }> {
  const body = { ...payload };
  if (explicitWebhookUrl) body.webhookUrl = explicitWebhookUrl;
  const { data, error } = await supabase.functions.invoke("google-sheets-sync", { body });
  if (error) throw new Error(`Google Sheets Edge Function failed: ${await describeFunctionError(error)}`);
  if (!data || data.success !== true) {
    throw new Error(String(data?.error ?? "Google Sheets did not confirm the write."));
  }
  return data;
}

async function describeFunctionError(error: unknown): Promise<string> {
  const candidate = error as { message?: unknown; context?: unknown };
  const context = candidate?.context;
  if (context instanceof Response) {
    let responseMessage = "";
    try {
      const text = await context.clone().text();
      if (text) {
        try {
          const body = JSON.parse(text) as { error?: unknown; message?: unknown };
          responseMessage = String(body.error ?? body.message ?? "");
        } catch {
          responseMessage = text.slice(0, 300);
        }
      }
    } catch {
      // Keep the HTTP status and SDK message when a response body is unreadable.
    }
    return responseMessage || `HTTP ${context.status}${candidate.message ? `: ${String(candidate.message)}` : ""}`;
  }
  return typeof candidate?.message === "string" ? candidate.message : String(error);
}

/**
 * Request a server-side full rebuild. The Edge Function pauses outbox delivery,
 * clears the workbook, replaces the queue with a fresh lead snapshot, then
 * releases the worker. The browser only starts the job; it does not own it.
 */
export async function syncAllLeadsToGoogleSheets(): Promise<{
  success: boolean;
  leadsCount: number;
  message?: string;
}> {
  const config = await getGoogleSheetsConfig();
  if (!config.webhookUrl) throw new Error("Configure the Apps Script Web App URL before reconciling.");
  if (!config.autoSync) throw new Error("Enable Automatic Server Sync before rebuilding the Sheet.");
  const { data, error } = await supabase.functions.invoke("google-sheets-sync", {
    body: { action: "reconcile_all" },
  });
  if (error) throw new Error(`Could not start full reconciliation: ${await describeFunctionError(error)}`);
  if (!data || data.success !== true) {
    throw new Error(String(data?.error ?? "The server did not confirm the reconciliation request."));
  }

  return {
    success: true,
    leadsCount: Number(data.queued ?? 0),
    message: String(data.message ?? `Full reconcile queued for ${Number(data.queued ?? 0)} leads.`),
  };
}

/**
 * Test connection to the Google Sheets Webhook
 */
export async function testGoogleSheetsWebhook(webhookUrl: string): Promise<{
  success: boolean;
  message: string;
  spreadsheetName?: string;
  sheets?: string[];
  version?: string;
}> {
  if (!webhookUrl || !webhookUrl.startsWith("http")) {
    throw new Error("Please provide a valid Webhook URL starting with https://");
  }

  const res = await invokeAppsScript({ action: "ping" }, webhookUrl);
  if (res.success !== true) throw new Error(String(res.error || res.message || "Google Apps Script did not confirm the connection."));
  const capabilities = Array.isArray(res.capabilities) ? res.capabilities : [];
  if (!capabilities.includes("sync_mirror")) {
    throw new Error("This Apps Script deployment is outdated. Copy the latest script from Settings and deploy a new Web App version.");
  }
  return {
    success: true,
    message: String(res.message || "Connected successfully to Google Sheets!"),
    spreadsheetName: typeof res.spreadsheetName === "string" ? res.spreadsheetName : undefined,
    sheets: Array.isArray(res.sheets) ? res.sheets : undefined,
    version: typeof res.version === "string" ? res.version : undefined,
  };
}
