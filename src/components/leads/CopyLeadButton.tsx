import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { Lead } from '@/types';
import { cn } from '@/lib/utils';
import { DEFAULT_MESSAGE_TEMPLATES, renderLeadTemplate, useMessageTemplate, technicianMessageTemplate } from '@/lib/message-templates';

interface Props {
  lead: Lead;
  className?: string;
}

export default function CopyLeadButton({ lead, className }: Props) {
  const [open, setOpen] = useState(false);
  const [customerNumber, setCustomerNumber] = useState('');
  const [referenceName, setReferenceName] = useState(lead.reference_name || '');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const { data: template = DEFAULT_MESSAGE_TEMPLATES.technician_message } = useMessageTemplate('technician_message');

  const generateText = () =>
    renderLeadTemplate(technicianMessageTemplate(lead, template), lead, {
      customer_number: customerNumber,
      reference_name: referenceName,
    });

  useEffect(() => {
    if (open) setMessage(generateText());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerNumber, referenceName, open, template, lead.id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message || generateText());
    setCopied(true);
    toast.success('Technician message copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("gap-1.5 text-[11px]", className)}
        onClick={() => {
          setOpen(true);
          setMessage(generateText());
        }}
      >
        <Copy className="h-3 w-3" />
        Copy Technician Message
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Copy Technician Message</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground/60">Customer # (manual)</Label>
              <Input
                value={customerNumber}
                onChange={e => setCustomerNumber(e.target.value)}
                placeholder="Enter customer number..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground/60">Reference Name (manual)</Label>
              <Input
                value={referenceName}
                onChange={e => setReferenceName(e.target.value)}
                placeholder="Reference person name..."
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground/60">Preview message</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={10} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={handleCopy} className="gap-1.5">
              {copied ? <><Check className="h-3.5 w-3.5" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy to Clipboard</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
