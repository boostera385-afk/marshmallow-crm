import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { workflowSoundsEnabled, setWorkflowSounds } from "@/lib/workflow-alerts";
import { playAssignmentSound } from "@/lib/notification-sound";
import { Button } from "@/components/ui/button";

export default function NotificationSoundControls() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const update = () => setEnabled(user ? workflowSoundsEnabled(user.id) : false);
    update();
    window.addEventListener("storage", update);
    window.addEventListener("workflow-sound-changed", update);
    return () => { window.removeEventListener("storage", update); window.removeEventListener("workflow-sound-changed", update); };
  }, [user]);
  if (!user) return null;
  const Icon = enabled ? Volume2 : VolumeX;
  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" aria-pressed={enabled} onClick={() => { setWorkflowSounds(user.id, !enabled); if (!enabled) playAssignmentSound(); }}><Icon className="mr-2 h-4 w-4" />{enabled ? "Mute update sounds" : "Enable update sounds"}</Button>
    <Button variant="ghost" size="sm" disabled={!enabled} onClick={playAssignmentSound}>Test sound</Button>
    <p className="text-xs text-muted-foreground">Sound needs browser permission; visual alerts always remain available.</p>
  </div>;
}
