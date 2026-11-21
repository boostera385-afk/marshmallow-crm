// Shared by the native panel and service worker; mirrors src/lib/phone.ts
// (usNationalDigits / formatUSPhoneInput / validateUSPhone). No network work.
globalThis.DonutPhone = (() => {
  function nationalDigits(value) {
    const trimmed = String(value ?? "").trim();
    const digits = trimmed.replace(/\D/g, "");
    if (digits.startsWith("1") && (digits.length === 11 || trimmed.startsWith("+1"))) return digits.slice(1);
    return digits;
  }

  function formatTen(digits) {
    if (digits.length === 0) return "";
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // Typed or pasted input -> (XXX) XXX-XXXX. Digits past the tenth stay visible
  // so validate() can report them instead of saving a different number.
  function format(value) {
    const digits = nationalDigits(value);
    const main = formatTen(digits.slice(0, 10));
    return digits.length > 10 ? `${main} ${digits.slice(10)}` : main;
  }

  // Empty is allowed; returns an error message or null.
  function validate(value) {
    const raw = String(value ?? "");
    if (!raw.trim()) return null;
    const digits = nationalDigits(raw);
    if (digits.length === 0) return "Enter a phone number using digits";
    if (digits.length < 10) return `Phone number is incomplete — enter all 10 digits (${digits.length} entered)`;
    if (digits.length > 10) return "Too many digits — enter a 10-digit US phone number";
    if (/^[01]/.test(digits)) return "Area code can't start with 0 or 1";
    return null;
  }

  return { nationalDigits, format, validate };
})();
