// Shared by the native panel and service worker; no credentials or network work.
globalThis.DonutQuote = {
  fields(draft) {
    const terms = draft.terms === "quoted" || draft.terms === "free_estimate" ? draft.terms : null;
    if (terms !== "quoted") return { terms, labor_amount: null, material_amount: null };
    const labor = String(draft.laborAmount ?? "").trim();
    const materials = String(draft.materialAmount ?? "").trim();
    if (labor && (!Number.isFinite(Number(labor)) || Number(labor) < 0)) throw new Error("Enter a valid non-negative labor amount");
    const includesMaterials = draft.materialsIncluded === "yes";
    if (includesMaterials && (!materials || !Number.isFinite(Number(materials)) || Number(materials) <= 0)) throw new Error("Enter a positive Parts/Materials amount or choose No");
    return { terms, labor_amount: labor ? Number(labor) : null, material_amount: includesMaterials ? Number(materials) : null };
  }
};
