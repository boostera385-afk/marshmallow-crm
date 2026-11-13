importScripts("supabase.js", "quote-breakdown.js");

const SUPABASE_URL = "https://kxiqholnmhkwhdkhtopp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aXFob2xubWhrd2hka2h0b3BwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjU0OTcsImV4cCI6MjA4ODc0MTQ5N30.yDiNd6Sl2jWbkNN0Wf5cjClVJKoQXAd8q8kkBUWep7o";

// Create custom storage provider using chrome.storage.local for service worker compatibility
const chromeStorageProvider = {
  getItem: (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (res) => {
        resolve(res[key] || null);
      });
    });
  },
  setItem: (key, value) => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    });
  },
  removeItem: (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, () => {
        resolve();
      });
    });
  }
};

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: chromeStorageProvider,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

const DEFAULT_DRAFT = {
  customerName: "",
  customerNumber: "",
  customerAddress: "",
  numberName: "",
  serviceName: "",
  referenceName: "",
  serviceDetails: "",
  direction: "incoming",
  leadStatus: "default",
  terms: "",
  quote: "",
  laborAmount: "",
  materialsIncluded: "no",
  materialAmount: "",
  scheduleRequirement: "",
  source: "quo.com",
  sourceUrl: "",
  capturedAt: "",
  createdByExtension: true,
  photos: []
};

const DRAFT_STORAGE_KEY = "leadDraft";
const SETTINGS_STORAGE_KEY = "crmSettings";
const CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";
const CENSUS_GEOCODE_CACHE = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDraft();
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("Quo CRM Lead Capture: could not set panel behavior.", error);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDraft();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        success: false,
        error: error.message || "Unexpected error."
      });
    });

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "GET_EXTENSION_RELEASE": {
      const release = await (await fetch(chrome.runtime.getURL("release.json"))).json();
      return { version: chrome.runtime.getManifest().version, releasedAt: release.releasedAt };
    }
    case "TECHNICIAN_WORKFLOW": {
      const { data, error } = await supabaseClient.functions.invoke("technician-chat-assessment", { body: message.payload, signal: AbortSignal.timeout(125000) });
      if (error) {
        const detail = await error.context?.clone?.().json?.().catch(() => null);
        throw new Error(detail?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      return { success: true, ...data };
    }
    case "PAGE_CONTEXT_READY":
      return handlePageContextReady(message, sender);
    case "QUO_CHAT_CHANGED":
      return { success: true };
    case "ASSIGN_SELECTION_TO_FIELD":
      return assignSelectionToField(message, sender);
    case "GET_DRAFT":
      return {
        success: true,
        draft: await getDraft()
      };
    case "UPDATE_DRAFT":
      return {
        success: true,
        draft: await updateDraft(message.payload || {})
      };
    case "CLEAR_DRAFT":
      return {
        success: true,
        draft: await clearDraft()
      };
    case "LOGIN":
      return login(message.email, message.password);
    case "VERIFY_MFA":
      return verifyMfa(message.factorId, message.code);
    case "VERIFY_ACCESS_CODE":
      return verifyAccessCode(message.code);
    case "LOGOUT":
      return logout();
    case "CHECK_AUTH":
      return checkAuth();
    case "CREATE_LEAD":
      return createLead();
    case "PREVIEW_LEAD_COVERAGE":
      return previewLeadCoverage(message.address);
    case "CHECK_LEAD_EXISTS":
      return checkLeadExists(message.phone);
    case "UPDATE_LEAD_SCHEDULE_REQUIREMENT":
      return updateLeadScheduleRequirement(
        message.leadId,
        message.scheduleRequirement,
        message.checkedPhone
      );
    case "GET_EXTENSION_REPORT":
      return getExtensionReport(message.dateFrom, message.dateTo);
    case "CENSUS_ADDRESS_LOOKUP":
      return searchCensusAddress(message.address);
    case "GET_SETTINGS":
      return {
        success: true,
        settings: await getSettings()
      };
    case "SAVE_SETTINGS":
      return {
        success: true,
        settings: await saveSettings(message.payload || {})
      };
    case "QUO_SEND_MESSAGE":
      return handleQuoSendMessage(message);
    case "QUO_PREPARE_PHOTOS":
      return handleQuoPreparePhotos(message);
    case "QUO_PREPARE_CHAT":
      return handleQuoPrepareChat(message);
    default:
      throw new Error("Unsupported message type.");
  }
}

async function previewLeadCoverage(address) {
  const normalizedAddress = String(address || "").trim();
  if (!normalizedAddress) {
    return { success: true, coverage: null };
  }

  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("Sign in to preview technician coverage.");

  let coverage = null;
  const point = await geocodeCensusAddress(normalizedAddress);
  if (point) {
    const { data, error } = await supabaseClient.rpc(
      "preview_lead_technician_coverage_at_point",
      {
        _address: normalizedAddress,
        _city: point.city,
        _state: point.state,
        _zip: point.zip,
        _latitude: point.latitude,
        _longitude: point.longitude
      }
    );
    if (error) throw new Error(error.message);
    coverage = Array.isArray(data) ? (data[0] || null) : null;
  } else {
    const { data, error } = await supabaseClient.rpc("preview_lead_technician_coverage", {
      _address: normalizedAddress,
      _city: null,
      _state: null,
      _zip: null
    });
    if (error) throw new Error(error.message);
    coverage = Array.isArray(data) ? (data[0] || null) : null;
  }

  return {
    success: true,
    coverage
  };
}

// Insert can legitimately take a while: the database recalculates technician
// coverage for the lead inside the same transaction. Give it room instead of
// letting the panel sit on a spinner, and never leave a job id unreleased, so a
// retry after an unknown outcome cannot produce a second lead.
const LEAD_INSERT_TIMEOUT_MS = 45000;
const PENDING_JOB_KEY = "pendingLeadJobId";
const PENDING_DRAFT_KEY = "pendingLeadDraftIdentity";

async function reserveJobId(jobId, identity) {
  await chrome.storage.local.set({ [PENDING_JOB_KEY]: jobId, [PENDING_DRAFT_KEY]: identity });
  return jobId;
}

async function releaseJobId(jobId) {
  const stored = await chrome.storage.local.get(PENDING_JOB_KEY);
  if (stored[PENDING_JOB_KEY] === jobId) {
    await chrome.storage.local.remove([PENDING_JOB_KEY, PENDING_DRAFT_KEY]);
  }
}

async function findLeadByJobId(jobId, creatorId) {
  const { data, error } = await supabaseClient
    .from("leads")
    .select("id, job_id, customer_name, customer_phone, status, created_at")
    .eq("job_id", jobId)
    .eq("created_by", creatorId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function geocodeCensusAddress(address) {
  const normalizedAddress = String(address || "").trim();
  if (normalizedAddress.length < 8) return null;
  const cacheKey = normalizedAddress.toLowerCase().replace(/\s+/g, " ");
  if (CENSUS_GEOCODE_CACHE.has(cacheKey)) return CENSUS_GEOCODE_CACHE.get(cacheKey);

  // Same authenticated Census-only coordinate provider as the CRM/free map.
  const { data, error } = await supabaseClient.functions.invoke("geocode-lead-address", {
    body: { address: normalizedAddress }, signal: AbortSignal.timeout(20000)
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Address lookup failed");
  const match = data?.match;
  if (!match) return null;
  if (match.provider !== "census") throw new Error("Map coordinates must come from Census. Reload Donut and retry after the address service is updated.");
  const latitude = match.latitude;
  const longitude = match.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) {
    CENSUS_GEOCODE_CACHE.set(cacheKey, null);
    return null;
  }
  const point = {
    latitude,
    longitude,
    matchedAddress: typeof match?.matchedAddress === "string" ? match.matchedAddress.trim() : null,
    city: match.city ?? null,
    state: match.state ?? null,
    zip: match.zip ?? null,
    provider: "census"
  };
  if (CENSUS_GEOCODE_CACHE.size >= 100) {
    CENSUS_GEOCODE_CACHE.delete(CENSUS_GEOCODE_CACHE.keys().next().value);
  }
  CENSUS_GEOCODE_CACHE.set(cacheKey, point);
  return point;
}

async function ensureDraft() {
  const stored = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
  if (!stored[DRAFT_STORAGE_KEY]) {
    await chrome.storage.local.set({
      [DRAFT_STORAGE_KEY]: { ...DEFAULT_DRAFT }
    });
  }
}

async function getDraft() {
  await ensureDraft();
  const stored = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
  return {
    ...DEFAULT_DRAFT,
    ...(stored[DRAFT_STORAGE_KEY] || {})
  };
}

async function updateDraft(partialDraft) {
  const current = await getDraft();
  
  if (partialDraft && partialDraft.customerNumber !== undefined) {
    partialDraft.customerNumber = formatPhoneNumber(partialDraft.customerNumber);
  }

  if (partialDraft && partialDraft.leadStatus !== undefined) {
    partialDraft.leadStatus = normalizeLeadStatus(partialDraft.leadStatus);
  }

  if (partialDraft && partialDraft.terms !== undefined) {
    partialDraft.terms = normalizeLeadTerms(partialDraft.terms);
  }

  if (partialDraft && partialDraft.quote !== undefined) {
    partialDraft.quote = String(partialDraft.quote || "");
  }
  for (const field of ["laborAmount", "materialAmount"]) {
    if (partialDraft && partialDraft[field] !== undefined) partialDraft[field] = String(partialDraft[field] ?? "");
  }
  if (partialDraft && partialDraft.materialsIncluded !== undefined) {
    partialDraft.materialsIncluded = partialDraft.materialsIncluded === "yes" ? "yes" : "no";
    if (partialDraft.materialsIncluded === "no") partialDraft.materialAmount = "";
  }

  const next = {
    ...current,
    ...partialDraft,
    source: "quo.com",
    createdByExtension: true
  };

  await chrome.storage.local.set({
    [DRAFT_STORAGE_KEY]: next
  });

  return next;
}

async function clearDraft() {
  const fresh = { ...DEFAULT_DRAFT };
  await chrome.storage.local.set({
    [DRAFT_STORAGE_KEY]: fresh
  });
  await chrome.storage.local.remove([PENDING_JOB_KEY, PENDING_DRAFT_KEY]);
  return fresh;
}

async function handlePageContextReady(message, sender) {
  if (sender?.frameId && sender.frameId !== 0) {
    return { success: true };
  }

  const currentDraft = await getDraft();
  return {
    success: true,
    draft: currentDraft
  };
}

async function assignSelectionToField(message, sender) {
  const field = message.field;
  const selectedText = (message.selectedText || "").trim();

  if (!field || !(field in DEFAULT_DRAFT)) {
    throw new Error("Invalid lead field.");
  }

  if (!selectedText) {
    throw new Error("No selected text to assign.");
  }

  const draft = await getDraft();
  const nextValue = mergeFieldValue(draft[field], selectedText);
  const sourceUrl = sender?.tab?.url || draft.sourceUrl || "";

  const updatedDraft = await updateDraft({
    [field]: nextValue,
    sourceUrl,
    capturedAt: new Date().toISOString()
  });

  if (sender?.tab?.id) {
    try {
      await chrome.sidePanel.open({ tabId: sender.tab.id });
    } catch (error) {
      console.warn("Quo CRM Lead Capture: could not open side panel.", error);
    }
  }

  try {
    await chrome.runtime.sendMessage({
      type: "DRAFT_UPDATED",
      draft: updatedDraft
    });
  } catch (error) {
    console.warn("Quo CRM Lead Capture: no active panel listener for draft update.", error);
  }

  return {
    success: true,
    draft: updatedDraft
  };
}

function mergeFieldValue(existingValue, incomingValue) {
  const current = (existingValue || "").trim();
  const incoming = incomingValue.trim();

  if (!current) {
    return incoming;
  }

  if (current.includes(incoming)) {
    return current;
  }

  return `${current}\n${incoming}`;
}

function normalizeLeadStatus(value) {
  const allowedStatuses = new Set(["default", "urgent_job", "pending_to_send", "quote_sent_waiting"]);
  return allowedStatuses.has(value) ? value : "default";
}

function normalizeLeadTerms(value) {
  const allowedTerms = new Set(["free_estimate", "quoted"]);
  return allowedTerms.has(value) ? value : "";
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
  const settings = stored[SETTINGS_STORAGE_KEY] || {};
  return {
    apiBaseUrl: settings.apiBaseUrl || "https://account-boosters-crm.lovable.app",
    apiToken: settings.apiToken || ""
  };
}

async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = {
    apiBaseUrl: normalizeBaseUrl(partialSettings.apiBaseUrl ?? current.apiBaseUrl ?? "https://account-boosters-crm.lovable.app"),
    apiToken: (partialSettings.apiToken ?? current.apiToken ?? "").trim()
  };

  await chrome.storage.sync.set({
    [SETTINGS_STORAGE_KEY]: next
  });

  return next;
}

function normalizeBaseUrl(value) {
  let cleaned = (value || "").trim().replace(/\/+$/, "");
  if (!cleaned) {
    return "";
  }
  if (!/^https?:\/\//i.test(cleaned)) {
    if (cleaned.startsWith("localhost") || cleaned.startsWith("127.0.0.1")) {
      cleaned = "http://" + cleaned;
    } else {
      cleaned = "https://" + cleaned;
    }
  }
  return cleaned;
}

async function searchCensusAddress(address) {
  const normalizedAddress = String(address || "").trim();
  if (!normalizedAddress) {
    return {
      ok: false,
      error: "Enter an address first."
    };
  }

  try {
    const match = await geocodeCensusAddress(normalizedAddress);
    const matches = match?.matchedAddress ? [{ matchedAddress: match.matchedAddress }] : [];

    return {
      ok: true,
      matches, provider: match?.provider ?? "census"
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Unable to search addresses."
    };
  }
}

// Authentication Handlers
async function login(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }

  const userId = data.user?.id;
  const profile = await getUserProfile(userId);
  return {
    success: true,
    fullyAuthenticated: true,
    user: data.user,
    role: profile.role,
    fullName: profile.fullName
  };
}

async function verifyMfa(factorId, code) {
  const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({
    factorId
  });

  if (challengeError) {
    throw new Error(challengeError.message);
  }

  const { error: verifyError } = await supabaseClient.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code
  });

  if (verifyError) {
    throw new Error("Invalid MFA code. Please try again.");
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const profile = await getUserProfile(user?.id);

  return {
    success: true,
    fullyAuthenticated: true,
    user,
    role: profile.role,
    fullName: profile.fullName
  };
}

async function verifyAccessCode(code) {
  const { data: result, error: fnError } = await supabaseClient.functions.invoke("admin-users", {
    body: { action: "verify_access_code", code }
  });

  if (fnError || result?.error) {
    throw new Error(result?.error || "Invalid access code.");
  }

  if (result?.session?.access_token && result?.session?.refresh_token) {
    await supabaseClient.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token
    });
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const profile = await getUserProfile(user?.id);

  return {
    success: true,
    fullyAuthenticated: true,
    user,
    role: profile.role,
    fullName: profile.fullName
  };
}

async function logout() {
  await supabaseClient.auth.signOut();
  return { success: true };
}

async function checkAuth() {
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) {
      return { success: false };
    }

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return { success: false };
    }

    const profile = await getUserProfile(user.id);
    return {
      success: true,
      user,
      role: profile.role,
      fullName: profile.fullName
    };
  } catch (e) {
    console.warn("Auth check failed", e);
    return { success: false };
  }
}

async function getUserProfile(userId) {
  if (!userId) return { role: "no_role", fullName: "" };
  try {
    const [roleRes, profileRes] = await Promise.all([
      supabaseClient.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      supabaseClient.from("profiles").select("full_name").eq("id", userId).maybeSingle()
    ]);

    return {
      role: roleRes?.data?.role || "no_role",
      fullName: profileRes?.data?.full_name || ""
    };
  } catch (e) {
    console.warn("Could not load user details", e);
    return { role: "no_role", fullName: "" };
  }
}

// Generate Job ID (Matches CRM implementation)
function generateJobId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "LD-";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// Create Lead in Supabase
let leadCreationInFlight = false;
async function createLead() {
  if (leadCreationInFlight) throw new Error("This lead is already being saved. Wait for the current submission.");
  leadCreationInFlight = true;
  try { return await saveLeadDraft(); } finally { leadCreationInFlight = false; }
}

async function saveLeadDraft() {
  const draft = await getDraft();
  const { data: { user } } = await supabaseClient.auth.getUser();

  if (!user) {
    throw new Error("You must be logged in to create leads.");
  }

  if (!draft.customerName.trim() && !draft.customerNumber.trim()) {
    throw new Error("Customer Name or Customer Number is required.");
  }

  // Reuse a reserved job id across retries. leads.job_id is unique, so a repeat
  // attempt can only ever re-find this lead, never create a second one.
  const quoteFields = DonutQuote.fields(draft);
  const identity = JSON.stringify([draft.customerName.trim(), draft.customerNumber.trim(), draft.customerAddress.trim(), draft.serviceName.trim(), draft.serviceDetails.trim(), draft.scheduleRequirement.trim(), draft.quote.trim(), draft.terms, draft.leadStatus, draft.sourceUrl.trim(), draft.photos, quoteFields]);
  const stored = await chrome.storage.local.get([PENDING_JOB_KEY, PENDING_DRAFT_KEY]);
  if (stored[PENDING_JOB_KEY] && stored[PENDING_DRAFT_KEY] && stored[PENDING_DRAFT_KEY] !== identity) {
    throw new Error("A different draft still has a pending submission. Check the saved lead and clear this form before creating another.");
  }
  const jobId = stored[PENDING_JOB_KEY] || generateJobId();
  await reserveJobId(jobId, identity);

  const insertData = {
    job_id: jobId,
    customer_name: draft.customerName.trim(),
    customer_phone: draft.customerNumber.trim() || null,
    customer_schedule_requirements: draft.scheduleRequirement.trim() || null,
    direction: draft.direction === "outgoing" ? "outgoing" : "incoming",
    address: draft.customerAddress.trim() || null,
    number_name: draft.numberName.trim() || null,
    service_type: draft.serviceName.trim() || "General",
    service_details: draft.serviceDetails.trim() || null,
    reference_name: draft.referenceName.trim() || null,
    created_by: user.id,
    source_url: draft.sourceUrl.trim() || null
  };

  if (insertData.address) {
    try {
      const point = await geocodeCensusAddress(insertData.address);
      insertData.city = point?.city ?? null;
      insertData.state = point?.state ?? null;
      insertData.zip_code = point?.zip ?? null;
      insertData.latitude = point?.latitude ?? null;
      insertData.longitude = point?.longitude ?? null;
    } catch (error) {
      console.warn("Census geocoding failed; creating lead without map coordinates:", error);
      insertData.city = null;
      insertData.state = null;
      insertData.zip_code = null;
      insertData.latitude = null;
      insertData.longitude = null;
    }
  }

  const leadStatus = normalizeLeadStatus(draft.leadStatus);

  // Quote Pending to Send is not a status Customer Service may set directly.
  // Inside the CRM it files an approval request for a CS Admin, so it has to
  // here too, or the extension is a way around the approval. The lead is
  // created as Waiting Complete Details, which is also where it stays if the
  // request is declined. Anyone whose role is not known to be allowed to set
  // the status outright goes through approval as well, so a role lookup that
  // fails cannot reopen the gap.
  const { role: creatorRole } = await getUserProfile(user.id);
  const requestsQuoteApproval =
    leadStatus === "pending_to_send" && creatorRole !== "admin" && creatorRole !== "cs_admin";

  // A new lead is never inserted as urgent_job when the conversation check
  // applies. The check reads the stored record and looks it up by id, so there
  // is nothing to check before the row exists; the database gate rejects the
  // insert for the same reason. Create it in its ordinary status, then run the
  // check against the lead that now exists.
  //
  // Mirrors showsUrgentCheck() in src/lib/urgent-verification.ts. processor is
  // absent on purpose: they are not asked, and the database lets them insert
  // urgent_job directly.
  const urgentCheckApplies =
    leadStatus === "urgent_job" &&
    ["customer_service", "admin", "cs_admin"].includes(creatorRole);

  if (leadStatus !== "default") {
    if (requestsQuoteApproval || urgentCheckApplies) {
      // Withholding a status still has to name one. Leaving the field out falls
      // back to the column default, which the CRM's status filter need not
      // recognise, and the lead is then invisible there while this extension's
      // own lookup still finds it. AddLeadDialog parks a withheld lead here too.
      insertData.status = "waiting_complete_details";
    } else {
      insertData.status = leadStatus;
    }
  }

  const leadTerms = normalizeLeadTerms(draft.terms);
  if (leadTerms) {
    insertData.terms = leadTerms;
  }
  if (leadTerms === "quoted" && draft.quote.trim()) {
    insertData.quote = draft.quote.trim();
  }
  Object.assign(insertData, quoteFields);

  const insertController = new AbortController();
  const insertTimer = setTimeout(() => insertController.abort(), LEAD_INSERT_TIMEOUT_MS);

  let data = null;
  let insertError = null;
  try {
    const result = await supabaseClient
      .from("leads")
      .insert(insertData)
      .select()
      .single()
      .abortSignal(insertController.signal);
    data = result.data;
    insertError = result.error;
  } catch (networkError) {
    insertError = networkError;
  } finally {
    clearTimeout(insertTimer);
  }

  if (insertError || !data) {
    const message = insertError?.message || "The lead could not be saved.";
    const code = String(insertError?.code || "");
    const aborted = insertError?.name === "AbortError";
    const timedOut = aborted || /statement timeout|canceling statement/i.test(message);

    // Either the row landed and the response was lost, or it did not. Ask the
    // database before telling the user anything, because "failed" invites a
    // duplicate and "saved" must not be a guess.
    const existing = await findLeadByJobId(jobId, user.id);
    if (existing) {
      const sameCustomer = draft.customerNumber.trim()
        ? comparePhones(existing.customer_phone, draft.customerNumber)
        : existing.customer_name?.trim() === draft.customerName.trim();
      if (!sameCustomer) throw new Error("The reserved job ID belongs to another customer. Check Leads and clear the form before starting a new submission.");
      data = existing;
    } else if (code === "23505" || timedOut || aborted) {
      if (code !== "23505") {
        // Keep the reservation: the next attempt reuses this job id, so the
        // unique index still prevents a second lead for this capture.
        throw new Error(
          "The save did not finish, and we could not confirm whether this lead was created. Do not create it again — check Leads for this customer, then press Create Lead once more to finish the same lead."
        );
      }
      throw new Error("The reserved job ID already exists but its saved lead could not be read. Check Leads before retrying this same draft.");
    } else if (!code || /network|fetch|connection/i.test(message)) {
      throw new Error("The save outcome is unknown. Check Leads, then retry this same draft; its job ID is reserved to prevent duplicates.");
    } else {
      await releaseJobId(jobId);
      throw new Error(message);
    }
  }

  // Same RPC the CRM calls. The lead already exists and is parked safely in
  // Waiting Complete Details, so a failure here is reported rather than
  // thrown: throwing would read as "no lead created" and invite a duplicate.
  let quoteApprovalRequested = false;
  let quoteApprovalError = null;
  if (requestsQuoteApproval) {
    const { error: approvalError } = await supabaseClient.rpc("request_quote_approval", {
      _lead_id: data.id
    });
    if (approvalError) {
      quoteApprovalError = approvalError.message;
      console.error("Quote approval request failed:", approvalError);
    } else {
      quoteApprovalRequested = true;
    }
  }

  // Upload picked photos to Supabase storage and link in lead_photos table
  let photoUploadFailures = 0;
  if (draft.photos && draft.photos.length > 0) {
    for (const [photoIndex, photoUrl] of draft.photos.entries()) {
      try {
        const { data: existingPhoto, error: existingPhotoError } = await supabaseClient.from("lead_photos")
          .select("id").eq("lead_id", data.id).like("photo_url", `leads/${data.id}/capture-photo-${photoIndex}.%`).maybeSingle();
        if (existingPhotoError) throw existingPhotoError;
        if (existingPhoto) continue;
        const res = await fetch(photoUrl);
        if (!res.ok) { photoUploadFailures++; continue; }
        const blob = await res.blob();
        
        let ext = "jpg";
        const contentType = res.headers.get("content-type")?.split(";")[0].trim();
        if (contentType) {
          ext = contentType.split("/").pop();
          // Map binary jpeg subtype
          if (ext === "jpeg") ext = "jpg";
        } else {
          const match = photoUrl.match(/\.([^./?#]+)($|\?|#)/);
          if (match) ext = match[1];
        }
        
        const path = `leads/${data.id}/capture-photo-${photoIndex}.${ext.replace(/[^a-z0-9]/gi, "")}`;
        const { error: uploadError } = await supabaseClient.storage
          .from("lead-photos")
          .upload(path, blob, {
            contentType: contentType || "image/jpeg"
          });
          
        if (!uploadError || String(uploadError.statusCode) === "409") {
          const { error: linkError } = await supabaseClient.from("lead_photos").insert({
            lead_id: data.id,
            photo_url: path,
            uploaded_by: user.id
          });
          if (linkError) { photoUploadFailures++; await supabaseClient.storage.from("lead-photos").remove([path]); }
        } else {
          photoUploadFailures++;
          console.error("Storage upload failed:", uploadError);
        }
      } catch (err) {
        photoUploadFailures++;
        console.error("Failed to upload chat picture:", err);
      }
    }
  }

  // The same conversation check the CRM runs, against the lead that now exists.
  // check-urgent-lead reads the customer's conversation from quo_conversations
  // and compares it to the stored record, so there is nothing to read off the
  // page here: one edge function, one prompt, the same findings either way.
  let urgentCheck = null;
  if (urgentCheckApplies) {
    urgentCheck = await runUrgentCheck(data.id);
  }

  const settings = await getSettings();
  const leadUrl = settings.apiBaseUrl ? `${settings.apiBaseUrl}/leads/${data.id}` : null;
  // Links straight into the conversation review, so a lead the check could not
  // clear does not leave the CS member hunting for the status dropdown again.
  const urgentReviewUrl = leadUrl ? `${leadUrl}?urgentCheck=1` : null;

  return {
    success: true,
    payload: insertData,
    quoteApprovalRequested,
    quoteApprovalError,
    photoUploadFailures,
    // Urgent was asked for and withheld at insert. Saying so beats reporting a
    // plain success for a request that did not happen.
    urgentCheckRequired: urgentCheckApplies,
    urgentCheck,
    response: {
      leadUrl,
      urgentReviewUrl,
      lead: data
    }
  };
}

/**
 * Run the conversation check against a stored lead, and mark it urgent when the
 * check comes back clean.
 *
 * Returns what the panel needs to say, never throws: the lead is already saved,
 * and a check that could not run is not a reason to report the creation as
 * failed. { state, issues, summary, applied, error }.
 */
async function runUrgentCheck(leadId) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("check-urgent-lead", {
      body: { leadId }
    });

    if (error) {
      return { state: "error", issues: [], summary: "", applied: false, error: error.message };
    }

    const issues = Array.isArray(data?.issues) ? data.issues : [];
    const fixes = Array.isArray(data?.fixes) ? data.fixes : [];
    const flags = Array.isArray(data?.flags) ? data.flags : [];
    const summary = typeof data?.summary === "string" ? data.summary : "";
    const notice = typeof data?.notice === "string" ? data.notice : "";

    // "Could not verify" is not "found a problem", and neither is a pass. The
    // function says which it is in `verification`; anything but "checked" means
    // nothing was actually compared, whether the conversation was missing or
    // the model call timed out.
    if (data?.verification !== "checked") {
      return { state: "unavailable", issues, summary, applied: false, error: null, notice };
    }

    if (!data?.clean) {
      // The latest-agreement review reports corrections and missing details, not
      // only contradiction issues. Count both so the panel never says "found 0".
      const total = issues.length + fixes.length + flags.length;
      return { state: "issues", issues, fixes, flags, summary, applied: false, error: null, notice, total };
    }

    // Clean. Record the verification, which is what lets the lead through the
    // database gate, exactly as applyUrgentVerification() does in the CRM.
    const { error: applyError } = await supabaseClient.rpc("approve_urgent_verification", {
      p_lead_id: leadId,
      p_ai_summary: summary || null,
      p_ai_model: "gpt-4o-mini"
    });

    if (applyError) {
      // The check passed; recording it did not. Reporting this as findings would
      // claim the conversation disagreed with the lead, which it did not.
      return { state: "error", issues: [], summary, applied: false, error: applyError.message };
    }

    return { state: "clean", issues, summary, applied: true, error: null };
  } catch (err) {
    return {
      state: "error",
      issues: [],
      summary: "",
      applied: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// Helper for robust phone number comparison (ignores formatting, country codes, and extensions)
function comparePhones(phone1, phone2) {
  if (!phone1 || !phone2) return false;
  const p1 = phone1.trim().replace(/[()+\-\s]/g, '');
  const p2 = phone2.trim().replace(/[()+\-\s]/g, '');
  
  const getSig = (p) => {
    if (p.startsWith("1") && p.length >= 11) {
      return p.slice(1);
    }
    return p;
  };
  
  const s1 = getSig(p1);
  const s2 = getSig(p2);
  
  if (s1 === s2) return true;
  
  // Compare the main 10 digits of both significant numbers
  if (s1.length >= 10 && s2.length >= 10) {
    const main1 = s1.slice(0, 10);
    const main2 = s2.slice(0, 10);
    if (main1 === main2) return true;
  }
  
  return false;
}

// Check if lead with phone number exists in CRM (case/format insensitive)
async function checkLeadExists(phone) {
  if (!phone) {
    return { success: true, exists: false };
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    throw new Error("You must be logged in to check leads.");
  }

  const trimmed = phone.trim();
  const cleaned = trimmed.replace(/[()+\-\s]/g, '');

  if (cleaned.length < 4) {
    return { success: true, exists: false };
  }

  // Get the last 4 digits to find potential matches robustly in Postgres
  const trailingDigits = cleaned.slice(-4);

  const { data, error } = await supabaseClient
    .from("leads")
    .select("id, job_id, customer_name, customer_phone, status, created_at, service_type, address, customer_schedule_requirements")
    .neq("status", "cancelled")
    .ilike("customer_phone", `%${trailingDigits}%`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  // Filter candidates locally for robust phone number matching
  const matchingLeads = (data || []).filter(lead => {
    return comparePhones(lead.customer_phone, phone);
  });

  if (matchingLeads.length > 0) {
    return {
      success: true,
      exists: true,
      leads: matchingLeads
    };
  }

  return {
    success: true,
    exists: false
  };
}

// Replace the schedule requirement on one checked, non-cancelled lead.
async function updateLeadScheduleRequirement(leadId, requestedScheduleRequirement, checkedPhone) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    throw new Error("You must be logged in to update a lead.");
  }

  const id = String(leadId || "").trim();
  if (!id) {
    throw new Error("Select an existing lead before updating the schedule requirement.");
  }

  const draft = await getDraft();
  const scheduleRequirement = String(
    requestedScheduleRequirement ?? draft.scheduleRequirement ?? ""
  ).trim();
  if (!scheduleRequirement) {
    throw new Error("Schedule Requirement is required.");
  }

  const { data: existingLead, error: lookupError } = await supabaseClient
    .from("leads")
    .select("id, job_id, customer_name, customer_phone, status")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(lookupError.message);
  }
  if (!existingLead) {
    throw new Error("The selected lead no longer exists or you do not have access to it.");
  }
  if (existingLead.status === "cancelled") {
    throw new Error("Cancelled leads cannot be updated from the extension.");
  }
  if (checkedPhone && !comparePhones(existingLead.customer_phone, checkedPhone)) {
    throw new Error("The selected lead no longer matches the checked customer number. Check Lead again.");
  }

  const { data: updatedLead, error: updateError } = await supabaseClient
    .from("leads")
    .update({ customer_schedule_requirements: scheduleRequirement })
    .eq("id", id)
    .select("id, job_id, customer_name, customer_phone, status, customer_schedule_requirements")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  const settings = await getSettings();
  const leadUrl = settings.apiBaseUrl
    ? `${settings.apiBaseUrl.replace(/\/$/, "")}/leads/${updatedLead.id}`
    : null;

  return {
    success: true,
    response: {
      leadUrl,
      lead: updatedLead
    }
  };
}

// Get Report Stats for Current User
async function getExtensionReport(dateFrom, dateTo) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    throw new Error("User not authenticated.");
  }

  // Default: last 7 days
  const now = new Date();
  let fromDate, toDate;

  if (dateFrom) {
    fromDate = new Date(dateFrom);
    fromDate.setHours(0, 0, 0, 0);
  } else {
    fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 6);
    fromDate.setHours(0, 0, 0, 0);
  }

  if (dateTo) {
    toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);
  } else {
    toDate = new Date();
    toDate.setHours(23, 59, 59, 999);
  }

  // Clamp to 90-day max window
  const MAX_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  if (toDate - fromDate > MAX_DAYS_MS) {
    fromDate = new Date(toDate.getTime() - MAX_DAYS_MS);
    fromDate.setHours(0, 0, 0, 0);
  }

  // FIX: Filter by created_by (logged-in user) + source_url not null
  // (all leads captured via extension have a source_url set — this correctly
  //  identifies extension leads without relying on the free-text reference_name field).
  const { data, error } = await supabaseClient
    .from("leads")
    .select("id, job_id, customer_name, customer_phone, created_at, status, service_type, address, source_url")
    .eq("created_by", user.id)
    .not("source_url", "is", null)
    .gte("created_at", fromDate.toISOString())
    .lte("created_at", toDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(error.message);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  let todayCount = 0;
  let yesterdayCount = 0;
  let totalCount = 0;
  let activeCount = 0;
  let urgentCount = 0;
  let cancelledCount = 0;

  const URGENT_STATUSES = new Set(["urgent_job", "need_tech"]);
  const CANCELLED_STATUSES = new Set(["cancelled"]);
  const ACTIVE_STATUSES = new Set(["default", "pending_to_send", "quote_sent_waiting", "scheduled"]);

  const leads = data || [];
  totalCount = leads.length;

  leads.forEach((lead) => {
    const createdDate = new Date(lead.created_at);
    if (createdDate >= today) {
      todayCount++;
    } else if (createdDate >= yesterday && createdDate < today) {
      yesterdayCount++;
    }

    const s = lead.status || "default";
    if (URGENT_STATUSES.has(s)) {
      urgentCount++;
    } else if (CANCELLED_STATUSES.has(s)) {
      cancelledCount++;
    } else if (ACTIVE_STATUSES.has(s) || s === "default") {
      activeCount++;
    }
  });

  const history = leads.map(lead => ({
    id: lead.id,
    jobId: lead.job_id,
    customerName: lead.customer_name,
    customerPhone: lead.customer_phone,
    serviceType: lead.service_type,
    address: lead.address,
    createdAt: lead.created_at,
    status: lead.status,
    sourceUrl: lead.source_url
  }));

  return {
    success: true,
    todayCount,
    yesterdayCount,
    totalCount,
    activeCount,
    urgentCount,
    cancelledCount,
    history,
    dateFrom: fromDate.toISOString(),
    dateTo: toDate.toISOString()
  };
}


// Phone formatting helper
function formatPhoneNumber(value) {
  if (!value) return "";
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "");
  
  if (digits.length === 0) {
    return hasPlus ? "+" : "";
  }
  
  const prefix = hasPlus ? "+" : "";
  
  if (hasPlus) {
    if (digits.length <= 3) {
      return prefix + digits;
    }
    if (digits.length <= 7) {
      return `${prefix}${digits.slice(0, 2)} ${digits.slice(2)}`;
    }
    if (digits.length <= 10) {
      return `${prefix}${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
    }
    return `${prefix}${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6, 10)} ${digits.slice(10)}`;
  }
  
  if (digits.startsWith("1")) {
    if (digits.length <= 1) {
      return "1";
    }
    if (digits.length <= 4) {
      return `1 (${digits.slice(1)}`;
    }
    if (digits.length <= 7) {
      return `1 (${digits.slice(1, 4)}) ${digits.slice(4)}`;
    }
    if (digits.length <= 11) {
      return `1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return `1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)} ext. ${digits.slice(11)}`;
  }
  
  if (digits.length <= 3) {
    return `(${digits}`;
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)} ext. ${digits.slice(10)}`;
}

let preparingPhotos = false;
async function handleQuoPreparePhotos(message) {
  if (preparingPhotos) return { success: false, error: "Another photo request is still being prepared." };
  try {
    const chat = new URL(message.chatUrl);
    if (chat.origin !== "https://my.quo.com" || !/^\/inbox\/[^/]+\/c\/[^/]+\/?$/.test(chat.pathname)) {
      throw new Error("An exact technician conversation is required.");
    }
    if (!Array.isArray(message.photoUrls) || !message.photoUrls.length) throw new Error("No photos supplied.");
    for (const value of message.photoUrls) {
      const url = new URL(value);
      if (url.origin !== "https://kxiqholnmhkwhdkhtopp.supabase.co" || !url.pathname.startsWith("/storage/v1/object/sign/lead-photos/")) {
        throw new Error("Only signed CRM lead photos can be attached.");
      }
    }
    preparingPhotos = true;
    return await handleQuoSendMessage(message);
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    preparingPhotos = false;
  }
}

async function handleQuoSendMessage(message) {
  const { chatUrl, message: chatMessage, scheduleTime, photoUrls } = message;
  
  if (!chatUrl || (!chatMessage && !photoUrls?.length)) {
    return { success: false, error: "Missing chatUrl or message." };
  }

  const tabs = await chrome.tabs.query({ url: ["https://my.quo.com/*", "https://quo.com/*"] });
  const matchingTab = tabs.find((tab) => tab.id && isTabOnTargetChat(tab.url, chatUrl));
  const fallbackTab = [...tabs]
    .filter((tab) => tab.id)
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  let tab = matchingTab || fallbackTab;
  let newTab = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: chatUrl, active: false });
    newTab = true;
  } else if (!matchingTab) {
    // A full background navigation is deliberate here. SPA navigation could
    // retain the previous chat's composer and send the message to the wrong CX.
    tab = await chrome.tabs.update(tab.id, { url: chatUrl });
  }

  if (!tab?.id) return { success: false, error: "Could not open the requested Quo chat." };
  const hasExactConversation = !!conversationIdFromUrl(chatUrl);

  // Exact conversation URLs are safe to handle as soon as the new page's
  // content script is available. The content script verifies the conversation
  // ID before touching the composer, so we do not need to wait for unrelated
  // images, analytics and other page resources to finish loading.
  if (!hasExactConversation) {
    await waitForTabComplete(tab.id, 25000);
  }
  const result = await sendMessageWithRetry(tab.id, {
    type: photoUrls ? "PREPARE_PHOTOS" : "NAVIGATE_AND_SEND_MESSAGE",
    chatUrl,
    message: chatMessage,
    scheduleTime,
    photoUrls,
    navigationPrepared: true
  }, hasExactConversation ? 40 : 15);
  if (photoUrls && result?.success) await chrome.tabs.update(tab.id, { active: true });
  return { ...result, newTab };
}

async function handleQuoPrepareChat(message) {
  const { chatUrl } = message;
  if (!chatUrl) return { success: false, error: "Missing chatUrl." };

  const tabs = await chrome.tabs.query({ url: ["https://my.quo.com/*", "https://quo.com/*"] });
  const matchingTab = tabs.find((tab) => tab.id && isTabOnTargetChat(tab.url, chatUrl));
  if (matchingTab?.id) return { success: true, ready: true };

  const fallbackTab = [...tabs]
    .filter((tab) => tab.id)
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  if (fallbackTab?.id) {
    await chrome.tabs.update(fallbackTab.id, { url: chatUrl });
    return { success: true, ready: false };
  }

  await chrome.tabs.create({ url: chatUrl, active: false });
  return { success: true, ready: false };
}

function normalizedPhoneFromUrl(value) {
  try { return (new URL(value).searchParams.get("phone") || "").replace(/\D/g, ""); }
  catch (e) { return ""; }
}

function conversationIdFromUrl(value) {
  try {
    const match = new URL(value).pathname.match(/\/c\/([^/?#]+)/);
    return match ? match[1] : "";
  } catch (e) { return ""; }
}

function isTabOnTargetChat(currentUrl, targetUrl) {
  const targetConversationId = conversationIdFromUrl(targetUrl);
  if (targetConversationId) return conversationIdFromUrl(currentUrl) === targetConversationId;
  const targetPhone = normalizedPhoneFromUrl(targetUrl);
  return !!targetPhone && normalizedPhoneFromUrl(currentUrl) === targetPhone;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      error ? reject(error) : resolve();
    };
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === "complete") finish();
    };
    const onRemoved = (removedId) => {
      if (removedId === tabId) finish(new Error("The Quo tab was closed before the chat loaded."));
    };
    const timer = setTimeout(() => finish(new Error("Timed out while opening the requested Quo chat.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then((current) => {
      if (current?.status === "complete") finish();
    }).catch((error) => finish(error));
  });
}
async function sendMessageWithRetry(tabId, message, maxRetries = 15) {
  let lastRetryableResponse = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await new Promise((resolve, reject) => {
        // Only the top Quo page owns inbox navigation. Sending to every frame
        // can return an iframe's "no editor" response before the page has a
        // chance to select the requested customer conversation.
        chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (resp) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(resp);
        });
      });
      if (response?.success) return response;
      if (response?.retryable) {
        lastRetryableResponse = response;
      } else if (response && response.success !== undefined) {
        return response;
      }
    } catch (error) {
      console.log("Quo CRM Extension: Content script not ready, retrying...", i);
    }
    // Retry quickly during normal React startup, then back off. This removes
    // the previous average half-second wait without busy-looping on slow loads.
    const retryDelay = i < 10 ? 150 : i < 20 ? 300 : 750;
    await new Promise(r => setTimeout(r, retryDelay));
  }
  console.warn("Quo CRM Extension: Could not reach a ready Quo composer after retries.");
  return lastRetryableResponse || {
    success: false,
    error: "Could not find message input editor after waiting for the Quo chat to load."
  };
}
