
function friendlyExpectedAreaName(rawArea, state) {
  const raw = String(rawArea || "").trim().toUpperCase();

  const exactAliases = {
    "BRBN BRBN": "Burbank",
    "CHICGOZN01": "Chicago",
    "CHICGOZN02": "Chicago",
    "CHICGOZN03": "Chicago",
    "CHICGOZN04": "Chicago",
    "IGNACIO": "Ignacio",
    "LA JOLLA": "La Jolla",
    "STOCKTON": "Stockton"
  };

  if (exactAliases[raw]) return exactAliases[raw];

  // Hide unusable telecom/service labels rather than showing ugly raw codes.
  const blockedPatterns = [
    /^X+$/,
    /^N\/?A$/,
    /^NONE$/,
    /^UNKNOWN$/,
    /^UNAVAILABLE$/,
    /^DIR\s*ASST$/,
    /^DIRECTORY/,
    /^TEST/,
    /^INFORMATION$/,
    /^OPERATOR$/,
    /^SPECIAL/,
    /^MOBILE$/,
    /^CELLULAR$/,
    /^WIRELESS$/,
    /^PAGING$/
  ];

  if (blockedPatterns.some((pattern) => pattern.test(raw))) {
    return "";
  }

  // Common telecom zone suffixes: CHICGOZN01 -> Chicago (fallback heuristic).
  const zoneMatch = raw.match(/^([A-Z ]+?)ZN\d+$/);
  if (zoneMatch) {
    const base = zoneMatch[1].replace(/\s+/g, " ").trim();
    const zoneAliases = {
      "CHICGO": "Chicago",
      "NYC": "New York",
      "LOSANGELS": "Los Angeles",
      "SANFRAN": "San Francisco"
    };
    if (zoneAliases[base]) return zoneAliases[base];
  }

  // Collapse duplicated tokens such as "BRBN BRBN".
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && parts[0] === parts[1]) {
    const duplicateAliases = {
      "BRBN": "Burbank"
    };
    if (duplicateAliases[parts[0]]) return duplicateAliases[parts[0]];
  }

  // Generic title-case fallback for clean human-readable rate-center names.
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


const US_STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico", VI: "U.S. Virgin Islands",
  GU: "Guam", AS: "American Samoa"
};

function fullStateName(state) {
  const code = String(state || "").trim().toUpperCase();
  return US_STATE_NAMES[code] || code;
}

const EDITABLE_FIELDS = [
  "customerName",
  "customerNumber",
  "customerAddress",
  "numberName",
  "serviceName",
  "referenceName",
  "serviceDetails",
  "direction",
  "leadStatus",
  "terms",
  "quote",
  "laborAmount",
  "materialsIncluded",
  "materialAmount",
  "scheduleRequirement"
];

const ADDRESS_PROVIDER_NAME = "US Census Geocoder";
const ADDRESS_MIN_QUERY_LENGTH = 5;
const ADDRESS_DEBOUNCE_MS = 350;

// Theme UI elements & logic
const themeToggleBtn = document.getElementById("theme-toggle-btn");

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  if (themeToggleBtn) {
    themeToggleBtn.setAttribute("aria-checked", isDark ? "true" : "false");
    themeToggleBtn.setAttribute("title", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
  }
}

async function initTheme() {
  try {
    const data = await chrome.storage.local.get({ theme: "light" });
    applyTheme(data.theme || "light");
  } catch (e) {
    applyTheme("light");
  }
}

async function handleThemeToggle() {
  const currentTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(newTheme);
  try {
    await chrome.storage.local.set({ theme: newTheme });
  } catch (e) {
    console.debug("Failed to persist theme:", e);
  }
}

// Immediately apply theme on script execution to avoid flashing
initTheme();

// Lead capture UI elements
const form = document.getElementById("lead-form");
const feedback = document.getElementById("feedback");
const clearButton = document.getElementById("clear-form");
const createLeadButton = document.getElementById("create-lead");
const autoPickDirectionBtn = document.getElementById("auto-pick-direction");
const autoPickNumberBtn = document.getElementById("auto-pick-number");
const autoPickNumberNameBtn = document.getElementById("auto-pick-number-name");
const autoPickServiceNameBtn = document.getElementById("auto-pick-service-name");
const checkCrmNumberBtn = document.getElementById("check-crm-number");
const checkLeadFeedback = document.getElementById("check-lead-feedback");
const matchingLeadsContainer = document.getElementById("matching-leads");
const matchingLeadsTitle = document.getElementById("matching-leads-title");
const matchingLeadsList = document.getElementById("matching-leads-list");
const updateScheduleRequirementBtn = document.getElementById("update-schedule-requirement");
const autoPickPhotosBtn = document.getElementById("auto-pick-photos");
const findAddressBtn = document.getElementById("find-address");
const coveragePreview = document.getElementById("coverage-preview");
const checkExpectedAreaBtn = document.getElementById("check-expected-area");
const expectedAreaResult = document.getElementById("expected-area-result");
const photosPreviewContainer = document.getElementById("photos-preview-container");
const noPhotosLabel = document.getElementById("no-photos-label");
const photoLightbox = document.getElementById("photo-lightbox");
const photoLightboxImage = document.getElementById("photo-lightbox-image");
const photoLightboxCounter = document.getElementById("photo-lightbox-counter");
const photoLightboxClose = document.getElementById("photo-lightbox-close");
const photoLightboxPrev = document.getElementById("photo-lightbox-prev");
const photoLightboxNext = document.getElementById("photo-lightbox-next");
const photoLightboxStage = photoLightbox?.querySelector(".photo-lightbox__stage");
const addressSuggestions = document.getElementById("address-suggestions");
const addressSuggestionsStatus = document.getElementById("address-suggestions-status");
const addressSuggestionsList = document.getElementById("address-suggestions-list");
const quoteField = document.getElementById("quote-field");

// Auth UI elements
const loginContainer = document.getElementById("login-container");
const leadCaptureContainer = document.getElementById("lead-capture-container");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const userSessionBar = document.getElementById("user-session-bar");
const userSessionEmail = document.getElementById("user-session-email");
const logoutBtn = document.getElementById("logout-btn");

// Tab Navigation elements
const tabBtnCapture = document.getElementById("tab-btn-capture");
const tabBtnReports = document.getElementById("tab-btn-reports");
const viewCapture = document.getElementById("view-capture");
const viewReports = document.getElementById("view-reports");

// Reports UI elements
const reportTodayCount = document.getElementById("report-today-count");
const reportYesterdayCount = null; // replaced by status strip
const reportHistoryList = document.getElementById("report-history-list");
const exportReportBtn = document.getElementById("export-report-btn");
const reportStatusStrip = document.getElementById("report-status-strip");
const reportTotalCount = document.getElementById("report-total-count");
const reportUrgentCount = document.getElementById("report-urgent-count");
const reportCancelledCount = document.getElementById("report-cancelled-count");
const reportLoading = document.getElementById("report-loading");
const reportDateFrom = document.getElementById("report-date-from");
const reportDateTo = document.getElementById("report-date-to");
const loadReportBtn = document.getElementById("load-report-btn");
const reportQuickPills = document.querySelectorAll(".report-pill");


let currentDraft = null;
let addressSuggestionTimer = null;
let coveragePreviewTimer = null;
let coveragePreviewRequest = 0;
let suppressAddressLookup = false;
let npaNxxDatabasePromise = null;
let checkedLeads = [];
let selectedCheckedLeadId = "";
let checkedPhone = "";
let leadCheckCompleted = false;
let leadCheckSequence = 0;
let scheduleUpdateInProgress = false;
let reportDateFromState = "";
let reportDateToState = "";
let currentReportHistory = [];
let activeChatSyncToken = 0;
let activeChatSyncTimer = null;
let lightboxPhotos = [];
let lightboxPhotoIndex = 0;
let lightboxReturnFocus = null;


initialize();

async function initialize() {
  // Bind Theme Toggle
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", handleThemeToggle);
  }

  // Bind Tab Navigation
  if (tabBtnCapture && tabBtnReports) {
    tabBtnCapture.addEventListener("click", () => switchTab("capture"));
    tabBtnReports.addEventListener("click", () => switchTab("reports"));
  }

  // Bind Report quick-select pills
  reportQuickPills.forEach((pill) => {
    pill.addEventListener("click", () => handleReportPillClick(pill));
  });

  // Bind custom date range Load button
  if (loadReportBtn) {
    loadReportBtn.addEventListener("click", handleLoadReportClick);
  }


  // Bind Auth events
  loginForm.addEventListener("submit", handleLoginSubmit);
  logoutBtn.addEventListener("click", handleLogout);

  // Check initial authentication
  const authResponse = await chrome.runtime.sendMessage({ type: "CHECK_AUTH" });
  if (authResponse && authResponse.success) {
    await showLeadCaptureUI(authResponse);
  } else {
    showLoginUI();
  }

  if (exportReportBtn) {
    exportReportBtn.addEventListener("click", handleExportReport);
  }

  // Listen to both input and change events to support immediate radio button syncing
  form.addEventListener("input", handleFormInput);
  form.addEventListener("change", handleFormInput);
  form.addEventListener("submit", handleCreateLead);
  clearButton.addEventListener("click", handleClearForm);
  if (autoPickDirectionBtn) {
    autoPickDirectionBtn.addEventListener("click", handleAutoPickDirection);
  }
  autoPickNumberBtn.addEventListener("click", handleAutoPickNumber);
  autoPickNumberNameBtn.addEventListener("click", handleAutoPickNumberName);
  if (autoPickServiceNameBtn) {
    autoPickServiceNameBtn.addEventListener("click", handleAutoPickServiceName);
  }
  if (checkCrmNumberBtn) {
    checkCrmNumberBtn.addEventListener("click", handleCheckCrmNumber);
  }
  if (updateScheduleRequirementBtn) {
    updateScheduleRequirementBtn.addEventListener("click", handleUpdateScheduleRequirement);
  }
  if (autoPickPhotosBtn) {
    autoPickPhotosBtn.addEventListener("click", handleAutoPickPhotos);
  }
  if (photoLightboxClose) {
    photoLightboxClose.addEventListener("click", closePhotoLightbox);
  }
  if (photoLightboxPrev) {
    photoLightboxPrev.addEventListener("click", () => movePhotoLightbox(-1));
  }
  if (photoLightboxNext) {
    photoLightboxNext.addEventListener("click", () => movePhotoLightbox(1));
  }
  if (photoLightbox) {
    photoLightbox.addEventListener("click", handlePhotoLightboxBackdropClick);
  }
  document.addEventListener("keydown", handlePhotoLightboxKeydown);
  if (findAddressBtn) {
    findAddressBtn.addEventListener("click", handleFindAddressClick);
  }
  if (checkExpectedAreaBtn) {
    checkExpectedAreaBtn.addEventListener("click", handleCheckExpectedArea);
  }

  // Automatic and silent URL tracking as tab updates or changes
  await handleAutoPickUrlSilently();
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onActivated.addListener(handleTabActivated);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "QUO_CHAT_CHANGED") {
      scheduleActiveQuoChatSync();
    } else if (message?.type === "DRAFT_UPDATED" && message.draft) {
      const previousPhone = currentDraft?.customerNumber || "";
      currentDraft = message.draft;
      renderDraft(currentDraft);
      invalidateLeadCheckWhenPhoneChanges(previousPhone, currentDraft.customerNumber);
      updateScheduleRequirementButtonState();
      showFeedback("Draft updated from selected text.", "info");
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.theme && changes.theme.newValue) {
      applyTheme(changes.theme.newValue);
    }

    if (changes.leadDraft?.newValue) {
      const previousPhone = currentDraft?.customerNumber || "";
      currentDraft = changes.leadDraft.newValue;
      renderDraft(currentDraft);
      invalidateLeadCheckWhenPhoneChanges(previousPhone, currentDraft.customerNumber);
      updateScheduleRequirementButtonState();
    }
  });

  if (addressSuggestionsList) {
    addressSuggestionsList.addEventListener("click", handleAddressSuggestionClick);
  }
}

function showLoginUI() {
  loginContainer.hidden = false;
  leadCaptureContainer.hidden = true;
  userSessionBar.hidden = true;
  resetLeadCheckState();
  clearFeedback();
}

async function showLeadCaptureUI(authResponse) {
  loginContainer.hidden = true;
  leadCaptureContainer.hidden = false;
  userSessionBar.hidden = false;
  
  const displayEmail = authResponse.fullName || authResponse.user?.email || "Authenticated";
  userSessionEmail.textContent = displayEmail;
  userSessionEmail.title = authResponse.user?.email || "";

  switchTab("capture");
  clearFeedback();
  await loadDraft();
  // Reports will load when the user clicks the tab
}

function switchTab(tabName) {
  if (tabName === "capture") {
    if (tabBtnCapture) tabBtnCapture.classList.add("active");
    if (tabBtnReports) tabBtnReports.classList.remove("active");
    if (viewCapture) viewCapture.classList.add("active");
    if (viewReports) viewReports.classList.remove("active");
  } else {
    if (tabBtnReports) tabBtnReports.classList.add("active");
    if (tabBtnCapture) tabBtnCapture.classList.remove("active");
    if (viewReports) viewReports.classList.add("active");
    if (viewCapture) viewCapture.classList.remove("active");
    // Set default 7-day range if not already set
    initReportDateDefaults();
    loadReports(reportDateFromState, reportDateToState);
  }
}


async function loadDraft() {
  const response = await chrome.runtime.sendMessage({ type: "GET_DRAFT" });
  currentDraft = response.draft;
  renderDraft(currentDraft);
  updateScheduleRequirementButtonState();
}


async function loadNpaNxxDatabase() {
  if (!npaNxxDatabasePromise) {
    npaNxxDatabasePromise = fetch(chrome.runtime.getURL("data/npa-nxx.json"))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Prefix database could not be loaded (${response.status}).`);
        }
        return response.json();
      })
      .catch((error) => {
        npaNxxDatabasePromise = null;
        throw error;
      });
  }

  return npaNxxDatabasePromise;
}

function normalizeUsPhoneForAreaLookup(value) {
  let digits = String(value || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  return digits;
}

function renderExpectedAreaResult(message, type = "success") {
  if (!expectedAreaResult) return;
  expectedAreaResult.hidden = false;
  expectedAreaResult.className = `expected-area-result expected-area-result--${type}`;
  expectedAreaResult.textContent = message;
}

async function handleCheckExpectedArea() {
  const phoneValue = form?.customerNumber?.value || "";
  const digits = normalizeUsPhoneForAreaLookup(phoneValue);

  if (digits.length < 6) {
    renderExpectedAreaResult("Enter a valid US phone number first.", "error");
    return;
  }

  const prefix = digits.slice(0, 6);

  checkExpectedAreaBtn.disabled = true;
  const originalHtml = checkExpectedAreaBtn.innerHTML;
  checkExpectedAreaBtn.innerHTML = `<span>Checking...</span>`;
  renderExpectedAreaResult(`Checking ${prefix.slice(0, 3)}-${prefix.slice(3)}...`, "loading");

  try {
    const database = await loadNpaNxxDatabase();
    const exact = database?.prefixes?.[prefix];

    if (exact) {
      const area = friendlyExpectedAreaName(exact.city || exact.rateCenter, exact.state);
      const state = fullStateName(exact.state);

      if (area && state) {
        renderExpectedAreaResult(`${area}, ${state}`, "success");
        return;
      }

      if (state) {
        renderExpectedAreaResult(`Area unavailable, ${state}`, "warning");
        return;
      }
    }

    // Keep this as an exact 6-digit lookup. Do not guess from the 3-digit area code.
    renderExpectedAreaResult(`Exact area not found for ${prefix.slice(0, 3)}-${prefix.slice(3)}.`, "warning");
  } catch (error) {
    renderExpectedAreaResult(error.message || "Could not check expected area.", "error");
  } finally {
    checkExpectedAreaBtn.disabled = false;
    checkExpectedAreaBtn.innerHTML = originalHtml;
  }
}

// Authentication Logic
async function handleLoginSubmit(event) {
  event.preventDefault();
  clearFeedback();
  loginBtn.disabled = true;
  const originalText = loginBtn.innerHTML;
  loginBtn.innerHTML = `<span>Signing In...</span>`;

  try {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    const response = await chrome.runtime.sendMessage({
      type: "LOGIN",
      email,
      password
    });

    if (!response || !response.success) {
      throw new Error(response?.error || "Login failed. Check your credentials.");
    }

    await showLeadCaptureUI(response);
    await handleAutoPickUrlSilently();
  } catch (error) {
    showFeedback(error.message || "Authentication failed.", "error");
  } finally {
    loginBtn.disabled = false;
    loginBtn.innerHTML = originalText;
  }
}

async function handleLogout() {
  clearFeedback();
  try {
    await chrome.runtime.sendMessage({ type: "LOGOUT" });
    loginPassword.value = "";

    // Clear reports cache & state
    await chrome.storage.local.remove("extensionReportCache");
    currentReportHistory = [];
    reportDateFromState = "";
    reportDateToState = "";
    if (reportTodayCount) reportTodayCount.textContent = "0";
    if (reportTotalCount) reportTotalCount.textContent = "0";
    if (reportUrgentCount) reportUrgentCount.textContent = "0";
    if (reportCancelledCount) reportCancelledCount.textContent = "0";
    if (reportStatusStrip) reportStatusStrip.hidden = true;
    if (reportHistoryList) {
      reportHistoryList.innerHTML = `<li class="history-empty">No recent extension leads.</li>`;
    }


    showLoginUI();
  } catch (error) {
    showFeedback("Logout failed: " + error.message, "error");
  }
}

async function handleExportReport() {
  clearFeedback();
  try {
    if (!currentReportHistory || currentReportHistory.length === 0) {
      throw new Error("No leads in the current view to export. Load a report first.");
    }

    const headers = ["Captured At", "Job ID", "Customer Name", "Customer Phone", "Service", "Status", "Source URL"];
    const rows = currentReportHistory.map((lead) => [
      lead.createdAt ? formatCapturedAt(lead.createdAt) : "",
      lead.jobId || "",
      lead.customerName || "",
      lead.customerPhone || "",
      lead.serviceType || "",
      lead.status || "",
      lead.sourceUrl || ""
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((val) => `"${String(val).replaceAll('"', '""')}"`).join(",")
      )
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const dateLabel = reportDateFromState && reportDateToState
      ? `${reportDateFromState}_to_${reportDateToState}`
      : new Date().toISOString().slice(0, 10);
    const filename = `extension_leads_${dateLabel}.csv`;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showFeedback(`Exported ${currentReportHistory.length} lead(s) to CSV.`, "success");
  } catch (error) {
    showFeedback("Export failed: " + error.message, "error");
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function initReportDateDefaults() {
  // Only set defaults if not already set
  if (reportDateFromState && reportDateToState) return;
  applyReportRange("7d");
}

function applyReportRange(range) {
  const today = new Date();
  let from, to;

  if (range === "today") {
    from = new Date(today);
    to = new Date(today);
  } else if (range === "yesterday") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    from = y;
    to = new Date(y);
  } else if (range === "7d") {
    from = new Date(today);
    from.setDate(from.getDate() - 6);
    to = new Date(today);
  } else if (range === "30d") {
    from = new Date(today);
    from.setDate(from.getDate() - 29);
    to = new Date(today);
  } else {
    return;
  }

  reportDateFromState = toLocalISODate(from);
  reportDateToState = toLocalISODate(to);

  if (reportDateFrom) reportDateFrom.value = reportDateFromState;
  if (reportDateTo) reportDateTo.value = reportDateToState;
}

function handleReportPillClick(pill) {
  // Update active state on pills
  reportQuickPills.forEach((p) => p.classList.remove("report-pill--active"));
  pill.classList.add("report-pill--active");

  const range = pill.dataset.range;
  applyReportRange(range);
  loadReports(reportDateFromState, reportDateToState);
}

function handleLoadReportClick() {
  const from = reportDateFrom?.value;
  const to = reportDateTo?.value;

  if (!from || !to) {
    showFeedback("Please select both From and To dates.", "error");
    return;
  }
  if (from > to) {
    showFeedback("From date must be before or equal to To date.", "error");
    return;
  }

  // Deactivate all quick pills (custom range)
  reportQuickPills.forEach((p) => p.classList.remove("report-pill--active"));

  reportDateFromState = from;
  reportDateToState = to;
  loadReports(from, to);
}

// ─── Reports Loading & Rendering ──────────────────────────────────────────────

async function loadReports(dateFrom, dateTo) {
  // Show loading state
  if (reportLoading) reportLoading.hidden = false;
  if (reportStatusStrip) reportStatusStrip.hidden = true;
  if (reportHistoryList) reportHistoryList.innerHTML = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_EXTENSION_REPORT",
      dateFrom: dateFrom || reportDateFromState || undefined,
      dateTo: dateTo || reportDateToState || undefined
    });

    if (response && response.success) {
      currentReportHistory = response.history || [];
      renderReports(response);

      // Save to cache
      await chrome.storage.local.set({
        extensionReportCache: {
          dateFrom: dateFrom || reportDateFromState,
          dateTo: dateTo || reportDateToState,
          ...response
        }
      });
    } else {
      renderHistoryList([]);
    }
  } catch (error) {
    console.error("Could not load extension reports", error);
    if (reportHistoryList) {
      reportHistoryList.innerHTML = `<li class="history-empty history-empty--error">Could not load report. Check your connection.</li>`;
    }
  } finally {
    if (reportLoading) reportLoading.hidden = true;
  }
}

function renderReports(data) {
  // Status strip
  if (reportStatusStrip) {
    reportStatusStrip.hidden = false;
    if (reportTotalCount) reportTotalCount.textContent = data.totalCount ?? 0;
    if (reportTodayCount) reportTodayCount.textContent = data.todayCount ?? 0;
    if (reportUrgentCount) reportUrgentCount.textContent = data.urgentCount ?? 0;
    if (reportCancelledCount) reportCancelledCount.textContent = data.cancelledCount ?? 0;
  }

  renderHistoryList(data.history || []);
}

function renderHistoryList(history) {
  if (!reportHistoryList) return;
  reportHistoryList.innerHTML = "";

  if (!history || history.length === 0) {
    reportHistoryList.innerHTML = `<li class="history-empty">No leads found for the selected date range.</li>`;
    return;
  }

  history.forEach((lead) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const dateStr = formatCapturedAt(lead.createdAt);
    const status = lead.status || "default";

    // Compute status badge class
    let badgeClass = "status-badge--default";
    let statusLabel = status.replace(/_/g, " ");
    if (status === "urgent_job" || status === "need_tech") {
      badgeClass = "status-badge--urgent";
      statusLabel = status === "urgent_job" ? "Urgent" : "Need Tech";
    } else if (status === "pending_to_send") {
      badgeClass = "status-badge--quote";
      statusLabel = "Quote Pending";
    } else if (status === "quote_sent_waiting") {
      badgeClass = "status-badge--waiting";
      statusLabel = "Quote Sent";
    } else if (status === "scheduled") {
      badgeClass = "status-badge--scheduled";
      statusLabel = "Scheduled";
    } else if (status === "job_done" || status === "paid") {
      badgeClass = "status-badge--done";
      statusLabel = status === "job_done" ? "Job Done" : "Paid";
    } else if (status === "cancelled") {
      badgeClass = "status-badge--cancelled";
      statusLabel = "Cancelled";
    } else {
      statusLabel = "Default";
    }

    li.innerHTML = `
      <div class="history-item__main">
        <div class="history-item__top">
          <span class="history-item__title">${escapeHtml(lead.customerName || "No Name")}</span>
          <span class="status-badge ${escapeHtml(badgeClass)}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="history-item__meta">
          <span class="history-item__phone">${escapeHtml(lead.customerPhone || "No Number")}</span>
          ${lead.serviceType ? `<span class="history-item__sep">·</span><span class="history-item__service">${escapeHtml(lead.serviceType)}</span>` : ""}
        </div>
        <div class="history-item__footer">
          <span class="history-item__job-id">${escapeHtml(lead.jobId || "")}</span>
          <span class="history-item__date">${escapeHtml(dateStr)}</span>
        </div>
      </div>
    `;
    reportHistoryList.appendChild(li);
  });
}



// Lead Form logic
async function handleFormInput(event) {
  const target = event.target;
  if (!target.name || !EDITABLE_FIELDS.includes(target.name)) {
    return;
  }

  let value = target.value;
  if (target.type === "radio" && currentDraft && currentDraft[target.name] === value) {
    return;
  }

  if (target.name === "customerNumber") {
    formatPhoneInput(target);
    value = target.value;
  }

  const payload = {
    [target.name]: value
  };

  if (target.name === "materialsIncluded" && value === "no") {
    payload.materialAmount = "";
    if (form.materialAmount) form.materialAmount.value = "";
  }

  if (target.name === "terms" && value !== "quoted") {
    payload.quote = "";
    if (form.quote) {
      form.quote.value = "";
    }
  }

  const updatedDraft = {
    ...currentDraft,
    ...payload
  };

  const previousPhone = currentDraft?.customerNumber || "";
  currentDraft = updatedDraft;
  invalidateLeadCheckWhenPhoneChanges(previousPhone, updatedDraft.customerNumber);
  updateScheduleRequirementButtonState();
  updateQuoteFieldVisibility(updatedDraft.terms);
  await chrome.runtime.sendMessage({
    type: "UPDATE_DRAFT",
    payload
  });

  if (target.name === "customerAddress") {
    hideAddressSuggestions();
    queueCoveragePreview(value);
  }
}

function queueCoveragePreview(rawAddress) {
  if (!coveragePreview) return;
  if (coveragePreviewTimer) clearTimeout(coveragePreviewTimer);

  const address = String(rawAddress || "").trim();
  const requestId = ++coveragePreviewRequest;
  if (!address) {
    coveragePreview.hidden = true;
    coveragePreview.textContent = "";
    return;
  }

  coveragePreview.hidden = false;
  coveragePreview.className = "inline-area-badge coverage-preview--loading";
  coveragePreview.textContent = "Coverage preview will appear when you finish typing…";

  coveragePreviewTimer = setTimeout(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "PREVIEW_LEAD_COVERAGE",
        address
      });
      if (requestId !== coveragePreviewRequest) return;
      if (!response?.success) throw new Error(response?.error || "Coverage preview failed.");

      const result = response.coverage;
      if (!result) {
        coveragePreview.className = "inline-area-badge coverage-preview--unknown";
        coveragePreview.textContent = "Couldn’t place address — check the city/state before creating.";
        return;
      }

      const count = Number(result.tech_count);
      const level = count >= 10 ? "good" : count >= 1 ? "normal" : "bad";
      const label = level === "good" ? "Good Coverage" : level === "normal" ? "Normal Coverage" : "Bad Coverage";
      const where = result.area_label ? ` near ${result.area_label}` : "";
      coveragePreview.className = `inline-area-badge coverage-preview--${level}`;
      coveragePreview.textContent = `${label} · ${count} active technician${count === 1 ? "" : "s"}${where} · preview`;
    } catch (error) {
      if (requestId !== coveragePreviewRequest) return;
      console.warn("Lead coverage preview failed:", error);
      coveragePreview.className = "inline-area-badge coverage-preview--unknown";
      coveragePreview.textContent = "Coverage preview unavailable; lead creation is unaffected.";
    }
  }, 500);
}

async function handleClearForm() {
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_DRAFT" });
  currentDraft = response.draft;
  suppressAddressLookup = false;
  renderDraft(currentDraft);
  resetTransientFormState();
  queueCoveragePreview("");
  showFeedback("Draft cleared.", "info");
}

/**
 * The check's findings as a short list. Severity is carried in the text rather
 * than a colour, since the panel has no severity styling and an unstyled class
 * would render as nothing at all.
 */
function renderUrgentIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return "";

  const items = issues
    .slice(0, 6)
    .map((issue) => {
      const field = issue && issue.field ? `${escapeHtml(String(issue.field))}: ` : "";
      const problem = escapeHtml(String((issue && issue.problem) || ""));
      return `<li>${field}${problem}</li>`;
    })
    .join("");

  const more = issues.length > 6 ? `<li>and ${issues.length - 6} more</li>` : "";
  return `<ul style="margin:6px 0 0 16px;padding:0">${items}${more}</ul>`;
}

async function handleCreateLead(event) {
  event.preventDefault();
  clearFeedback();
  createLeadButton.disabled = true;
  createLeadButton.innerHTML = `<svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 0.8s linear infinite"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-linecap="round"/></svg><span>Creating...</span>`;

  try {
    const response = await chrome.runtime.sendMessage({ type: "CREATE_LEAD" });

    if (!response?.success) {
      throw new Error(response?.error || "Lead creation failed.");
    }

    // Auto-clear the draft on successful creation
    try {
      const clearResponse = await chrome.runtime.sendMessage({ type: "CLEAR_DRAFT" });
      if (!clearResponse?.success) throw new Error(clearResponse?.error || "Draft cleanup failed");
      currentDraft = clearResponse.draft;
      suppressAddressLookup = false;
      renderDraft(currentDraft);
      resetTransientFormState();
    } catch {
      // Saving and clearing are separate outcomes. Never invite a duplicate
      // submission just because Chrome's draft storage could not be cleared.
      showFeedback(`Lead saved. Draft cleanup failed; open the saved lead and clear this form before starting another.${response.response?.leadUrl ? ` <a href="${escapeHtml(response.response.leadUrl)}" target="_blank" rel="noreferrer">Open Lead</a>` : ""}`, "info", true);
      return;
    }

    const leadUrl = response.response?.leadUrl;
    const photoNotice = response.photoUploadFailures ? ` ${Number(response.photoUploadFailures)} photo(s) could not be uploaded. Add the missing photos from the saved lead.` : "";
    const openLink = (leadUrl
      ? ` <a href="${escapeHtml(leadUrl)}" target="_blank" rel="noreferrer">Open Lead</a>`
      : "") + photoNotice;

    if (response.quoteApprovalError) {
      // The lead was created, but it is sitting in Waiting Complete Details
      // rather than waiting on a CS Admin, so say so plainly.
      showFeedback(
        `Lead created, but the quote approval request failed: ${escapeHtml(response.quoteApprovalError)}. Set the status from the CRM.${openLink}`,
        "error",
        true
      );
    } else if (response.urgentCheckRequired) {
      const reviewUrl = response.response?.urgentReviewUrl || leadUrl;
      // Opens the review itself rather than just the lead, so the status change
      // is not a step the CS member has to find and redo by hand.
      const reviewLink = (reviewUrl
        ? ` <a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noreferrer">Open the review</a>`
        : "") + photoNotice;
      const check = response.urgentCheck;

      if (check && check.state === "clean") {
        showFeedback(
          `Lead created and marked urgent. The conversation check found nothing to fix.${openLink}`,
          "success",
          true
        );
      } else if (check && check.state === "issues") {
        const total = typeof check.total === "number" ? check.total : check.issues.length;
        showFeedback(
          `Lead created, but it was not marked urgent. The latest-agreement review found ${total} item${total === 1 ? "" : "s"} to confirm:${renderUrgentIssues([...(check.issues || []), ...(check.fixes || []).map(fix => ({ field: fix.field, problem: `${fix.reason || "Correction suggested"}: ${fix.suggested || ""}` })), ...(check.flags || []).map(flag => ({ field: flag.field, problem: flag.problem || flag.reason || flag.message || "Review this missing detail" }))])}${reviewLink}`,
          "info",
          true
        );
      } else if (check && check.state === "unavailable") {
        showFeedback(
          `Lead created, but it was not marked urgent. ${escapeHtml(check.notice || "The conversation could not be compared.")}${reviewLink}`,
          "info",
          true
        );
      } else {
        // The lead is saved and simply not urgent yet, either because the check
        // could not run or because recording a clean result failed. Point at the
        // review rather than reporting the creation as a failure.
        const why = check && check.error ? ` ${escapeHtml(check.error)}` : "";
        showFeedback(
          `Lead created, but it was not marked urgent.${why}${reviewLink}`,
          "info",
          true
        );
      }
    } else {
      const successText = response.quoteApprovalRequested
        ? "Lead created and sent to a CS Admin for approval."
        : "Lead created successfully.";

      showFeedback(`${successText}${openLink}`, "success", true);
    }
    
    // Refresh stats and history list with current date range!
    if (reportDateFromState || reportDateToState) {
      loadReports(reportDateFromState, reportDateToState);
    }

  } catch (error) {
    showFeedback(error.message || "Lead creation failed.", "error");
  } finally {
    createLeadButton.disabled = false;
    createLeadButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Create Lead</span>`;
  }
}

const UPDATE_SCHEDULE_BUTTON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Update Schedule Requirement</span>`;

function normalizePhoneForLeadCheck(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

function phonesMatchForLeadCheck(a, b) {
  const first = normalizePhoneForLeadCheck(a);
  const second = normalizePhoneForLeadCheck(b);
  return Boolean(first && second && first === second);
}

function invalidateLeadCheckWhenPhoneChanges(previousPhone, nextPhone) {
  if (!checkedPhone && checkedLeads.length === 0) return;
  if (!phonesMatchForLeadCheck(previousPhone, nextPhone) || !phonesMatchForLeadCheck(checkedPhone, nextPhone)) {
    resetLeadCheckState();
  }
}

function updateScheduleRequirementButtonState() {
  if (!updateScheduleRequirementBtn) return;
  const hasSchedule = Boolean(form?.scheduleRequirement?.value.trim());
  const phoneStillMatches = phonesMatchForLeadCheck(form?.customerNumber?.value, checkedPhone);
  const canUpdate = leadCheckCompleted && selectedCheckedLeadId && hasSchedule && phoneStillMatches;
  updateScheduleRequirementBtn.disabled = scheduleUpdateInProgress || !canUpdate;

  if (scheduleUpdateInProgress) {
    updateScheduleRequirementBtn.title = "Updating the selected lead...";
  } else if (!leadCheckCompleted) {
    updateScheduleRequirementBtn.title = "Press Check Lead first";
  } else if (!selectedCheckedLeadId) {
    updateScheduleRequirementBtn.title = "Select a matching lead first";
  } else if (!hasSchedule) {
    updateScheduleRequirementBtn.title = "Enter a schedule requirement first";
  } else if (!phoneStillMatches) {
    updateScheduleRequirementBtn.title = "The customer number changed. Check Lead again";
  } else {
    updateScheduleRequirementBtn.title = "Replace the selected lead's schedule requirement";
  }
}

function resetLeadCheckState({ clearMessage = true } = {}) {
  checkedLeads = [];
  selectedCheckedLeadId = "";
  checkedPhone = "";
  leadCheckCompleted = false;

  if (matchingLeadsList) matchingLeadsList.replaceChildren();
  if (matchingLeadsContainer) matchingLeadsContainer.hidden = true;
  if (clearMessage) clearCheckLeadFeedback();
  updateScheduleRequirementButtonState();
}

function resetTransientFormState() {
  suppressAddressLookup = false;
  hideAddressSuggestions();
  resetLeadCheckState();
  if (expectedAreaResult) {
    expectedAreaResult.hidden = true;
    expectedAreaResult.textContent = "";
    expectedAreaResult.className = "expected-area-result";
  }
}

function addLeadMetaLine(container, text, className = "matching-lead-option__meta") {
  if (!text) return;
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  container.appendChild(line);
}

function renderMatchingLeads() {
  if (!matchingLeadsContainer || !matchingLeadsList) return;
  matchingLeadsList.replaceChildren();

  if (checkedLeads.length === 0) {
    matchingLeadsContainer.hidden = true;
    updateScheduleRequirementButtonState();
    return;
  }

  matchingLeadsContainer.hidden = false;
  if (matchingLeadsTitle) {
    matchingLeadsTitle.textContent = `${checkedLeads.length} matching lead${checkedLeads.length === 1 ? "" : "s"}`;
  }

  checkedLeads.forEach((lead) => {
    const label = document.createElement("label");
    label.className = "matching-lead-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "checkedLeadSelection";
    radio.value = lead.id;
    radio.checked = selectedCheckedLeadId === lead.id;
    radio.addEventListener("change", () => {
      selectedCheckedLeadId = lead.id;
      updateScheduleRequirementButtonState();
    });

    const content = document.createElement("div");
    content.className = "matching-lead-option__content";

    const title = document.createElement("div");
    title.className = "matching-lead-option__title";
    title.textContent = `${lead.job_id || "No Job ID"} · ${lead.customer_name || "Unnamed customer"}`;
    content.appendChild(title);

    addLeadMetaLine(content, [lead.service_type, lead.status].filter(Boolean).join(" · "));
    addLeadMetaLine(content, lead.address || "No address");
    addLeadMetaLine(
      content,
      `Current schedule: ${lead.customer_schedule_requirements || "None"}`,
      "matching-lead-option__schedule"
    );

    label.appendChild(radio);
    label.appendChild(content);
    matchingLeadsList.appendChild(label);
  });

  updateScheduleRequirementButtonState();
}

async function handleUpdateScheduleRequirement() {
  clearFeedback();

  const selectedLead = checkedLeads.find((lead) => lead.id === selectedCheckedLeadId);
  const scheduleRequirement = form.scheduleRequirement.value.trim();

  if (!leadCheckCompleted || !selectedLead) {
    showFeedback("Press Check Lead and select the correct existing lead first.", "error");
    updateScheduleRequirementButtonState();
    return;
  }
  if (!phonesMatchForLeadCheck(form.customerNumber.value, checkedPhone)) {
    resetLeadCheckState();
    showFeedback("The customer number changed. Press Check Lead again.", "error");
    return;
  }
  if (!scheduleRequirement) {
    showFeedback("Enter the new schedule requirement before updating.", "error");
    updateScheduleRequirementButtonState();
    return;
  }

  scheduleUpdateInProgress = true;
  updateScheduleRequirementBtn.innerHTML = `<svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-linecap="round"/></svg><span>Updating...</span>`;
  updateScheduleRequirementButtonState();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_LEAD_SCHEDULE_REQUIREMENT",
      leadId: selectedLead.id,
      scheduleRequirement,
      checkedPhone
    });

    if (!response?.success) {
      throw new Error(response?.error || "Schedule requirement update failed.");
    }

    const clearResponse = await chrome.runtime.sendMessage({ type: "CLEAR_DRAFT" });
    currentDraft = clearResponse.draft;
    renderDraft(currentDraft);
    resetTransientFormState();

    const updatedLead = response.response?.lead;
    const jobId = updatedLead?.job_id || selectedLead.job_id || "selected lead";
    const leadUrl = response.response?.leadUrl;
    const successHtml = leadUrl
      ? `Schedule requirement updated for Job ID ${escapeHtml(jobId)}. <a href="${escapeHtml(leadUrl)}" target="_blank" rel="noreferrer">Open Lead</a>`
      : `Schedule requirement updated for Job ID ${escapeHtml(jobId)}.`;

    showFeedback(successHtml, "success", true);
    if (reportDateFromState || reportDateToState) {
      loadReports(reportDateFromState, reportDateToState);
    }
  } catch (error) {
    showFeedback(error.message || "Schedule requirement update failed.", "error");
  } finally {
    scheduleUpdateInProgress = false;
    updateScheduleRequirementBtn.innerHTML = UPDATE_SCHEDULE_BUTTON_HTML;
    updateScheduleRequirementButtonState();
  }
}

function renderDraft(draft) {
  draft = draft || {};

  // Update editable fields safely to prevent cursor jumping
  const inputs = [
    "customerName",
    "customerNumber",
    "customerAddress",
    "numberName",
    "serviceName",
    "referenceName",
    "serviceDetails",
    "quote",
    "laborAmount",
    "materialsIncluded",
    "materialAmount",
    "scheduleRequirement"
  ];

  inputs.forEach((field) => {
    const element = form[field];
    if (element) {
      let val = draft[field] || "";
      if (field === "customerNumber") {
        val = formatPhoneNumber(val);
      }
      if (element.value !== val) {
        element.value = val;
      }
    }
  });

  // Sync direction (radio buttons / segmented control)
  const directionVal = draft.direction || "incoming";
  const radios = form.elements["direction"];
  if (radios) {
    radios.value = directionVal;
  }

  const leadStatusVal = draft.leadStatus || "default";
  const statusRadios = form.querySelectorAll('input[name="leadStatus"]');
  statusRadios.forEach((radio) => {
    radio.checked = radio.value === leadStatusVal;
  });

  const termsVal = draft.terms || "";
  const termsRadios = form.querySelectorAll('input[name="terms"]');
  termsRadios.forEach((radio) => {
    radio.checked = radio.value === termsVal;
  });
  updateQuoteFieldVisibility(termsVal);

  // Safely select and update read-only fields outside the main form element
  const capturedAtInput = document.querySelector('[name="capturedAt"]');
  const sourceUrlInput = document.querySelector('[name="sourceUrl"]');

  if (capturedAtInput) {
    const rawTime = draft.capturedAt || "";
    const formattedTime = rawTime ? formatCapturedAt(rawTime) : "";
    if (capturedAtInput.value !== formattedTime) {
      capturedAtInput.value = formattedTime;
    }
  }

  if (sourceUrlInput) {
    const rawUrl = draft.sourceUrl || "";
    if (sourceUrlInput.value !== rawUrl) {
      sourceUrlInput.value = rawUrl;
    }
  }

  // Render chat pictures preview
  renderPhotos(draft.photos || []);
  queueCoveragePreview(draft.customerAddress || "");
}


function updateQuoteFieldVisibility(terms) {
  if (!quoteField) return;
  quoteField.hidden = terms !== "quoted";
  const materialsField = document.getElementById("materials-amount-field");
  if (materialsField) materialsField.hidden = terms !== "quoted" || currentDraft?.materialsIncluded !== "yes";
}

function queueAddressSuggestions(rawValue) {
  if (suppressAddressLookup) {
    suppressAddressLookup = false;
  }

  const query = (rawValue || "").trim();
  if (!query || query.length < ADDRESS_MIN_QUERY_LENGTH) {
    hideAddressSuggestions();
    return;
  }

  showAddressSuggestionState("Click Find Address to search standardized matches.", "idle");
}

async function fetchAddressSuggestions(query) {
  try {
    const normalizedQuery = normalizeAddressQuery(query);
    const response = await chrome.runtime.sendMessage({
      type: "CENSUS_ADDRESS_LOOKUP",
      address: normalizedQuery
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to search addresses.");
    }

    const normalizedResults = (response.matches || [])
      .map((match) => ({
        address: typeof match?.matchedAddress === "string" ? match.matchedAddress.trim() : ""
      }))
      .filter((result) => result.address);

    if (normalizedResults.length === 0) {
      showAddressSuggestionState("No matching address found", "empty");
      return;
    }

    renderAddressSuggestions(normalizedResults);
  } catch (error) {
    console.error("Address suggestion lookup failed:", error);
    if ((error?.message || "").includes("Extension context invalidated")) {
      showAddressSuggestionState("Extension updated — refresh the Quo tab", "error");
      return;
    }
    showAddressSuggestionState(error?.message || "Unable to search addresses", "error");
  }
}

function renderAddressSuggestions(results) {
  if (!addressSuggestions || !addressSuggestionsStatus || !addressSuggestionsList) {
    return;
  }

  addressSuggestions.hidden = false;
  delete addressSuggestions.dataset.state;
  addressSuggestionsStatus.textContent = `Suggestions from ${ADDRESS_PROVIDER_NAME}`;
  addressSuggestionsList.innerHTML = "";

  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-item";
    button.dataset.address = result.address || "";
    button.textContent = result.address || "";
    addressSuggestionsList.appendChild(button);
  });
}

function showAddressSuggestionState(message, state) {
  if (!addressSuggestions || !addressSuggestionsStatus || !addressSuggestionsList) {
    return;
  }

  addressSuggestions.hidden = false;
  addressSuggestions.dataset.state = state;
  addressSuggestionsStatus.textContent = message;
  addressSuggestionsList.innerHTML = "";
}

function hideAddressSuggestions() {
  if (!addressSuggestions || !addressSuggestionsStatus || !addressSuggestionsList) {
    return;
  }

  addressSuggestions.hidden = true;
  addressSuggestionsStatus.textContent = "";
  addressSuggestionsList.innerHTML = "";
  delete addressSuggestions.dataset.state;
}

async function handleAddressSuggestionClick(event) {
  const button = event.target.closest(".suggestion-item");
  if (!button || !form.customerAddress) {
    return;
  }

  const nextAddress = button.dataset.address || "";
  suppressAddressLookup = true;
  form.customerAddress.value = nextAddress;

  currentDraft = {
    ...(currentDraft || {}),
    customerAddress: nextAddress
  };

  try {
    await chrome.runtime.sendMessage({
      type: "UPDATE_DRAFT",
      payload: {
        customerAddress: nextAddress
      }
    });
  } catch (error) {
    if ((error?.message || "").includes("Extension context invalidated")) {
      showFeedback("Extension was updated. Refresh the Quo tab and reopen the side panel.", "error");
      return;
    }
    throw error;
  }

  queueCoveragePreview(nextAddress);

  // Show confirmation inside the dropdown area, not the global toast
  if (addressSuggestions && addressSuggestionsStatus) {
    addressSuggestions.hidden = false;
    addressSuggestions.dataset.state = "success";
    addressSuggestionsStatus.textContent = "\u2713 Address applied successfully";
    if (addressSuggestionsList) addressSuggestionsList.innerHTML = "";
    // Auto-hide the dropdown after 2 seconds
    setTimeout(() => {
      hideAddressSuggestions();
    }, 2000);
  }
}

async function handleFindAddressClick() {
  clearFeedback();
  const query = (form.customerAddress?.value || "").trim();

  if (!query) {
    // Show the error inside the address dropdown, not the global toast
    showAddressSuggestionState("Enter an address first, then click Find.", "error");
    return;
  }

  window.clearTimeout(addressSuggestionTimer);
  showAddressSuggestionState("Searching addresses...", "loading");

  addressSuggestionTimer = window.setTimeout(() => {
    fetchAddressSuggestions(query);
  }, ADDRESS_DEBOUNCE_MS);
}

function normalizeAddressQuery(rawQuery) {
  let normalized = (rawQuery || "").trim();
  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.replace(/\bin\s+([A-Za-z][A-Za-z.\-'\s]+)/i, ", $1");
  normalized = normalized.replace(/\b(?:please|pls|find|address|at|near|around)\b/gi, " ");
  normalized = normalized.replace(/\s+,/g, ",");
  normalized = normalized.replace(/,\s*,+/g, ", ");
  normalized = normalized.replace(/\s{2,}/g, " ");
  normalized = normalized.replace(/\s*,\s*/g, ", ");
  return normalized.trim().replace(/,$/, "");
}

function formatCapturedAt(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch (e) {
    return isoString;
  }
}

function showFeedback(message, type, allowHtml = false) {
  feedback.hidden = false;
  feedback.className = `feedback feedback--${type}`;
  
  let iconSvg = "";
  if (type === "success") {
    iconSvg = `<svg class="feedback__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (type === "error") {
    iconSvg = `<svg class="feedback__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  } else {
    iconSvg = `<svg class="feedback__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
  
  const contentSpan = document.createElement("span");
  contentSpan.className = "feedback__content";
  if (allowHtml) {
    contentSpan.innerHTML = message;
  } else {
    contentSpan.textContent = message;
  }
  
  feedback.innerHTML = "";
  feedback.appendChild(createSvgElement(iconSvg));
  feedback.appendChild(contentSpan);
  
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "feedback__close";
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener("click", clearFeedback);
  feedback.appendChild(closeBtn);
}

function createSvgElement(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  return doc.documentElement;
}

function clearFeedback() {
  feedback.hidden = true;
  feedback.textContent = "";
  feedback.className = "feedback";
  clearCheckLeadFeedback();
}

function escapeHtml(value) {
  if (!value) return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function handleAutoPickNumber() {
  clearFeedback();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab found.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_CUSTOMER_NUMBER" });
    
    if (response && response.success && response.number) {
      const formatted = formatPhoneNumber(response.number);
      form.customerNumber.value = formatted;

      await chrome.runtime.sendMessage({
        type: "UPDATE_DRAFT",
        payload: {
          customerNumber: formatted
        }
      });

      const previousPhone = currentDraft.customerNumber || "";
      currentDraft.customerNumber = formatted;
      invalidateLeadCheckWhenPhoneChanges(previousPhone, formatted);
      updateScheduleRequirementButtonState();
      showFeedback(`Customer number auto-picked: ${formatted}`, "success");
    } else {
      throw new Error("Could not find any customer number in the header of this page.");
    }
  } catch (error) {
    let errMsg = error.message || "Failed to auto-pick number.";
    if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
      errMsg = "Could not connect to quo.com page. Please ensure you are active on the quo.com chat page and refresh the page.";
    }
    showFeedback(errMsg, "error");
  }
}

async function handleAutoPickDirection() {
  clearFeedback();

  const originalHtml = autoPickDirectionBtn?.innerHTML;
  if (autoPickDirectionBtn) {
    autoPickDirectionBtn.disabled = true;
    autoPickDirectionBtn.textContent = "Detecting...";
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab found.");
    }

    const response = await chrome.tabs.sendMessage(
      tab.id,
      { type: "SCRAPE_CHAT_DIRECTION" },
      { frameId: 0 }
    );
    if (!response?.success || !response.direction) {
      throw new Error(response?.error || "Could not determine who started this conversation.");
    }

    const direction = response.direction === "outgoing" ? "outgoing" : "incoming";
    const radios = form.elements["direction"];
    if (radios) {
      radios.value = direction;
    }

    const updated = await chrome.runtime.sendMessage({
      type: "UPDATE_DRAFT",
      payload: { direction }
    });

    currentDraft = updated?.draft || {
      ...(currentDraft || {}),
      direction
    };

    const starter = direction === "incoming" ? "Customer" : "Your team";
    showFeedback(`${starter} started the conversation — marked ${direction}.`, "success");
  } catch (error) {
    let errMsg = error?.message || "Failed to auto-pick direction.";
    if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
      errMsg = "Could not connect to quo.com. Refresh the Quo tab, then try Auto again.";
    }
    showFeedback(errMsg, "error");
  } finally {
    if (autoPickDirectionBtn) {
      autoPickDirectionBtn.disabled = false;
      autoPickDirectionBtn.innerHTML = originalHtml;
    }
  }
}

async function handleAutoPickNumberName() {
  clearFeedback();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab found.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_NUMBER_NAME" });
    
    if (response && response.success && response.name) {
      form.numberName.value = response.name;

      await chrome.runtime.sendMessage({
        type: "UPDATE_DRAFT",
        payload: {
          numberName: response.name
        }
      });

      currentDraft.numberName = response.name;
      showFeedback(`Number name auto-picked: ${response.name}`, "success");
    } else {
      throw new Error("Could not find active channel/number name on this page.");
    }
  } catch (error) {
    let errMsg = error.message || "Failed to auto-pick number name.";
    if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
      errMsg = "Could not connect to quo.com page. Please ensure you are active on the quo.com chat page and refresh the page.";
    }
    showFeedback(errMsg, "error");
  }
}

async function handleAutoPickServiceName() {
  clearFeedback();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab found.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "OPEN_ASSIGN_FIELD_MENU",
      field: "serviceName"
    });

    if (!response?.success) {
      throw new Error(response?.error || "Failed to open service text picker.");
    }

    showFeedback("Select service text in the chat, then click Service Name / Keyword in the Assign Field menu.", "info");
  } catch (error) {
    let errMsg = error.message || "Failed to open service text picker.";
    if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
      errMsg = "Could not connect to quo.com page. Please ensure you are active on the quo.com chat page and refresh the page.";
    }
    showFeedback(errMsg, "error");
  }
}

async function handleCheckCrmNumber() {
  clearFeedback();
  resetLeadCheckState();
  const leadCheckToken = ++leadCheckSequence;

  let phone = formatPhoneNumber(form.customerNumber.value.trim());

  try {
    if (checkCrmNumberBtn) checkCrmNumberBtn.disabled = true;

    // Auto-pick the active Quo customer number before checking.
    try {
      showCheckLeadFeedback("Auto-picking customer number...", "info");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_CUSTOMER_NUMBER" });
        if (scrapeResponse?.success && scrapeResponse.number) {
          phone = formatPhoneNumber(scrapeResponse.number.trim());
          form.customerNumber.value = phone;
          currentDraft.customerNumber = phone;
          await chrome.runtime.sendMessage({
            type: "UPDATE_DRAFT",
            payload: { customerNumber: phone }
          });
        }
      }
    } catch (error) {
      console.log("Auto-pick during check lead failed, falling back to current field value:", error);
    }

    if (leadCheckToken !== leadCheckSequence) return;

    if (!phone) {
      showCheckLeadFeedback("Please enter or auto-pick a phone number to check.", "error");
      return;
    }

    showCheckLeadFeedback("Checking CRM database...", "info");
    const response = await chrome.runtime.sendMessage({
      type: "CHECK_LEAD_EXISTS",
      phone
    });

    if (leadCheckToken !== leadCheckSequence) return;

    if (!response?.success) {
      throw new Error(response?.error || "Failed to check lead status.");
    }

    checkedPhone = phone;
    leadCheckCompleted = true;
    checkedLeads = Array.isArray(response.leads) ? response.leads : [];
    selectedCheckedLeadId = "";
    renderMatchingLeads();

    if (checkedLeads.length > 0) {
      showCheckLeadFeedback(
        `Found ${checkedLeads.length} existing active lead${checkedLeads.length === 1 ? "" : "s"}. Select the correct lead below.`,
        "info"
      );
    } else {
      showCheckLeadFeedback("Not in CRM. You can safely add this lead.", "success");
    }
  } catch (error) {
    if (leadCheckToken !== leadCheckSequence) return;
    resetLeadCheckState({ clearMessage: false });
    showCheckLeadFeedback(error.message || "Failed to check CRM.", "error");
  } finally {
    if (leadCheckToken === leadCheckSequence && checkCrmNumberBtn) {
      checkCrmNumberBtn.disabled = false;
    }
    updateScheduleRequirementButtonState();
  }
}

async function automaticallyCheckSyncedLead(phone, chatSyncToken, conversationKey) {
  const formattedPhone = formatPhoneNumber(String(phone || "").trim());
  if (!formattedPhone || chatSyncToken !== activeChatSyncToken) return;
  const leadCheckToken = ++leadCheckSequence;

  resetLeadCheckState();
  if (checkCrmNumberBtn) checkCrmNumberBtn.disabled = true;
  showCheckLeadFeedback("Checking CRM database...", "info");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHECK_LEAD_EXISTS",
      phone: formattedPhone
    });

    if (chatSyncToken !== activeChatSyncToken || leadCheckToken !== leadCheckSequence) return;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.url || getQuoConversationKey(activeTab.url) !== conversationKey) return;
    if (!phonesMatchForLeadCheck(form.customerNumber.value, formattedPhone)) return;

    if (!response?.success) {
      throw new Error(response?.error || "Failed to check lead status.");
    }

    checkedPhone = formattedPhone;
    leadCheckCompleted = true;
    checkedLeads = Array.isArray(response.leads) ? response.leads : [];
    selectedCheckedLeadId = "";
    renderMatchingLeads();

    if (checkedLeads.length > 0) {
      showCheckLeadFeedback(
        `Found ${checkedLeads.length} existing active lead${checkedLeads.length === 1 ? "" : "s"}. Select the correct lead below.`,
        "info"
      );
    } else {
      showCheckLeadFeedback("Not in CRM. You can safely add this lead.", "success");
    }
  } catch (error) {
    if (chatSyncToken !== activeChatSyncToken || leadCheckToken !== leadCheckSequence) return;
    resetLeadCheckState({ clearMessage: false });
    showCheckLeadFeedback(error?.message || "Failed to check CRM.", "error");
  } finally {
    if (
      chatSyncToken === activeChatSyncToken &&
      leadCheckToken === leadCheckSequence &&
      checkCrmNumberBtn
    ) {
      checkCrmNumberBtn.disabled = false;
    }
    updateScheduleRequirementButtonState();
  }
}

function showCheckLeadFeedback(message, type, allowHtml = false) {
  if (!checkLeadFeedback) return;
  checkLeadFeedback.hidden = false;
  checkLeadFeedback.className = `feedback feedback--${type}`;
  
  let iconSvg = "";
  if (type === "success") {
    iconSvg = `<svg class="feedback__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (type === "error") {
    iconSvg = `<svg class="feedback__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  } else {
    iconSvg = `<svg class="feedback__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
  
  const contentSpan = document.createElement("span");
  contentSpan.className = "feedback__content";
  if (allowHtml) {
    contentSpan.innerHTML = message;
  } else {
    contentSpan.textContent = message;
  }
  
  checkLeadFeedback.innerHTML = "";
  checkLeadFeedback.appendChild(createSvgElement(iconSvg));
  checkLeadFeedback.appendChild(contentSpan);
}

function clearCheckLeadFeedback() {
  if (checkLeadFeedback) {
    checkLeadFeedback.hidden = true;
    checkLeadFeedback.innerHTML = "";
  }
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

function formatPhoneInput(input) {
  const selectionStart = input.selectionStart;
  const originalValue = input.value;
  const formattedValue = formatPhoneNumber(originalValue);
  
  if (originalValue !== formattedValue) {
    input.value = formattedValue;
    
    let digitsBeforeCursor = 0;
    for (let i = 0; i < selectionStart; i++) {
      if (/\d/.test(originalValue[i])) {
        digitsBeforeCursor++;
      }
    }
    
    let newCursorPosition = 0;
    let digitsCount = 0;
    while (newCursorPosition < formattedValue.length && digitsCount < digitsBeforeCursor) {
      if (/\d/.test(formattedValue[newCursorPosition])) {
        digitsCount++;
      }
      newCursorPosition++;
    }
    
    input.setSelectionRange(newCursorPosition, newCursorPosition);
  }
}

async function handleAutoPickUrlSilently() {
  window.clearTimeout(activeChatSyncTimer);
  activeChatSyncToken += 1;
  return syncActiveQuoChatDetails(activeChatSyncToken);
}

function scheduleActiveQuoChatSync(delay = 100) {
  window.clearTimeout(activeChatSyncTimer);
  activeChatSyncToken += 1;
  const token = activeChatSyncToken;
  activeChatSyncTimer = window.setTimeout(() => {
    syncActiveQuoChatDetails(token).catch((error) => {
      console.debug("Automatic Quo chat sync failed:", error);
    });
  }, delay);
}

function getQuoConversationKey(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "quo.com" && !url.hostname.endsWith(".quo.com")) return "";
    const match = url.pathname.match(/\/inbox\/([^/]+)\/c\/([^/?#]+)/i);
    return match ? `${match[1]}:${match[2]}` : "";
  } catch (error) {
    return "";
  }
}

async function syncActiveQuoChatDetails(token) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    const conversationKey = getQuoConversationKey(tab.url);
    if (!conversationKey) {
      if (tab.url.startsWith("http://") || tab.url.startsWith("https://")) {
        const updated = await chrome.runtime.sendMessage({
          type: "UPDATE_DRAFT",
          payload: { sourceUrl: tab.url }
        });
        if (token === activeChatSyncToken && updated?.draft) {
          currentDraft = updated.draft;
          renderDraft(currentDraft);
        }
      }
      return;
    }

    const previousConversationKey = getQuoConversationKey(currentDraft?.sourceUrl || "");
    const changedConversation = !!previousConversationKey && previousConversationKey !== conversationKey;

    if (changedConversation) {
      leadCheckSequence += 1;
      if (checkCrmNumberBtn) checkCrmNumberBtn.disabled = false;
      const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_DRAFT" });
      if (token !== activeChatSyncToken) return;
      currentDraft = cleared?.draft || {};
      suppressAddressLookup = false;
      renderDraft(currentDraft);
      resetTransientFormState();
    }

    const sourceUpdate = await chrome.runtime.sendMessage({
      type: "UPDATE_DRAFT",
      payload: { sourceUrl: tab.url }
    });
    if (token !== activeChatSyncToken) return;
    if (sourceUpdate?.draft) {
      currentDraft = sourceUpdate.draft;
      renderDraft(currentDraft);
    }

    // Give Quo's single-page navigation time to replace the previous chat DOM.
    await waitForChatSync(500);

    let details = { number: "", name: "", direction: "", images: [] };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (token !== activeChatSyncToken) return;

      const [latestTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!latestTab?.id || getQuoConversationKey(latestTab.url) !== conversationKey) return;

      try {
        const response = await chrome.tabs.sendMessage(
          latestTab.id,
          { type: "SCRAPE_CHAT_DETAILS" },
          { frameId: 0 }
        );

        if (response) {
          details = {
            number: response.number || details.number,
            name: response.name || details.name,
            direction: response.direction || details.direction,
            images: Array.from(new Set([...(details.images || []), ...(response.images || [])]))
          };
        }
      } catch (error) {
        console.debug("Quo chat details are not ready yet:", error);
      }

      if (details.number && details.name && details.direction) break;
      await waitForChatSync(600);
    }

    if (token !== activeChatSyncToken) return;
    const [confirmedTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!confirmedTab?.id || getQuoConversationKey(confirmedTab.url) !== conversationKey) return;

    const payload = {
      sourceUrl: confirmedTab.url,
      capturedAt: new Date().toISOString()
    };
    if (details.number) payload.customerNumber = formatPhoneNumber(details.number);
    if (details.name) payload.numberName = details.name;
    if (details.direction) payload.direction = details.direction;
    if (details.images.length) {
      payload.photos = Array.from(new Set([
        ...((changedConversation ? [] : currentDraft?.photos) || []),
        ...details.images
      ]));
    }

    const updated = await chrome.runtime.sendMessage({
      type: "UPDATE_DRAFT",
      payload
    });
    if (token !== activeChatSyncToken) return;
    if (updated?.draft) {
      currentDraft = updated.draft;
      renderDraft(currentDraft);
      resetLeadCheckState();
      updateScheduleRequirementButtonState();
    }

    if (details.number && token === activeChatSyncToken) {
      await automaticallyCheckSyncedLead(details.number, token, conversationKey);
    }
  } catch (error) {
    console.debug("Silent Quo chat sync failed:", error);
  }
}

function waitForChatSync(delay) {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.url) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        scheduleActiveQuoChatSync();
      }
    } catch (e) {
      console.debug("Error handling tab update:", e);
    }
  }
}

async function handleTabActivated(activeInfo) {
  try {
    scheduleActiveQuoChatSync();
  } catch (e) {
    console.debug("Error handling tab activation:", e);
  }
}

async function handleAutoPickPhotos() {
  clearFeedback();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab found.");
    }

    // Send a message to content.js to scrape images
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_CHAT_IMAGES" });
    
    if (response && response.success && response.images && response.images.length > 0) {
      // Merge with existing picked photos (avoid duplicates)
      const existingPhotos = currentDraft.photos || [];
      const newPhotos = response.images.filter(img => !existingPhotos.includes(img));
      const mergedPhotos = [...existingPhotos, ...newPhotos];
      
      currentDraft.photos = mergedPhotos;
      await chrome.runtime.sendMessage({
        type: "UPDATE_DRAFT",
        payload: { photos: mergedPhotos }
      });
      
      renderPhotos(mergedPhotos);
      showFeedback(`Picked ${newPhotos.length} new pictures from the chat.`, "success");
    } else {
      throw new Error("No pictures found in the active chat page.");
    }
  } catch (error) {
    let errMsg = error.message || "Failed to pick pictures.";
    if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
      errMsg = "Please ensure you are active on the quo.com chat page and refresh the page.";
    }
    showFeedback(errMsg, "error");
  }
}

function renderPhotos(photos) {
  if (!photosPreviewContainer || !noPhotosLabel) return;

  const nextPhotos = Array.isArray(photos) ? photos : [];
  if (
    photoLightbox &&
    !photoLightbox.hidden &&
    !samePhotoList(lightboxPhotos, nextPhotos)
  ) {
    closePhotoLightbox({ restoreFocus: false });
  }
  
  photosPreviewContainer.innerHTML = "";
  
  if (nextPhotos.length === 0) {
    photosPreviewContainer.style.display = "none";
    noPhotosLabel.style.display = "block";
    return;
  }
  
  photosPreviewContainer.style.display = "grid";
  noPhotosLabel.style.display = "none";
  
  nextPhotos.forEach((url, index) => {
    const thumb = document.createElement("div");
    thumb.className = "photo-thumb";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "photo-thumb__preview";
    previewBtn.title = `Preview picture ${index + 1}`;
    previewBtn.setAttribute("aria-label", `Preview chat picture ${index + 1} of ${nextPhotos.length}`);

    const img = document.createElement("img");
    img.src = url;
    img.alt = `Chat image ${index + 1}`;
    img.loading = "lazy";

    previewBtn.appendChild(img);
    previewBtn.addEventListener("click", () => {
      openPhotoLightbox(nextPhotos, index, previewBtn);
    });
    
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "photo-thumb__remove";
    removeBtn.title = "Remove picture";
    removeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    
    removeBtn.addEventListener("click", async () => {
      const updatedPhotos = currentDraft.photos.filter((_, idx) => idx !== index);
      currentDraft.photos = updatedPhotos;
      await chrome.runtime.sendMessage({
        type: "UPDATE_DRAFT",
        payload: { photos: updatedPhotos }
      });
      renderPhotos(updatedPhotos);
    });
    
    thumb.appendChild(previewBtn);
    thumb.appendChild(removeBtn);
    photosPreviewContainer.appendChild(thumb);
  });
}

function samePhotoList(first, second) {
  if (first.length !== second.length) return false;
  return first.every((url, index) => url === second[index]);
}

function openPhotoLightbox(photos, index, returnFocusElement) {
  if (!photoLightbox || !photoLightboxImage || !photos?.length) return;

  lightboxPhotos = [...photos];
  lightboxPhotoIndex = Math.min(Math.max(Number(index) || 0, 0), lightboxPhotos.length - 1);
  lightboxReturnFocus = returnFocusElement || document.activeElement;
  photoLightbox.hidden = false;
  document.body.classList.add("photo-lightbox-open");
  renderPhotoLightboxImage();
  photoLightboxClose?.focus();
}

function closePhotoLightbox({ restoreFocus = true } = {}) {
  if (!photoLightbox || photoLightbox.hidden) return;

  photoLightbox.hidden = true;
  document.body.classList.remove("photo-lightbox-open");
  if (photoLightboxImage) {
    photoLightboxImage.removeAttribute("src");
    photoLightboxImage.alt = "";
  }

  const returnFocus = lightboxReturnFocus;
  lightboxPhotos = [];
  lightboxPhotoIndex = 0;
  lightboxReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected) {
    returnFocus.focus();
  }
}

function movePhotoLightbox(offset) {
  if (!lightboxPhotos.length) return;
  lightboxPhotoIndex = (
    lightboxPhotoIndex + offset + lightboxPhotos.length
  ) % lightboxPhotos.length;
  renderPhotoLightboxImage();
}

function renderPhotoLightboxImage() {
  if (!photoLightboxImage || !lightboxPhotos.length) return;

  const total = lightboxPhotos.length;
  photoLightboxImage.src = lightboxPhotos[lightboxPhotoIndex];
  photoLightboxImage.alt = `Chat picture ${lightboxPhotoIndex + 1} of ${total}`;
  if (photoLightboxCounter) {
    photoLightboxCounter.textContent = `${lightboxPhotoIndex + 1} / ${total}`;
  }

  const hideNavigation = total < 2;
  if (photoLightboxPrev) photoLightboxPrev.hidden = hideNavigation;
  if (photoLightboxNext) photoLightboxNext.hidden = hideNavigation;
}

function handlePhotoLightboxBackdropClick(event) {
  if (event.target === photoLightbox || event.target === photoLightboxStage) {
    closePhotoLightbox();
  }
}

function handlePhotoLightboxKeydown(event) {
  if (!photoLightbox || photoLightbox.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closePhotoLightbox();
  } else if (event.key === "ArrowLeft" && lightboxPhotos.length > 1) {
    event.preventDefault();
    movePhotoLightbox(-1);
  } else if (event.key === "ArrowRight" && lightboxPhotos.length > 1) {
    event.preventDefault();
    movePhotoLightbox(1);
  }
}
