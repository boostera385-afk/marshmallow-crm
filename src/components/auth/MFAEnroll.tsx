import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ShieldCheck, ShieldOff, QrCode, Copy } from 'lucide-react';
import { motion } from 'framer-motion';

export default function MFAEnroll() {
  const { user } = useAuth();
  const [factors, setFactors] = useState<NonNullable<Awaited<ReturnType<typeof supabase.auth.mfa.listFactors>>['data']>['totp']>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFactors();
  }, []);

  const fetchFactors = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (data) {
      setFactors(data.totp || []);
    }
    setLoading(false);
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Marshmallow Authenticator',
    });
    if (error) {
      toast.error(error.message);
      setEnrolling(false);
      return;
    }
    if (data) {
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
    }
    setEnrolling(false);
  };

  const handleVerify = async () => {
    if (!factorId || !verifyCode) return;
    setVerifying(true);

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });
    if (challengeError) {
      toast.error(challengeError.message);
      setVerifying(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: verifyCode,
    });

    if (verifyError) {
      toast.error('Invalid code. Please try again.');
      setVerifying(false);
      return;
    }

    toast.success('TOTP enabled successfully!');
    setQrCode(null);
    setSecret(null);
    setFactorId(null);
    setVerifyCode('');
    setVerifying(false);
    fetchFactors();
  };

  const handleUnenroll = async (factorId: string) => {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('TOTP removed');
    fetchFactors();
  };

  const verifiedFactors = factors.filter(f => f.status === 'verified');
  const hasActiveTOTP = verifiedFactors.length > 0;

  if (loading) {
    return (
      <Card className="border">
        <CardContent className="p-6 text-center text-muted-foreground text-sm">Loading security settings...</CardContent>
      </Card>
    );
  }

  return (
    <Card className="border">
      <CardHeader className="flex flex-row items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-brand" />
        <div>
          <CardTitle className="text-base">Two-Factor Authentication (TOTP)</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add an extra layer of security using an authenticator app
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasActiveTOTP ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-emerald-800">TOTP is enabled</p>
                <p className="text-xs text-emerald-600">Your account is protected with two-factor authentication</p>
              </div>
            </div>
            {verifiedFactors.map(f => (
              <div key={f.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">{f.friendly_name || 'Authenticator'}</p>
                  <p className="text-xs text-muted-foreground">Added {new Date(f.created_at).toLocaleDateString()}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive gap-1.5"
                  onClick={() => handleUnenroll(f.id)}
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : qrCode ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>
              <div className="flex justify-center">
                <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48 rounded-lg border p-2" />
              </div>
              {secret && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Or enter this code manually:</p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-xs bg-muted px-3 py-1.5 rounded font-mono select-all">{secret}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Copy setup key"
                      className="h-7 w-7"
                      onClick={() => { navigator.clipboard.writeText(secret); toast.success('Copied!'); }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Enter the 6-digit code from your authenticator app</Label>
              <div className="flex gap-2">
                <Input
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="font-mono text-center text-lg tracking-widest"
                  maxLength={6}
                  onKeyDown={e => e.key === 'Enter' && handleVerify()}
                />
                <Button onClick={handleVerify} disabled={verifying || verifyCode.length !== 6}>
                  {verifying ? 'Verifying...' : 'Verify'}
                </Button>
              </div>
            </div>

            <Button variant="ghost" size="sm" onClick={() => { setQrCode(null); setSecret(null); setFactorId(null); }}>
              Cancel
            </Button>
          </motion.div>
        ) : (
          <div className="text-center space-y-3 py-4">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
              <QrCode className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Protect your account by requiring a code from your authenticator app when signing in
            </p>
            <Button onClick={handleEnroll} disabled={enrolling} className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              {enrolling ? 'Setting up...' : 'Enable TOTP'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
