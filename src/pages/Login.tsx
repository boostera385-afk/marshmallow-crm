import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Lock, ArrowRight, ShieldCheck, Wrench, KeyRound, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { heroTitle, premiumEase } from "@/lib/motion";
import marshmallowLogo from "@/assets/marshmallow-logo.png.asset.json";
import { LegalFooter } from "@/components/layout/LegalFooter";

const Login = () => {
  const {
    session,
    markFullyAuthenticated,
    pendingStep,
    pendingUserId,
    pendingMfaFactorId,
    startPendingAccessCode,
    startPendingMfa,
    clearPendingAuth,
    hasAlternativeMfa,
    hasAlternativeAccessCode,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [accessCodeRequired, setAccessCodeRequired] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [accessCodeVerifying, setAccessCodeVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setMfaRequired(pendingStep === "mfa");
    setAccessCodeRequired(pendingStep === "access_code");
  }, [pendingStep]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData && aalData.currentLevel === "aal1" && aalData.nextLevel === "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.find((f) => f.status === "verified");

      if (totpFactor && data.user?.id) {
        startPendingMfa(data.user.id, totpFactor.id);
        setLoading(false);
        return;
      }
    }

    const userId = data.user?.id;
    if (userId) {
      try {
        const { data: checkData, error: checkError } = await supabase.functions.invoke("admin-users", {
          body: { action: "check_access_code" },
        });

        if (checkError) {
          toast.error("Unable to verify access code requirement. Please try again or contact your administrator.");
          setLoading(false);
          return;
        }

        if (checkData?.requires_code) {
          startPendingAccessCode(userId);
          setLoading(false);
          return;
        }
      } catch {
        toast.error("Unable to verify access code requirement. Please try again or contact your administrator.");
        setLoading(false);
        return;
      }
    }

    clearPendingAuth();
    markFullyAuthenticated(userId);
    setLoading(false);
  };

  const handleAccessCodeVerify = async () => {
    if (!accessCodeInput || accessCodeInput.length !== 6) return;

    setAccessCodeVerifying(true);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke("admin-users", {
        body: { action: "verify_access_code", code: accessCodeInput },
      });

      if (fnError || result?.error) {
        toast.error(result?.error || "Invalid access code. Please contact your administrator.");
        setAccessCodeInput("");
        setAccessCodeVerifying(false);
        return;
      }

      if (result?.session?.access_token && result?.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
      }

      if (result?.success || result?.session?.access_token) {
        toast.success("Access verified successfully");
        clearPendingAuth();
        setAccessCodeRequired(false);
        markFullyAuthenticated();
      }
    } catch {
      toast.error("Verification failed. Please try again.");
      setAccessCodeInput("");
    }

    setAccessCodeVerifying(false);
  };

  const handleMFAVerify = async () => {
    if (!totpCode || totpCode.length !== 6) return;

    if (!pendingMfaFactorId) {
      toast.error("Verification state expired. Please sign in again.");
      return;
    }

    setVerifying(true);

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: pendingMfaFactorId,
    });

    if (challengeError) {
      toast.error(challengeError.message);
      setVerifying(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: pendingMfaFactorId,
      challengeId: challenge.id,
      code: totpCode,
    });

    if (verifyError) {
      toast.error("Invalid code. Please try again.");
      setTotpCode("");
      setVerifying(false);
      return;
    }

    toast.success("Verification successful");
    clearPendingAuth();
    setMfaRequired(false);
    markFullyAuthenticated();
    setVerifying(false);
  };

  const handleAccessCodeBack = async () => {
    setAccessCodeRequired(false);
    setAccessCodeInput("");
    clearPendingAuth();
    await supabase.auth.signOut();
  };

  const handleMfaBack = async () => {
    setMfaRequired(false);
    setTotpCode("");
    clearPendingAuth();
    await supabase.auth.signOut();
  };

  if (accessCodeRequired) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-background p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--pastry-pink)/0.05),transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: premiumEase }}
          className="my-auto w-full max-w-sm space-y-8 relative z-10"
        >
          <div className="text-center space-y-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.15 }}
              className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pastry-navy to-pastry-pink flex items-center justify-center mx-auto shadow-[0_12px_28px_-12px_hsl(var(--pastry-pink)/0.55)]"
            >
              <KeyRound className="h-7 w-7 text-white" />
            </motion.div>

            <motion.h2
              variants={heroTitle}
              initial="initial"
              animate="animate"
              className="text-2xl font-bold tracking-tight text-foreground"
            >
              Access Code Required
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="text-sm text-muted-foreground"
            >
              Enter the 6-digit access code provided by your administrator
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.35 }}
            className="space-y-4"
          >
            <Input
              value={accessCodeInput}
              onChange={(e) => setAccessCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="font-mono text-center text-2xl tracking-[0.5em] h-14 focus-visible:ring-pastry-pink"
              maxLength={6}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleAccessCodeVerify()}
            />

            <Button
              onClick={handleAccessCodeVerify}
              className="w-full gap-2 h-11 bg-pastry-lime font-semibold text-pastry-navy shadow-[0_12px_26px_-14px_hsl(var(--pastry-lime)/0.7)] hover:bg-pastry-lime/90 focus-visible:ring-pastry-pink"
              disabled={accessCodeVerifying || accessCodeInput.length !== 6}
            >
              {accessCodeVerifying ? (
                "Verifying..."
              ) : (
                <>
                  Verify Code
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              className="w-full text-sm text-muted-foreground hover:text-foreground"
              onClick={handleAccessCodeBack}
            >
              Back to login
            </Button>
              {hasAlternativeMfa && pendingMfaFactorId && pendingUserId && (
                <Button
                  variant="ghost"
                  className="w-full text-sm text-pink-600 hover:text-pink-600/80 dark:text-pastry-pink dark:hover:text-pastry-pink/80"
                  onClick={() => startPendingMfa(pendingUserId, pendingMfaFactorId, true)}
                >
                  Use Authenticator App instead
                </Button>
              )}
          </motion.div>
        </motion.div>
        <LegalFooter className="relative z-10 pt-8" />
      </div>
    );
  }

  if (mfaRequired) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-background p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--pastry-pink)/0.05),transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: premiumEase }}
          className="my-auto w-full max-w-sm space-y-8 relative z-10"
        >
          <div className="text-center space-y-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.15 }}
              className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pastry-navy to-pastry-pink flex items-center justify-center mx-auto shadow-[0_12px_28px_-12px_hsl(var(--pastry-pink)/0.55)]"
            >
              <ShieldCheck className="h-7 w-7 text-white" />
            </motion.div>

            <motion.h2
              variants={heroTitle}
              initial="initial"
              animate="animate"
              className="text-2xl font-bold tracking-tight text-foreground"
            >
              Two-Factor Authentication
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="text-sm text-muted-foreground"
            >
              Enter the 6-digit code from your authenticator app
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.35 }}
            className="space-y-4"
          >
            <Input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="font-mono text-center text-2xl tracking-[0.5em] h-14 focus-visible:ring-pastry-pink"
              maxLength={6}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleMFAVerify()}
            />

            <Button
              onClick={handleMFAVerify}
              className="w-full gap-2 h-11 bg-pastry-lime font-semibold text-pastry-navy shadow-[0_12px_26px_-14px_hsl(var(--pastry-lime)/0.7)] hover:bg-pastry-lime/90 focus-visible:ring-pastry-pink"
              disabled={verifying || totpCode.length !== 6}
            >
              {verifying ? (
                "Verifying..."
              ) : (
                <>
                  Verify
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              className="w-full text-sm text-muted-foreground hover:text-foreground"
              onClick={handleMfaBack}
            >
              Back to login
            </Button>
              {hasAlternativeAccessCode && pendingUserId && (
                <Button
                  variant="ghost"
                  className="w-full text-sm text-pink-600 hover:text-pink-600/80 dark:text-pastry-pink dark:hover:text-pastry-pink/80"
                  onClick={() => startPendingAccessCode(pendingUserId, true, pendingMfaFactorId!)}
                >
                  Use Admin Access Code instead
                </Button>
              )}
          </motion.div>
        </motion.div>
        <LegalFooter className="relative z-10 pt-8" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen relative overflow-hidden">
      <div className="hidden lg:flex lg:w-[46%] pastry-panel relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-black/15 via-transparent to-black/10" />

        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/15 border border-white/10">
            <img src={marshmallowLogo.url} alt="Marshmallow" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">Marshmallow</h1>
        </motion.div>

        <div className="relative z-10 space-y-5">
          <motion.h2
            variants={heroTitle}
            initial="initial"
            animate="animate"
            className="text-4xl xl:text-5xl font-extrabold leading-[1.08] text-white tracking-tight"
          >
            Manage your
            <br />
            leads with
            <br />
            <span className="text-pastry-lime">precision.</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            className="text-white/60 text-base max-w-md leading-relaxed"
          >
            Track, schedule, and close — all from one streamlined workspace designed for teams that move fast.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="flex flex-wrap gap-2 pt-2"
          >
            {["Real-time Tracking", "Team Scheduling", "Smart Analytics"].map((feature, i) => (
              <motion.span
                key={feature}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.08 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-white/85"
              >
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${["bg-pastry-pink", "bg-pastry-lime", "bg-pastry-cherry"][i]}`} />
                {feature}
              </motion.span>
            ))}
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="relative z-10 text-white/20 text-xs tracking-wide"
        >
          Marshmallow · Built for modern teams
        </motion.p>

        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
          className="absolute -top-32 -right-32 w-[520px] h-[520px] rounded-full border border-white/[0.04]"
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 100, repeat: Infinity, ease: "linear" }}
          className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full border border-white/[0.04]"
        />
      </div>

      <div className="flex-1 flex flex-col items-center p-8 relative bg-background">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--pastry-pink)/0.06),transparent_60%)] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: premiumEase }}
          className="my-auto w-full max-w-sm space-y-8 relative z-10"
        >
          <div className="lg:hidden mb-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg overflow-hidden shadow-brand">
              <img src={marshmallowLogo.url} alt="Marshmallow" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Marshmallow</h1>
          </div>

          <div>
            <motion.h2
              variants={heroTitle}
              initial="initial"
              animate="animate"
              className="text-2xl font-bold tracking-tight text-foreground"
            >
              Welcome back
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="mt-2 text-sm text-muted-foreground"
            >
              Sign in to your account to continue
            </motion.p>
          </div>

          <motion.form
            onSubmit={handleLogin}
            className="space-y-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70"
              >
                Email
              </Label>
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 transition-colors group-focus-within:text-pink-600 dark:group-focus-within:text-pastry-pink" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="pl-10 h-11 focus-visible:ring-pastry-pink"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70"
              >
                Password
              </Label>
              <div className="relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 transition-colors group-focus-within:text-pink-600 dark:group-focus-within:text-pastry-pink" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="pl-10 pr-10 h-11 focus-visible:ring-pastry-pink"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground/40 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full gap-2 h-11 bg-pastry-lime font-semibold text-pastry-navy shadow-[0_12px_26px_-14px_hsl(var(--pastry-lime)/0.7)] hover:bg-pastry-lime/90 focus-visible:ring-pastry-pink" disabled={loading}>
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-pastry-navy/30 border-t-pastry-navy animate-spin" />
                  Signing in...
                </div>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </motion.form>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-[11px] text-center text-muted-foreground/40"
          >
            Accounts are created by your administrator
          </motion.p>
        </motion.div>
        <LegalFooter className="relative z-10 pt-8" />
      </div>
    </div>
  );
};

export default Login;



