import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  firstPhoneError,
  formatUSPhone,
  formatUSPhoneInput,
  hasContactNumber,
  normalizePhoneE164,
  usNationalDigits,
  validateUSPhone,
} from "@/lib/phone";

const donutPhone = runInNewContext(
  readFileSync("tmp_extension/quo-crm-extension/phone-format.js", "utf8") + "; globalThis.DonutPhone",
) as { format: (v: string) => string; validate: (v: string) => string | null; nationalDigits: (v: string) => string };

describe("formatUSPhone", () => {
  it("formats a 10-digit US phone number", () => {
    expect(formatUSPhone("3055550123")).toBe("(305) 555-0123");
  });

  it("drops a leading US country code from 11 pasted digits", () => {
    expect(formatUSPhone("13055550123")).toBe("(305) 555-0123");
  });

  it("strips unsupported characters and ignores digits after 10", () => {
    expect(formatUSPhone("305-555-0123abc999")).toBe("(305) 555-0123");
  });
});

describe("normalizePhoneE164", () => {
  it("normalizes a 10-digit US number to E.164", () => {
    expect(normalizePhoneE164("(555) 123-4567")).toBe("+15551234567");
  });

  it("keeps an existing E.164 number", () => {
    expect(normalizePhoneE164("+92 300 1234567")).toBe("+923001234567");
  });

  it("returns null when the country code cannot be inferred safely", () => {
    expect(normalizePhoneE164("12345")).toBeNull();
  });
});

describe("hasContactNumber", () => {
  it("accepts a cell phone on its own", () => {
    expect(hasContactNumber("(305) 555-0123", "")).toBe(true);
  });

  it("accepts a landline on its own", () => {
    expect(hasContactNumber("", "(212) 555-0100")).toBe(true);
  });

  it("accepts both", () => {
    expect(hasContactNumber("(305) 555-0123", "(212) 555-0100")).toBe(true);
  });

  it("rejects a lead with neither", () => {
    expect(hasContactNumber("", "")).toBe(false);
    expect(hasContactNumber(null, undefined)).toBe(false);
    expect(hasContactNumber("   ", "()")).toBe(false);
  });
});

// Real paste shapes seen from Quo, spreadsheets, emails and phones.
const PASTES: Array<[string, string]> = [
  ["+1 305 555 0123", "(305) 555-0123"],
  ["+1 (305) 555-0123", "(305) 555-0123"],
  ["1-305-555-0123", "(305) 555-0123"],
  ["305.555.0123", "(305) 555-0123"],
  ["  305 555 0123  ", "(305) 555-0123"],
  ["305 555 0123", "(305) 555-0123"],
  ["+13055550123", "(305) 555-0123"],
  ["(305)5550123", "(305) 555-0123"],
  ["Phone: 305-555-0123", "(305) 555-0123"],
];

describe("formatUSPhoneInput (typed / pasted values)", () => {
  it.each(PASTES)("normalizes pasted %j", (input, expected) => {
    expect(formatUSPhoneInput(input)).toBe(expected);
    expect(validateUSPhone(formatUSPhoneInput(input))).toBeNull();
  });

  it("formats partial numbers while typing", () => {
    expect(formatUSPhoneInput("3")).toBe("(3");
    expect(formatUSPhoneInput("3055")).toBe("(305) 5");
    expect(formatUSPhoneInput("")).toBe("");
  });

  it("is stable when re-applied to its own output", () => {
    for (const [input] of PASTES) {
      const once = formatUSPhoneInput(input);
      expect(formatUSPhoneInput(once)).toBe(once);
    }
  });

  it("keeps extra digits visible instead of silently saving a different number", () => {
    expect(formatUSPhoneInput("+44 20 7946 0958")).toBe("(442) 079-4609 58");
    expect(validateUSPhone(formatUSPhoneInput("+44 20 7946 0958"))).toMatch(/Too many digits/);
  });

  it("strips only a leading US country code", () => {
    expect(usNationalDigits("+1 305 555 0123")).toBe("3055550123");
    expect(usNationalDigits("1305555012")).toBe("1305555012");
  });
});

describe("validateUSPhone", () => {
  it("allows an empty optional field", () => {
    expect(validateUSPhone("")).toBeNull();
    expect(validateUSPhone("   ")).toBeNull();
    expect(validateUSPhone(null)).toBeNull();
  });

  it("reports an incomplete number with the digit count", () => {
    expect(validateUSPhone("(305) 555-01")).toBe("Phone number is incomplete — enter all 10 digits (8 entered)");
  });

  it("rejects text with no digits", () => {
    expect(validateUSPhone("abc")).toBe("Enter a phone number using digits");
  });

  it("rejects an area code starting with 0 or 1 (e.g. a mistyped leading 1)", () => {
    expect(validateUSPhone("(130) 555-5012")).toBe("Area code can't start with 0 or 1");
    expect(validateUSPhone("(012) 555-0123")).toBe("Area code can't start with 0 or 1");
  });

  it("accepts a complete number", () => {
    expect(validateUSPhone("(305) 555-0123")).toBeNull();
  });
});

describe("firstPhoneError", () => {
  it("names the first invalid field", () => {
    expect(firstPhoneError([["Cell Phone", "(305) 555-0123"], ["Landline", "(212) 55"]])).toBe(
      "Landline: Phone number is incomplete — enter all 10 digits (5 entered)",
    );
  });

  it("returns null when every field is valid or empty", () => {
    expect(firstPhoneError([["Cell Phone", ""], ["Landline", "(212) 555-0100"]])).toBeNull();
  });
});

describe("Donut phone-format.js parity", () => {
  const samples = [
    ...PASTES.map(([input]) => input),
    "", "3", "3055", "(305) 555-01", "+44 20 7946 0958", "(130) 555-5012", "abc", "305-555-0123 ext 12",
  ];

  it.each(samples)("formats %j exactly like the CRM", (input) => {
    expect(donutPhone.format(input)).toBe(formatUSPhoneInput(input));
  });

  it.each(samples)("validates %j exactly like the CRM", (input) => {
    expect(donutPhone.validate(input)).toBe(validateUSPhone(input));
  });

  it("no longer mangles a pasted +1 number (was \"+13 0555 5012 3\")", () => {
    expect(donutPhone.format("+1 305 555 0123")).toBe("(305) 555-0123");
  });
});
