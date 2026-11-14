// Donut and the CRM call the same role-enforced assessment API. No AI/API keys
// or technician-flag writes belong in the extension.
(function initializeTechnicianWorkflow() {
  const panel = document.getElementById("technician-intelligence");
  const container = document.getElementById("lead-capture-container");
  const feedback = document.getElementById("technician-feedback");
  const picker = document.getElementById("technician-picker");
  const find = document.getElementById("technician-find");
  const review = document.getElementById("technician-review");
  const save = document.getElementById("technician-save-labels");
  const report = document.getElementById("technician-report");
  const workflow = document.getElementById("technician-open-workflow");
  const coverage = document.getElementById("technician-coverage-analytics");
  let selectedId = null;
  let busy = false;
  const labels = { tech_dont_respond: "Tech doesn't respond", tech_is_scammer: "Scam evidence", late_payment: "Late payment", never_responded: "Never responded", high_rates: "High rates", dont_cooperate: "Doesn't cooperate", rude: "Rude", paid_us_before: "Paid us before", good_tech: "Good Tech" };
  const call = async (payload) => {
    const response = await chrome.runtime.sendMessage({ type: "TECHNICIAN_WORKFLOW", payload });
    if (!response?.success) throw new Error(response?.error || "Technician workflow is unavailable.");
    return response;
  };
  const refreshAccess = async () => {
    const auth = await chrome.runtime.sendMessage({ type: "CHECK_AUTH" });
    panel.hidden = !auth?.success || !["admin", "processor"].includes(auth.role);
    if (!panel.hidden) {
      const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
      workflow.href = `${settings.settings.apiBaseUrl.replace(/\/$/, "")}/technicians${selectedId ? `?workflow=${encodeURIComponent(selectedId)}` : "?view=workflow"}`;
      if (coverage) { coverage.hidden = auth.role !== "admin"; coverage.href = `${settings.settings.apiBaseUrl.replace(/\/$/, "")}/analytics`; }
    }
  };
  const setBusy = (value) => { busy = value; find.disabled = value; review.disabled = value || !selectedId; save.disabled = value || !selectedId; picker.disabled = value; };
  const text = (value, tag = "p") => { const element = document.createElement(tag); element.textContent = value; report.append(element); };

  find.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    feedback.textContent = "Finding the technician for the captured phone number…";
    report.replaceChildren();
    save.hidden = true;
    try {
      const draft = await chrome.runtime.sendMessage({ type: "GET_DRAFT" });
      const response = await call({ action: "resolve_technician", phone: draft.draft.customerNumber });
      picker.replaceChildren();
      for (const tech of response.technicians) {
        const option = document.createElement("option"); option.value = tech.id;
        option.textContent = `${tech.name || "Unnamed technician"} · ${tech.phone_number}${tech.area ? ` · ${tech.area}` : ""}`;
        picker.append(option);
      }
      selectedId = response.technicians[0]?.id || null;
      feedback.textContent = selectedId ? "Confirm the technician below, then review. Duplicate phone matches are listed separately." : "No technician matches this captured phone. Select a technician in the CRM directory or on the map.";
      await refreshAccess();
    } catch (error) { feedback.textContent = error.message; selectedId = null; }
    finally { setBusy(false); }
  });
  picker.addEventListener("change", () => { selectedId = picker.value; report.replaceChildren(); save.hidden = true; void refreshAccess().catch(() => {}); });
  review.addEventListener("click", async () => {
    if (busy || !selectedId) return;
    setBusy(true);
    feedback.textContent = "Reviewing the latest available chat evidence and job history. This can take up to two minutes…";
    report.replaceChildren();
    save.hidden = true;
    try {
      const stored = await call({ action: "load", technicianIds: [selectedId] });
      const response = await call({ action: "assess", technicianIds: [selectedId] });
      const result = response.results?.find(item => item.technicianId === selectedId);
      if (!result) throw new Error("No report was returned. Retry this technician.");
      text(`${result.jobCounts.completed ?? "Unknown"} completed jobs · ${result.jobCounts.paid ?? "Unknown"} paid jobs`, "strong");
      text(result.summary);
      text(`${result.messagesReviewed} messages · ${result.chatSource || "CRM mirror"}${result.historyLimited ? " · Limited recent-history sample" : ""}`);
      if (result.jobCounts.error) text(result.jobCounts.error);
      for (const item of result.evidence || []) text(`${item.source}: ${item.quote}${item.message_time ? ` (${new Date(item.message_time).toLocaleString(undefined, { hour12: true })})` : ""}`, "blockquote");
      feedback.textContent = result.error || (result.messagesReviewed ? "Review complete. Confirm evidence and save your reviewed labels, or open the full workflow for next actions." : "No chat evidence was available. Missing history does not establish misconduct.");
      text("Your reviewed labels (saved only when you click Save):", "strong");
      const reviewed = stored.assessments?.[0]?.labels ?? (result.error ? [] : result.labels);
      for (const [key, name] of Object.entries(labels)) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = key; checkbox.checked = reviewed.includes(key);
        label.append(checkbox, document.createTextNode(` ${name}`)); report.append(label);
      }
      save.hidden = false;
    } catch (error) { feedback.textContent = error.message; }
    finally { setBusy(false); }
  });
  save.addEventListener("click", async () => {
    if (busy || !selectedId) return;
    setBusy(true);
    try {
      await call({ action: "save_labels", technicianId: selectedId, labels: Array.from(report.querySelectorAll('input:checked')).map(input => input.value) });
      feedback.textContent = "Reviewed labels saved. Inactivity and Good Tech flags are separate reviewed actions in the full workflow.";
    } catch (error) { feedback.textContent = error.message; }
    finally { setBusy(false); }
  });
  new MutationObserver(() => { if (!container.hidden) void refreshAccess().catch(() => { panel.hidden = true; }); }).observe(container, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("focus", () => { void refreshAccess().catch(() => { panel.hidden = true; }); });
  void refreshAccess().catch(() => {});
})();
