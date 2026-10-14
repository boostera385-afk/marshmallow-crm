import { Button } from "@/components/ui/button";
import { useCopilot } from "@/lib/copilot-context";
import CopilotLogo from "./CopilotLogo";
export default function CopilotLauncher() {
  const { access, open, setOpen } = useCopilot();
  if (!access) return null;
  return <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-xl border-border/60 bg-background/80 shadow-sm hover:border-primary/30"
    data-copilot-launcher aria-label="Ask Marshmallow Copilot" aria-expanded={open} title="Ask Marshmallow Copilot" onClick={() => setOpen(!open)}><CopilotLogo className="h-7 w-7"/></Button>;
}
