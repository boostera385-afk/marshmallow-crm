// Shared by the native panel and service worker; no credentials or network work.
globalThis.DonutQuote = {
  fields(draft) {
    const terms = ["quoted", "free_estimate", "diagnostic_service_call"].includes(draft.terms) ? draft.terms : null;
    const labor = String(draft.laborAmount ?? "").trim();
    if (terms === "diagnostic_service_call") {
      // One diagnostic/service call fee, saved in labor_amount as the CRM does; no materials.
      if (labor && (!Number.isFinite(Number(labor)) || Number(labor) < 0)) throw new Error("Enter a valid non-negative diagnostic fee");
      return { terms, labor_amount: labor ? Number(labor) : null, material_amount: null };
    }
    if (terms !== "quoted") return { terms, labor_amount: null, material_amount: null };
    const materials = String(draft.materialAmount ?? "").trim();
    if (labor && (!Number.isFinite(Number(labor)) || Number(labor) < 0)) throw new Error("Enter a valid non-negative labor amount");
    const includesMaterials = draft.materialsIncluded === "yes";
    if (includesMaterials && (!materials || !Number.isFinite(Number(materials)) || Number(materials) <= 0)) throw new Error("Enter a positive Parts/Materials amount or choose No");
    return { terms, labor_amount: labor ? Number(labor) : null, material_amount: includesMaterials ? Number(materials) : null };
  }
};
