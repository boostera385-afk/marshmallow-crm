// Same release details in the side panel and settings. ZIP updates are manual.
(async function initializeReleaseStatus() {
  const version = chrome.runtime.getManifest().version;
  const status = document.getElementById("donut-release-status");
  const notice = document.getElementById("donut-update-notice");
  const formatDate = (value) => new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short"
  }).format(new Date(value));
  status.textContent = `Donut v${version}`;
  try {
    const local = await (await fetch(chrome.runtime.getURL("release.json"))).json();
    status.textContent = `Donut v${version} • Released ${formatDate(local.releasedAt)}`;
  } catch { /* Keep the actual manifest version visible even if metadata is missing. */ }

  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
      const crm = new URL(result.settings.apiBaseUrl);
      if (!/^https?:$/.test(crm.protocol)) return;
      const response = await fetch(new URL("/extension-release.json", crm), { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) return;
      const latest = await response.json();
      if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(latest.version) || Number.isNaN(Date.parse(latest.releasedAt))) return;
      const a = latest.version.split(".").map(Number);
      const b = version.split(".").map(Number);
      const diff = Array.from({ length: 4 }, (_, i) => (a[i] || 0) - (b[i] || 0)).find(value => value !== 0);
      notice.hidden = !(diff > 0);
      if (!notice.hidden) {
        notice.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = `Please update Donut to v${latest.version}`;
        const details = document.createElement("p");
        details.textContent = `Installed v${version}. Latest release: ${formatDate(latest.releasedAt)}. Download the ZIP, replace the existing unpacked folder contents, reload Donut in chrome://extensions, then refresh CRM and Quo tabs.`;
        const link = document.createElement("a");
        link.href = new URL(`/Donut.zip?v=${latest.version}`, crm).href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `Download Donut v${latest.version} ZIP`;
        notice.append(title, details, link);
      }
    } catch { /* Offline checks leave any previously discovered update visible. */ }
    finally { checking = false; }
  };
  void check();
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.crmSettings) void check(); });
  window.setInterval(check, 60000);
})();
