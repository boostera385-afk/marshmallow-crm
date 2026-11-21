/** Format a phone string to US format: (XXX) XXX-XXXX */
export function formatUSPhone(value: string): string {
  const rawDigits = value.replace(/\D/g, "");
  const digits = rawDigits.length === 11 && rawDigits.startsWith("1")
    ? rawDigits.slice(1, 11)
    : rawDigits.slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * The national (10-digit) part of a typed or pasted US number. Accepts any
 * spacing/punctuation (spaces, NBSP, dots, dashes, parens) and drops a leading
 * US country code: "+1 305 555 0123", "1-305-555-0123", "305.555.0123" all give
 * "3055550123". Extra digits are kept so callers can flag them, never guess.
 */
export function usNationalDigits(value: string): string {
  const trimmed = value.trim();
  const digits = stripPhone(trimmed);
  if (digits.startsWith("1") && (digits.length === 11 || trimmed.startsWith("+1"))) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Format a phone field while the user types or pastes. Unlike formatUSPhone it
 * never discards digits past the tenth: they stay visible so validateUSPhone
 * can report them instead of silently saving a different number.
 */
export function formatUSPhoneInput(value: string): string {
  const digits = usNationalDigits(value);
  const main = formatUSPhone(digits.slice(0, 10));
  return digits.length > 10 ? `${main} ${digits.slice(10)}` : main;
}

/** Validate an optional US phone field. Empty is allowed; returns an error message or null. */
export function validateUSPhone(value: string | null | undefined): string | null {
  const raw = String(value ?? "");
  if (!raw.trim()) return null;
  const digits = usNationalDigits(raw);
  if (digits.length === 0) return "Enter a phone number using digits";
  if (digits.length < 10) return `Phone number is incomplete — enter all 10 digits (${digits.length} entered)`;
  if (digits.length > 10) return "Too many digits — enter a 10-digit US phone number";
  if (/^[01]/.test(digits)) return "Area code can't start with 0 or 1";
  return null;
}

/** First invalid phone among labelled fields, as "<Label>: <reason>", or null when all are valid/empty. */
export function firstPhoneError(fields: ReadonlyArray<readonly [label: string, value: string | null | undefined]>): string | null {
  for (const [label, value] of fields) {
    const error = validateUSPhone(value);
    if (error) return `${label}: ${error}`;
  }
  return null;
}

/** Strip formatting to get raw digits */
export function stripPhone(value: string): string {
  return value.replace(/\D/g, "");
}

/** Normalize a phone number to E.164 when the country code can be inferred safely. */
export function normalizePhoneE164(value: string, defaultCountryCode = "1"): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const digits = stripPhone(trimmed);
  if (!digits) return null;

  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (digits.length === 10) {
    return `+${defaultCountryCode}${digits}`;
  }

  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }

  return null;
}

/** Build a safe tel: href from a display phone value. Preserves leading +, strips other non-digits. */
export function toTelHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${hasPlus ? "+" : ""}${digits}`;
}

/** Lightweight validation: at least 6 digits, plus optional +, spaces, parens, dashes, dots, "ext"/"x" for extensions. */
export function isLikelyPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!/^[+0-9 ()\-.\u00a0]*(?:\s*(?:ext\.?|x)\s*\d+)?$/i.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 20;
}

/** Digits-only signature for search matching. */
export function phoneDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Copy to clipboard with a safe fallback for insecure contexts. */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** A lead needs a way to reach the customer: a cell phone, a landline, or both. */
export function hasContactNumber(cell?: string | null, landline?: string | null): boolean {
  return stripPhone(cell ?? "").length > 0 || stripPhone(landline ?? "").length > 0;
}
