export interface ExtensionRelease {
  name: string;
  version: string;
  releasedAt: string;
  summary: string;
}

export interface InstalledExtension {
  version: string;
  releasedAt?: string;
}

export const isExtensionVersion = (value: unknown): value is string =>
  typeof value === "string" && /^\d+\.\d+\.\d+(\.\d+)?$/.test(value);

export function isNewerExtension(latest: string, installed: string): boolean {
  const a = latest.split(".").map(Number);
  const b = installed.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

export function formatExtensionReleaseDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(new Date(value));
}

export async function fetchExtensionRelease(): Promise<ExtensionRelease> {
  const response = await fetch("/extension-release.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not check the latest Donut release");
  const data = await response.json();
  if (!isExtensionVersion(data.version) || typeof data.releasedAt !== "string" ||
    Number.isNaN(Date.parse(data.releasedAt)) || typeof data.summary !== "string") {
    throw new Error("Invalid Donut release information");
  }
  return data;
}

/** Old ZIP installations do not implement this handshake; null is unknown, not current. */
export function detectInstalledExtension(): Promise<InstalledExtension | null> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (value: InstalledExtension | null) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== window.location.origin ||
        data?.action !== "DONUT_VERSION_RESPONSE" || data.requestId !== requestId || !isExtensionVersion(data.version)) return;
      finish({ version: data.version, releasedAt: data.releasedAt });
    };
    const timer = window.setTimeout(() => finish(null), 2000);
    window.addEventListener("message", onMessage);
    window.postMessage({ action: "DONUT_VERSION_REQUEST", requestId }, window.location.origin);
  });
}
