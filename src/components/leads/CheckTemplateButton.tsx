import { useEffect, useState } from "react";
import { Check, ClipboardCheck, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Lead } from "@/types";
import { copyTextToClipboard } from "@/lib/lead-copy";
import { renderLeadTemplate, resolveTemplate, useSavedTemplates } from "@/lib/message-templates";
import { cn } from "@/lib/utils";

interface CheckTemplateButtonProps {
  lead: Lead;
  className?: string;
}

/**
 * Copies the "Check Template" message: asks a technician whether they can take
 * the customer. The text is the admin-edited template (Settings > Templates) or
 * the built-in one, filled from the lead; the user can edit it before copying.
 */
export default function CheckTemplateButton({ lead, className }: CheckTemplateButtonProps) {
  const [open, setOpen] = useState(false);
  const [techName, setTechName] = useState(lead.tech_name || "");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const { data: savedTemplates } = useSavedTemplates(open);

  useEffect(() => {
    setTechName(lead.tech_name || "");
  }, [lead.id, lead.tech_name]);

  useEffect(() => {
    if (open) {
      setMessage(renderLeadTemplate(resolveTemplate("check_template", savedTemplates), lead, { tech_name: techName }));
    }
    // Keyed on the lead id (not the object) so a background refetch does not wipe edits in the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, open, techName, savedTemplates]);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(message);
      setCopied(true);
      toast.success("Check message copied");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Could not copy the message");
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("gap-1.5 text-[11px]", className)}
        onClick={() => {
          setCopied(false);
          setOpen(true);
        }}
      >
        <ClipboardCheck className="h-3 w-3" />
        Check Template
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Check Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="check-template-tech-name" className="text-[11px] font-medium text-muted-foreground/60">
                Technician name
              </Label>
              <Input
                id="check-template-tech-name"
                value={techName}
                onChange={(event) => setTechName(event.target.value)}
                placeholder="Technician name..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="check-template-message" className="text-[11px] font-medium text-muted-foreground/60">
                Preview message
              </Label>
              <Textarea
                id="check-template-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={10}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={handleCopy} className="gap-1.5" disabled={!message.trim()}>
              {copied ? <><Check className="h-3.5 w-3.5" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy to Clipboard</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
