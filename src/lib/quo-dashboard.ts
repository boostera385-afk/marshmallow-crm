export type QuoLeadStatus =
  | "raw"
  | "spam"
  | "contacted"
  | "qualified_lead"
  | "rejected"
  | "successfully_completed";

export interface QuoStatusConfig {
  label: string;
  badgeClass: string;
  description: string;
}

export const QUO_LEAD_STATUS_CONFIG: Record<QuoLeadStatus, QuoStatusConfig> = {
  raw: {
    label: "Raw",
    badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 hover:bg-slate-200",
    description: "New unique number (message sent or received)",
  },
  spam: {
    label: "Spam",
    badgeClass: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-300 hover:bg-zinc-200",
    description: "Marketing / spam call / junk",
  },
  contacted: {
    label: "Contacted",
    badgeClass: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 hover:bg-blue-100",
    description: "Real lead, outreach made, awaiting response",
  },
  qualified_lead: {
    label: "Qualified Lead",
    badgeClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 hover:bg-emerald-100",
    description: "Urgent, interested",
  },
  rejected: {
    label: "Rejected",
    badgeClass: "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 hover:bg-rose-100",
    description: "Price declined, not interested, hung-up, scam suspicion",
  },
  successfully_completed: {
    label: "Successfully Completed",
    badgeClass: "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border-teal-200 hover:bg-teal-100",
    description: "Lead successfully completed",
  },
};

export const QUO_LEAD_STATUS_KEYS = Object.keys(
  QUO_LEAD_STATUS_CONFIG
) as QuoLeadStatus[];

export const QUO_PHONE_NUMBER_NAME_MAP: Record<string, string> = {
  "13465949213": "Mini Split",
  "19726324844": "Max Mad",
  "16693378803": "JOC HOT TUB",
  "19723626313": "Dallas, Texas",
  "18329816614": "Exterior Painting Nationwide / TV Mounting",
  "14243339932": "BEVERLY HILLS 2",
  "12393067796": "NAPLES FLORIDA",
  "13463537571": "Sliding Door",
  "14697785063": "Nationwide Christmas Lights",
  "13463539245": "Nationwide Drywall Patch Repair",
  "17372775713": "Junk Removal Nationwide MIS",
  "17866736371": "Miami FB/ND Garage Door OP1",
  "13465779242": "Houston Facebook ND Garage Door OP1",
  "16575716845": "Orange County Handyman OP1",
  "18582643190": "San Diego Garage Door OP1",
  "17472988624": "Los Angeles Appliance OP1",
  "14632098542": "Indianapolis Handyman",
  "18723287251": "Chicago Facebook",
  "18188149252": "Los Angeles Facebook OP1",
  "12819426479": "Houston Handyman OP1",
  "14708232133": "Atlanta Georgia Appliance Repair / GD",
  "14709448210": "Atlanta Georgia Handyman",
  "12132779445": "LOS ANGELES GARAGE DOOR / CLEANING / PLUMBING",
  "16613628754": "Santa Clarita Handyman",
  "16572230626": "Orange County Appliance Repair",
  "18322097989": "Houston Handyman",
  "12014489324": "New Jersey Handyman",
  "19542396751": "Miami Appliance Repair",
  "15614646940": "Miami Handyman",
  "18722787204": "Chicago Handyman",
  "19292983346": "New York Handyman",
  "17374027035": "Austin Handyman N/FB",
  "16692366322": "San Jose Appliance Repair",
  "16692026712": "San Jose Handyman",
  "16822049388": "Nationwide Plumbing FB / Nationwide Handyman",
  "17475887812": "Technicians Communications (NEW)",
  "12133192404": "Los Angeles Handyman FB",
  "18582890634": "San Diego - Appliance Repair",
  "16193049048": "San Diego - Handyman",
  "12134718651": "Los Angeles - Handyman",
  "13464060053": "Appliance Repair Nationwide MIS",
  "13462263895": "Garage Door NATIONWIDE MIS",
  "14697188444": "Dallas Garage Door",
};

export const TECH_COMMUNICATIONS_NUMBER = "17475887812";
export const TECH_COMMUNICATIONS_DIGITS = "7475887812";

export function isTechLineNumber(num?: string | null): boolean {
  if (!num) return false;
  const digits = num.replace(/\D/g, "");
  return digits.endsWith("7475887812") || digits === "17475887812" || digits === "7475887812";
}

export const QUO_PHONE_NUMBER_EMOJI_MAP: Record<string, string> = {
  "12014489324": "🟡",
  "12133192404": "🇱🇦",
  "12134718651": "🇱🇦",
  "12132779445": "🇱🇦",
  "17472988624": "🇱🇦",
  "18188149252": "🇱🇦",
  "13462263895": "🚚",
  "13464060053": "🚐",
  "12819426479": "🚨",
  "13465779242": "🚨",
  "18322097989": "🍓",
  "14632098542": "⚡",
  "13463539245": "🛠️",
  "14697188444": "🤠",
  "14708232133": "📱",
  "14709448210": "📱",
  "16193049048": "🇸🇩",
  "18582643190": "🇸🇩",
  "18582890634": "🇸🇩",
  "16572230626": "🟠",
  "16575716845": "🟠",
  "16613628754": "🇸🇨",
  "16692026712": "🇸🇯",
  "16692366322": "🇸🇯",
  "17866736371": "🟢",
  "19542396751": "🟢",
  "15614646940": "🟢",
  "16822049388": "⚡",
  "17372775713": "🚧",
  "17374027035": "🇦🇺",
  "19723626313": "🤠",
  "19726324844": "🤠",
  "13465949213": "❄️",
  "16693378803": "🛁",
  "18329816614": "🎨",
  "14243339932": "🌴",
  "12393067796": "🌴",
  "13463537571": "🚪",
  "14697785063": "🎄",
  "18723287251": "🏙️",
  "18722787204": "🏙️",
  "19292983346": "🗽",
  "17475887812": "📡",
};

/**
 * Returns exact emoji icon for a QUO number from object or map
 */
export function getQuoNumberEmoji(
  numObj?: { emoji?: string | null; number?: string | null } | null,
  fallbackRawNumber?: string | null
): string {
  if (numObj?.emoji && numObj.emoji.trim() && numObj.emoji.trim() !== "Q") {
    return numObj.emoji.trim();
  }

  const numToTest = numObj?.number || fallbackRawNumber || "";
  const digits = numToTest.replace(/\D/g, "");

  if (digits && QUO_PHONE_NUMBER_EMOJI_MAP[digits]) {
    return QUO_PHONE_NUMBER_EMOJI_MAP[digits];
  }

  if (digits.length === 10 && QUO_PHONE_NUMBER_EMOJI_MAP[`1${digits}`]) {
    return QUO_PHONE_NUMBER_EMOJI_MAP[`1${digits}`];
  }

  return "📱";
}

/**
 * Returns official QUO Number Name from DB object or dictionary mapping
 */
export function getQuoNumberName(
  numObj?: { name?: string | null; label?: string | null; display_number?: string | null; number?: string | null } | null,
  fallbackRawNumber?: string | null
): string {
  if (numObj?.name && numObj.name.trim()) return numObj.name.trim();
  if (numObj?.label && numObj.label.trim()) return numObj.label.trim();

  const numToTest = numObj?.number || fallbackRawNumber || "";
  const digits = numToTest.replace(/\D/g, "");

  if (digits && QUO_PHONE_NUMBER_NAME_MAP[digits]) {
    return QUO_PHONE_NUMBER_NAME_MAP[digits];
  }

  if (digits.length === 10 && QUO_PHONE_NUMBER_NAME_MAP[`1${digits}`]) {
    return QUO_PHONE_NUMBER_NAME_MAP[`1${digits}`];
  }

  if (numObj?.display_number) return numObj.display_number;
  if (numObj?.number) return formatUsPhone(numObj.number);

  return fallbackRawNumber ? formatUsPhone(fallbackRawNumber) : "Main Line";
}

/**
 * Normalizes any legacy or custom status into one of our 6 standard QuoLeadStatuses
 */
export function normalizeQuoLeadStatus(rawStatus?: string | null): QuoLeadStatus {
  if (!rawStatus) return "raw";
  const lower = rawStatus.toLowerCase().trim();

  if (lower === "raw" || lower === "new") return "raw";
  if (lower === "spam" || lower === "junk") return "spam";
  if (lower === "contacted" || lower === "outreach") return "contacted";
  if (lower === "qualified_lead" || lower === "qualified" || lower === "urgent") return "qualified_lead";
  if (lower === "rejected" || lower === "declined" || lower === "scam") return "rejected";
  if (lower === "successfully_completed" || lower === "completed" || lower === "done") return "successfully_completed";

  return "raw";
}

/**
 * Formats any UTC date/timestamp strictly in US/Eastern Time Zone (America/New_York)
 */
export function formatEasternTime(
  dateInput: string | Date | null | undefined,
  mode: "time" | "short" | "full" = "time"
): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "—";

  try {
    if (mode === "time") {
      // e.g. "09:02 AM"
      return date.toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    }

    if (mode === "short") {
      // e.g. "Aug 8, 09:02 AM"
      return date.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    }

    // e.g. "Aug 8, 2026, 09:02 AM EDT"
    return date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  } catch (err) {
    console.error("Error formatting Eastern Time", err);
    return date.toLocaleTimeString();
  }
}

/**
 * Formats timestamp into relative local PC time:
 * - Today, 9:02 AM
 * - Yesterday, 4:15 PM
 * - Aug 12, 10:30 AM (if current year)
 * - Aug 12, 2025, 10:30 AM (if previous year)
 */
export function formatLocalRelativeTime(
  dateInput: string | Date | null | undefined,
  includeTime: boolean = true
): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "—";

  const now = new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();

  // Local calendar day comparison
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    isSameYear;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const timeStr = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (isToday) {
    return includeTime ? `Today, ${timeStr}` : "Today";
  }
  if (isYesterday) {
    return includeTime ? `Yesterday, ${timeStr}` : "Yesterday";
  }

  const dateStr = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: isSameYear ? undefined : "numeric",
  });

  return includeTime ? `${dateStr}, ${timeStr}` : dateStr;
}

/**
 * Converts a YYYY-MM-DD date string picked in Eastern Time into UTC timestamp bounds
 */
export function getEasternDateBounds(dateStr: string, boundary: "start" | "end"): Date | null {
  if (!dateStr) return null;
  try {
    const tempDate = new Date(`${dateStr}T12:00:00Z`);
    const nyTimeStr = tempDate.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
    const isEDT = nyTimeStr.includes("EDT");
    const offsetStr = isEDT ? "-04:00" : "-05:00";

    const isoStr = boundary === "start" ? `${dateStr}T00:00:00.000${offsetStr}` : `${dateStr}T23:59:59.999${offsetStr}`;
    const date = new Date(isoStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Formats phone number into standard US readable format (e.g. +1 (415) 555-0142)
 */
export function formatUsPhone(value?: string | null): string {
  if (!value) return "No number";
  const digits = value.replace(/\D/g, "");
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
  if (last10.length !== 10) return value;
  return `+1 (${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
}

/**
 * Constructs or extracts the QUO Chat Link for a conversation (my.quo.com format)
 * Example: https://my.quo.com/inbox/PNCbxD59ja/c/CN3fb9fd0bff2342c0b2523334864e4d74
 */
export function getQuoChatUrl(
  quoConversationId?: string | null,
  customerNumber?: string | null,
  quoPhoneNumberId?: string | null
): string {
  if (!quoConversationId && !customerNumber) return "#";

  if (quoConversationId && (quoConversationId.startsWith("http://") || quoConversationId.startsWith("https://"))) {
    return quoConversationId;
  }

  const pncId = quoPhoneNumberId ? quoPhoneNumberId.trim() : "";

  if (quoConversationId) {
    if (pncId) {
      return `https://my.quo.com/inbox/${pncId}/c/${quoConversationId}`;
    }
    return `https://my.quo.com/inbox/c/${quoConversationId}`;
  }

  const cleanPhone = customerNumber ? customerNumber.replace(/\D/g, "") : "";
  if (pncId) {
    return `https://my.quo.com/inbox/${pncId}?phone=${cleanPhone}`;
  }
  return `https://my.quo.com/inbox?phone=${cleanPhone}`;
}

export interface QuoExtensionResponse {
  success: boolean;
  error?: string;
}

/**
 * Opens the saved Quo conversation while the user is composing a message.
 * This is browser-only preparation and does not read or write the database.
 */
export function prepareQuoChatViaExtension(chatUrl: string): void {
  if (!chatUrl || chatUrl === "#") return;
  window.postMessage(
    {
      action: "QUO_PREPARE_CHAT",
      chatUrl,
    },
    "*",
  );
}

/**
 * Sends a message via Chrome Extension postMessage and awaits QUO_SEND_MESSAGE_RESPONSE
 */
export function sendQuoMessageViaExtension(
  chatUrl: string,
  message: string,
  timeoutMs: number = 45000
): Promise<QuoExtensionResponse> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function handleMessageResponse(event: MessageEvent) {
      if (event.data && event.data.action === "QUO_SEND_MESSAGE_RESPONSE") {
        window.removeEventListener("message", handleMessageResponse);
        if (timer) clearTimeout(timer);
        resolve({
          success: !!event.data.success,
          error: event.data.error,
        });
      }
    }

    window.addEventListener("message", handleMessageResponse);

    // Timeout fallback (in case extension is not active/installed)
    timer = setTimeout(() => {
      window.removeEventListener("message", handleMessageResponse);
      resolve({
        success: false,
        error: "Extension not detected. If you just installed it, please refresh this CRM page once.",
      });
    }, timeoutMs);

    // Post message to extension
    try {
      window.postMessage(
        {
          action: "QUO_SEND_MESSAGE",
          chatUrl,
          message,
        },
        "*"
      );
    } catch (err) {
      window.removeEventListener("message", handleMessageResponse);
      if (timer) clearTimeout(timer);
      resolve({
        success: false,
        error: (err as { message?: string } | null)?.message || "Failed to dispatch postMessage to window",
      });
    }
  });
}

/**
 * Triggers QUO_SCHEDULE_MESSAGE via Chrome Extension postMessage and awaits QUO_SEND_MESSAGE_RESPONSE
 */
export function scheduleQuoMessageViaExtension(
  chatUrl: string,
  message: string,
  scheduleTime: string,
  timeoutMs: number = 60000
): Promise<QuoExtensionResponse> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function handleMessageResponse(event: MessageEvent) {
      if (event.data && event.data.action === "QUO_SEND_MESSAGE_RESPONSE") {
        window.removeEventListener("message", handleMessageResponse);
        if (timer) clearTimeout(timer);
        resolve({
          success: !!event.data.success,
          error: event.data.error,
        });
      }
    }

    window.addEventListener("message", handleMessageResponse);

    // Timeout fallback (in case extension is not active/installed)
    timer = setTimeout(() => {
      window.removeEventListener("message", handleMessageResponse);
      resolve({
        success: false,
        error: "Extension not detected. If you just installed it, please refresh this CRM page once.",
      });
    }, timeoutMs);

    // Post message to extension
    try {
      window.postMessage(
        {
          action: "QUO_SCHEDULE_MESSAGE",
          chatUrl,
          message,
          scheduleTime,
        },
        "*"
      );
    } catch (err) {
      window.removeEventListener("message", handleMessageResponse);
      if (timer) clearTimeout(timer);
      resolve({
        success: false,
        error: (err as { message?: string } | null)?.message || "Failed to dispatch postMessage to window",
      });
    }
  });
}
