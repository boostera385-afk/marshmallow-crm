import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Puzzle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import InstallExtensionDialog from "@/components/leads/InstallExtensionDialog";
import { useExtensionRelease } from "@/hooks/useExtensionRelease";
import { detectInstalledExtension, formatExtensionReleaseDate, isNewerExtension } from "@/lib/extension-release";
import { isOperatorRole } from "@/lib/access";

export default function ExtensionUpdateStatus() {
  const { user, role } = useAuth();
  // Do not mount release polling, detection or install/update dialogs for Operators.
  if (!user || !role || isOperatorRole(role)) return null;
  return <VisibleExtensionUpdateStatus />;
}

function VisibleExtensionUpdateStatus() {
  const { user, role, canAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: release } = useExtensionRelease();
  const { data: installed, isPending } = useQuery({
    queryKey: ["installed-extension", user?.id], queryFn: detectInstalledExtension,
    staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true,
  });
  const outdated = !!release && !!installed && isNewerExtension(release.version, installed.version);
  const eligible = !!installed || role === "admin" || role === "processor" || role === "customer_service" ||
    canAccess("quick_chat") || canAccess("tech_quick_chat");

  useEffect(() => {
    if (!user || !release || isPending || !eligible || (installed && !outdated)) return;
    const key = `donut-release-notice:${user.id}:${release.version}`;
    try { if (localStorage.getItem(key)) return; } catch { /* Storage may be unavailable. */ }
    toast(outdated ? "Please update your Donut extension" : "A new Donut extension release is available", {
      id: key,
      description: `${installed ? `Installed: v${installed.version}. ` : "Installed version could not be detected. "}Latest: v${release.version} — ${formatExtensionReleaseDate(release.releasedAt)}. Download the ZIP and reload Donut in Chrome.`,
      duration: 15000, action: { label: "Update instructions", onClick: () => setOpen(true) },
    });
    try { localStorage.setItem(key, "shown"); } catch { /* The persistent status button remains available. */ }
    return () => { toast.dismiss(key); };
  }, [user, release, installed, isPending, eligible, outdated]);

  return <>
    <Button variant="outline" size="sm" className={`h-9 gap-1.5 rounded-xl text-xs ${outdated ? "border-amber-500/50 text-amber-600 dark:text-amber-400" : ""}`}
      onClick={() => setOpen(true)} aria-label="Donut extension version and update instructions"
      title={release ? `Latest Donut v${release.version} • ${formatExtensionReleaseDate(release.releasedAt)}${installed ? ` • Installed v${installed.version}` : " • Installed version not detected"}` : "Donut extension information"}>
      <Puzzle className="h-4 w-4" /><span className="hidden sm:inline">Donut{release ? ` v${release.version}` : ""}</span>
      {outdated && <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="Update available" />}
    </Button>
    <InstallExtensionDialog open={open} onOpenChange={setOpen} installed={installed} checkingInstalled={isPending} />
  </>;
}
