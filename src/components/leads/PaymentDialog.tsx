import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DollarSign, Upload } from 'lucide-react';
import { PAYMENT_REQUEST_TYPE_LABELS, type PaymentRequestType } from '@/lib/payment-requests';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (amount: number, screenshotFile: File | null, comment?: string) => void;
  loading?: boolean;
  mode?: 'direct' | 'request';
  /** Which outcome this dialog is recording/requesting. Defaults to 'paid'. */
  requestType?: PaymentRequestType;
}

export default function PaymentDialog({ open, onOpenChange, onConfirm, loading, mode = 'direct', requestType = 'paid' }: Props) {
  const isRequest = mode === 'request';
  const isPartial = requestType === 'partial_paid';
  const typeLabel = PAYMENT_REQUEST_TYPE_LABELS[requestType];
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  // A failed save leaves the dialog open: keep its amount/evidence for retry.
  // Only an acknowledged save or an explicit close discards the draft.
  useEffect(() => {
    if (open) return;
    setAmount('');
    setFile(null);
    setPreview(null);
    setComment('');
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  };

  const handleConfirm = () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;
    onConfirm(parsedAmount, file, comment.trim() || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[hsl(var(--success)/0.08)] flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-[hsl(var(--success))]" />
            </div>
            {isRequest ? `Request ${typeLabel} Approval` : `${typeLabel} Confirmation`}
          </DialogTitle>
          <DialogDescription>
            {isRequest
              ? `This lead will move to Payment Approval Pending until an Admin approves it as ${typeLabel}.`
              : 'Enter the payment amount and optionally upload a payment screenshot.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-[11px] font-medium text-muted-foreground/60">
              {isPartial ? 'Partial Amount Paid *' : 'Amount Paid *'}
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] font-medium text-muted-foreground/60">Payment Screenshot</Label>
            <div className="border-2 border-dashed border-border/40 rounded-xl p-4 text-center transition-colors hover:border-border/60">
              {preview ? (
                <div className="space-y-2">
                  <img src={preview} alt="Payment screenshot" className="max-h-40 mx-auto rounded-lg" />
                  <Button variant="ghost" size="sm" onClick={() => { setFile(null); setPreview(null); }}>
                    Remove
                  </Button>
                </div>
              ) : (
                <label className="cursor-pointer flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center">
                    <Upload className="h-5 w-5" />
                  </div>
                  <span className="text-[13px] font-medium">Click to upload screenshot</span>
                  <span className="text-[10px] text-muted-foreground/50">PNG, JPG up to 5MB</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                </label>
              )}
            </div>
          </div>
          {isRequest && (
            <div className="space-y-2">
              <Label className="text-[11px] font-medium text-muted-foreground/60">Comment (optional)</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add any context for the Admin reviewing this request..."
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={!amount || parseFloat(amount) <= 0 || loading}
            className="bg-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.9)] text-[hsl(var(--success-foreground))]"
          >
            {loading ? 'Saving...' : isRequest ? 'Send request' : `Confirm ${typeLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
