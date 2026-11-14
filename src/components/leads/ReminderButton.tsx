import { useEffect, useState } from "react";
import { Bell, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Lead } from "@/types";
import { copyTextToClipboard } from "@/lib/lead-copy";
import { DEFAULT_MESSAGE_TEMPLATES, renderLeadTemplate } from "@/lib/message-templates";
import { cn } from "@/lib/utils";

interface ReminderButtonProps {
  lead: Lead;
  className?: string;
}

export default function ReminderButton({ lead, className }: ReminderButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  // Typed by hand each time, like the technician message's Customer #.
  const [customerNumber, setCustomerNumber] = useState("");
  const [copied, setCopied] = useState(false);
  const template = DEFAULT_MESSAGE_TEMPLATES.technician_reminder;

  useEffect(() => {
    if (open) {
      setMessage(renderLeadTemplate(template, lead, { customer_number: customerNumber }));
      setCopied(false);
    }
  }, [lead, open, template, customerNumber]);

  const handleCopy = async () => {
    await copyTextToClipboard(message);
    setCopied(true);
    toast.success("Reminder message copied");
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("gap-1.5 text-[12px] font-semibold", className)}
        onClick={() => setOpen(true)}
      >
        <Bell className="h-3.5 w-3.5" />
        Reminder
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reminder message</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reminder-customer-number" className="text-[11px] font-medium text-muted-foreground/60">Customer # (manual)</Label>
              <Input
                id="reminder-customer-number"
                value={customerNumber}
                onChange={(event) => setCustomerNumber(event.target.value)}
                placeholder="Enter customer number..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reminder-preview" className="text-[11px] font-medium text-muted-foreground/60">Preview message</Label>
              <Textarea id="reminder-preview" value={message} onChange={(event) => setMessage(event.target.value)} rows={10} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={handleCopy} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy reminder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
