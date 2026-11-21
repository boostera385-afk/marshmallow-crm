import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const background = readFileSync("tmp_extension/quo-crm-extension/background.js", "utf8").replace(/\r\n/g, "\n");
const panel = readFileSync("tmp_extension/quo-crm-extension/sidepanel.js", "utf8");
const DonutQuote = runInNewContext(readFileSync("tmp_extension/quo-crm-extension/quote-breakdown.js", "utf8") + "; globalThis.DonutQuote");
const DonutPhone = runInNewContext(readFileSync("tmp_extension/quo-crm-extension/phone-format.js", "utf8") + "; globalThis.DonutPhone");

describe("Donut shared-flow regression checks", () => {
  it("uses the same authenticated address function and keeps returned unit details", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { match: { latitude: 37.7, longitude: -122.4, matchedAddress: "755 Vienna St, #4B, San Francisco, CA", provider: "census" } }, error: null });
    const handler = background.slice(background.indexOf("async function geocodeCensusAddress("), background.indexOf("async function ensureDraft("));
    const geocode = runInNewContext(`${handler}; geocodeCensusAddress`, { supabaseClient: { functions: { invoke } }, CENSUS_GEOCODE_CACHE: new Map(), AbortSignal: { timeout: () => new AbortController().signal } });
    expect(await geocode("755 Vienna St #4B, San Francisco CA")).toMatchObject({ matchedAddress: expect.stringContaining("#4B"), provider: "census" });
    expect(invoke).toHaveBeenCalledWith("geocode-lead-address", expect.objectContaining({ body: { address: "755 Vienna St #4B, San Francisco CA" } }));
  });

  it.each(["google", undefined])("refuses %s coordinate responses in Donut", async (provider) => {
    const invoke = vi.fn().mockResolvedValue({ data: { match: { latitude: 37.7, longitude: -122.4, provider } }, error: null });
    const handler = background.slice(background.indexOf("async function geocodeCensusAddress("), background.indexOf("async function ensureDraft("));
    const cache = new Map();
    const geocode = runInNewContext(`${handler}; geocodeCensusAddress`, { supabaseClient: { functions: { invoke } }, CENSUS_GEOCODE_CACHE: cache, AbortSignal: { timeout: () => new AbortController().signal } });
    await expect(geocode("755 Vienna St San Francisco CA")).rejects.toThrow("must come from Census");
    expect(cache.size).toBe(0);
  });

  it("does not report a confirmed saved lead as failed when draft cleanup fails", async () => {
    const showFeedback = vi.fn();
    const button = { disabled: false, innerHTML: "" };
    const sendMessage = vi.fn().mockResolvedValueOnce({ success: true, response: { leadUrl: "https://crm.example/leads/saved" } }).mockRejectedValueOnce(new Error("Chrome storage failed"));
    const handler = panel.slice(panel.indexOf("async function handleCreateLead("), panel.indexOf("const UPDATE_SCHEDULE_BUTTON_HTML"));
    const create = runInNewContext(`${handler}; handleCreateLead`, {
      clearFeedback: vi.fn(), createLeadButton: button, chrome: { runtime: { sendMessage } }, showFeedback,
      escapeHtml: (text: string) => text, renderDraft: vi.fn(), resetTransientFormState: vi.fn(),
      DonutPhone, form: { customerNumber: { value: "(415) 555-0123", focus: vi.fn() } },
    });
    await create({ preventDefault: vi.fn() });
    expect(showFeedback).toHaveBeenCalledWith(expect.stringContaining("Lead saved. Draft cleanup failed"), "info", true);
    expect(button.disabled).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("blocks Create Lead in the panel for an incomplete customer phone and focuses the field", async () => {
    const showFeedback = vi.fn();
    const button = { disabled: false, innerHTML: "" };
    const sendMessage = vi.fn();
    const focus = vi.fn();
    const showCustomerPhoneError = vi.fn();
    const handler = panel.slice(panel.indexOf("async function handleCreateLead("), panel.indexOf("const UPDATE_SCHEDULE_BUTTON_HTML"));
    const create = runInNewContext(`${handler}; handleCreateLead`, {
      clearFeedback: vi.fn(), createLeadButton: button, chrome: { runtime: { sendMessage } }, showFeedback,
      DonutPhone, form: { customerNumber: { value: "(415) 555", focus } }, showCustomerPhoneError,
    });
    await create({ preventDefault: vi.fn() });
    expect(showFeedback).toHaveBeenCalledWith("Customer Phone: Phone number is incomplete — enter all 10 digits (6 entered)", "error");
    expect(focus).toHaveBeenCalled();
    expect(showCustomerPhoneError).toHaveBeenCalledWith("Phone number is incomplete — enter all 10 digits (6 entered)");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  describe("Donut Customer Phone input", () => {
    const start = panel.indexOf("async function handleFormInput(");
    const handler = panel.slice(start, panel.indexOf("\n}", start) + 2);
    const setup = (previous: string) => {
      const sendMessage = vi.fn();
      const showCustomerPhoneError = vi.fn();
      const ctx = {
        EDITABLE_FIELDS: ["customerNumber"], currentDraft: { customerNumber: previous }, DonutPhone, showCustomerPhoneError,
        formatPhoneNumber: (v: string) => DonutPhone.format(v),
        formatPhoneInput: (input: { value: string }) => { input.value = DonutPhone.format(input.value); },
        invalidateLeadCheckWhenPhoneChanges: vi.fn(), updateScheduleRequirementButtonState: vi.fn(), updateQuoteFieldVisibility: vi.fn(),
        chrome: { runtime: { sendMessage } }, form: {},
      };
      const handle = runInNewContext(`${handler}; handleFormInput`, ctx);
      return { handle, sendMessage, showCustomerPhoneError };
    };

    it("auto-fixes a pasted number with spaces and country code", async () => {
      const { handle, sendMessage, showCustomerPhoneError } = setup("");
      const target = { name: "customerNumber", type: "tel", value: " +1 305 555 0123 " };
      await handle({ target });
      expect(target.value).toBe("(305) 555-0123");
      expect(showCustomerPhoneError).toHaveBeenCalledWith(null);
      expect(sendMessage).toHaveBeenCalledWith({ type: "UPDATE_DRAFT", payload: { customerNumber: "(305) 555-0123" } });
    });

    it("refuses an 11th digit, keeps the previous number and explains why", async () => {
      const { handle, sendMessage, showCustomerPhoneError } = setup("(305) 555-0123");
      const target = { name: "customerNumber", type: "tel", value: "(305) 555-01234" };
      await handle({ target });
      expect(target.value).toBe("(305) 555-0123");
      expect(showCustomerPhoneError).toHaveBeenCalledWith(expect.stringContaining("Only 10 digits allowed — that would make 11"));
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("refuses a long non-US paste instead of truncating it", async () => {
      const { handle, sendMessage } = setup("");
      const target = { name: "customerNumber", type: "tel", value: "+44 20 7946 0958" };
      await handle({ target });
      expect(target.value).toBe("");
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  it("refuses overlapping extension submissions", async () => {
    let finish!: (value: unknown) => void;
    const save = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = background.slice(background.indexOf("let leadCreationInFlight"), background.indexOf("async function saveLeadDraft("));
    const create = runInNewContext(`${wrapper}; createLead`, { saveLeadDraft: save });
    const first = create();
    await expect(create()).rejects.toThrow("already being saved");
    finish({ success: true });
    await first;
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each(["yes", "no"])("saves split quote with materials %s and recovers the same lead without reuploading photos", async (materialsIncluded) => {
    const draft = { customerName: "Fixture Customer", customerNumber: "4155550123", customerAddress: "", serviceName: "Cleaning", serviceDetails: "Fixture service", scheduleRequirement: "", quote: "", terms: "quoted", laborAmount: "200", materialsIncluded, materialAmount: "60", leadStatus: "default", sourceUrl: "", numberName: "", referenceName: "", photos: ["https://example.com/photo.png"] };
    const lead = { id: "fixture-lead", customer_phone: draft.customerNumber, customer_name: draft.customerName };
    const storage: Record<string, string> = {};
    let linkedPhoto = false;
    let inserted = false;
    const upload = vi.fn(async () => ({ error: null }));
    const release = vi.fn();
    const find = vi.fn(async () => lead);
    const photoQuery = {
      select: () => photoQuery, eq: () => photoQuery, like: () => photoQuery,
      maybeSingle: async () => ({ data: linkedPhoto ? { id: "photo" } : null, error: null }),
      insert: async () => { linkedPhoto = true; return { error: null }; },
    };
    const insertQuery = {
      select: () => insertQuery, single: () => insertQuery,
      abortSignal: async () => {
        if (inserted) return { data: null, error: { code: "23505", message: "Duplicate job ID" } };
        inserted = true; return { data: lead, error: null };
      },
    };
    const handler = background.slice(background.indexOf("async function saveLeadDraft("), background.indexOf("/**\n * Run the conversation check"));
    const insert = vi.fn(() => insertQuery);
    const save = runInNewContext(`${handler}; saveLeadDraft`, {
      getDraft: async () => draft, getUserProfile: async () => ({ role: "admin" }),
      getSettings: async () => ({ apiBaseUrl: "https://crm.example" }),
      chrome: { storage: { local: { get: async () => storage } } },
      PENDING_JOB_KEY: "job", PENDING_DRAFT_KEY: "identity", LEAD_INSERT_TIMEOUT_MS: 45000,
      generateJobId: () => "fixture-job", reserveJobId: async (job: string, identity: string) => { storage.job = job; storage.identity = identity; },
      releaseJobId: release, findLeadByJobId: find, comparePhones: (a: string, b: string) => a === b,
      normalizeLeadStatus: () => "default", normalizeLeadTerms: () => "quoted", DonutQuote, DonutPhone, AbortController, setTimeout, clearTimeout,
      fetch: async () => ({ ok: true, headers: { get: () => "image/png" }, blob: async () => new Blob(["fixture"]) }),
      supabaseClient: { auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } } }) },
        from: (table: string) => table === "leads" ? { insert } : photoQuery,
        storage: { from: () => ({ upload }) } },
    });
    expect((await save()).success).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ terms: "quoted", labor_amount: 200, material_amount: materialsIncluded === "yes" ? 60 : null }));
    expect((await save()).success).toBe(true);
    expect(find).toHaveBeenCalledWith("fixture-job", "fixture-user");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(storage.job).toBe("fixture-job");
    expect(release).not.toHaveBeenCalled();
    draft.serviceDetails = "Changed capture";
    await expect(save()).rejects.toThrow("different draft");
  });

  it.each([
    ["(415) 555-01", "Customer Phone: Phone number is incomplete — enter all 10 digits (8 entered)"],
    ["(130) 555-5012", "Customer Phone: Area code can't start with 0 or 1"],
    ["(415) 555-0123 99", "Customer Phone: Too many digits — enter a 10-digit US phone number"],
  ])("refuses to save customer phone %j and never inserts a lead", async (customerNumber, message) => {
    const draft = { customerName: "Fixture Customer", customerNumber, customerAddress: "", serviceName: "", serviceDetails: "", scheduleRequirement: "", quote: "", terms: "", laborAmount: "", materialsIncluded: "no", materialAmount: "", leadStatus: "default", sourceUrl: "", numberName: "", referenceName: "", photos: [] };
    const handler = background.slice(background.indexOf("async function saveLeadDraft("), background.indexOf("/**\n * Run the conversation check"));
    const insert = vi.fn();
    const reserveJobId = vi.fn();
    const save = runInNewContext(`${handler}; saveLeadDraft`, {
      getDraft: async () => draft, DonutQuote, DonutPhone, reserveJobId,
      chrome: { storage: { local: { get: async () => ({}) } } },
      supabaseClient: { auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } } }) }, from: () => ({ insert }) },
    });
    await expect(save()).rejects.toThrow(message);
    expect(reserveJobId).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
