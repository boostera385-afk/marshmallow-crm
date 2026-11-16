import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { document.body.innerHTML = ""; });

it("Donut's real form handler toggles materials and clears both the draft and input on No", async () => {
  const html = readFileSync("tmp_extension/quo-crm-extension/sidepanel.html", "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.getElementById("lead-form")!.outerHTML;
  const panel = readFileSync("tmp_extension/quo-crm-extension/sidepanel.js", "utf8");
  const constants = panel.slice(panel.indexOf("const EDITABLE_FIELDS ="), panel.indexOf("const ADDRESS_PROVIDER_NAME"));
  const input = panel.slice(panel.indexOf("async function handleFormInput("), panel.indexOf("function queueCoveragePreview("));
  const visibility = panel.slice(panel.indexOf("function updateQuoteFieldVisibility("), panel.indexOf("function queueAddressSuggestions("));
  const materialAmount = document.getElementById("quote-materials") as HTMLInputElement;
  const choice = document.getElementById("quote-materials-choice") as HTMLSelectElement;
  const sendMessage = vi.fn().mockResolvedValue({ success: true });
  const handlers = runInNewContext(`${constants}\n${input}\n${visibility}\n({ input: handleFormInput, visibility: updateQuoteFieldVisibility, draft: () => currentDraft })`, {
    document, form: { materialAmount }, quoteField: document.getElementById("quote-field"),
    currentDraft: { terms: "quoted", laborAmount: "200", materialsIncluded: "no", materialAmount: "" },
    chrome: { runtime: { sendMessage } }, invalidateLeadCheckWhenPhoneChanges: vi.fn(), updateScheduleRequirementButtonState: vi.fn(),
  });
  choice.value = "yes";
  await handlers.input({ target: choice });
  expect(document.getElementById("materials-amount-field")!.hidden).toBe(false);
  materialAmount.value = "60";
  await handlers.input({ target: materialAmount });
  choice.value = "no";
  await handlers.input({ target: choice });
  expect(document.getElementById("materials-amount-field")!.hidden).toBe(true);
  expect(materialAmount.value).toBe("");
  expect(handlers.draft()).toMatchObject({ laborAmount: "200", materialAmount: "", materialsIncluded: "no" });
  expect(sendMessage).toHaveBeenLastCalledWith({ type: "UPDATE_DRAFT", payload: { materialsIncluded: "no", materialAmount: "" } });
});

it("Donut shows one Diagnostic/Service Call Fee field and hides materials and quote notes for that term", () => {
  const html = readFileSync("tmp_extension/quo-crm-extension/sidepanel.html", "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.getElementById("lead-form")!.outerHTML;
  expect((document.getElementById("terms-diagnostic") as HTMLInputElement).value).toBe("diagnostic_service_call");
  const panel = readFileSync("tmp_extension/quo-crm-extension/sidepanel.js", "utf8");
  const visibility = panel.slice(panel.indexOf("function updateQuoteFieldVisibility("), panel.indexOf("function queueAddressSuggestions("));
  const update = runInNewContext(`${visibility}\nupdateQuoteFieldVisibility`, {
    document, quoteField: document.getElementById("quote-field"), currentDraft: { materialsIncluded: "yes" },
  });
  const byId = (id: string) => document.getElementById(id)!;
  update("diagnostic_service_call");
  expect(byId("quote-field").hidden).toBe(false);
  expect(byId("quote-labor-label").textContent).toBe("Diagnostic/Service Call Fee ($)");
  expect(byId("quote-materials-section").hidden).toBe(true);
  expect(byId("materials-amount-field").hidden).toBe(true);
  expect(byId("quote-notes-field").hidden).toBe(true);
  update("quoted");
  expect(byId("quote-labor-label").textContent).toBe("Customer Labor ($)");
  expect(byId("quote-materials-section").hidden).toBe(false);
  expect(byId("materials-amount-field").hidden).toBe(false);
  expect(byId("quote-notes-field").hidden).toBe(false);
  update("free_estimate");
  expect(byId("quote-field").hidden).toBe(true);
});
