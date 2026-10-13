import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Profile, NavigationPermission } from "@/types";
import { canAccessNavItem, canAccessCxUpdates } from "@/lib/access";

const VERIFIED_USER_KEY = "auth_verified_user_id";
const PENDING_AUTH_KEY = "auth_pending_state";

type PendingStep = "none" | "access_code" | "mfa";

interface PendingAuthState {
  hasAlternativeAccessCode?: boolean;
  hasAlternativeMfa?: boolean;
  step: PendingStep;
  userId: string | null;
  mfaFactorId?: string | null;
}

interface AuthContextType {
  hasAlternativeAccessCode: boolean;
  hasAlternativeMfa: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  permissions: NavigationPermission[];
  loading: boolean;
  profileLoaded: boolean;
  fullyAuthenticated: boolean;
  pendingStep: PendingStep;
  pendingUserId: string | null;
  pendingMfaFactorId: string | null;
  signOut: () => Promise<void>;
  canAccess: (navItem: string) => boolean;
  refetchProfile: () => Promise<void>;
  markFullyAuthenticated: (userId?: string) => void;
  startPendingAccessCode: (userId: string, hasAltMfa?: boolean, factorId?: string) => void;
  startPendingMfa: (userId: string, factorId: string, hasAltAccessCode?: boolean) => void;
  clearPendingAuth: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<NavigationPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [userOverrides] = useState<Record<string, boolean>>({});
  const [fullyAuthenticated, setFullyAuthenticated] = useState(false);
  const [pendingStep, setPendingStep] = useState<PendingStep>("none");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingMfaFactorId, setPendingMfaFactorId] = useState<string | null>(null);
  const [hasAlternativeAccessCode, setHasAlternativeAccessCode] = useState(false);
  const [hasAlternativeMfa, setHasAlternativeMfa] = useState(false);

  const loadPendingFromStorage = (nextSession: Session | null) => {
    if (!nextSession?.user) {
      window.localStorage.removeItem(PENDING_AUTH_KEY);
      setPendingStep("none");
      setPendingUserId(null);
      setPendingMfaFactorId(null);
        setHasAlternativeAccessCode(false);
        setHasAlternativeMfa(false);
      return;
    }

    const raw = window.localStorage.getItem(PENDING_AUTH_KEY);
    if (!raw) {
      setPendingStep("none");
      setPendingUserId(null);
      setPendingMfaFactorId(null);
        setHasAlternativeAccessCode(false);
        setHasAlternativeMfa(false);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as PendingAuthState;

      if (parsed.userId === nextSession.user.id && parsed.step !== "none") {
        setPendingStep(parsed.step);
        setPendingUserId(parsed.userId);
        setPendingMfaFactorId(parsed.mfaFactorId ?? null);
          setHasAlternativeAccessCode(parsed.hasAlternativeAccessCode ?? false);
          setHasAlternativeMfa(parsed.hasAlternativeMfa ?? false);
      } else {
        window.localStorage.removeItem(PENDING_AUTH_KEY);
        setPendingStep("none");
        setPendingUserId(null);
        setPendingMfaFactorId(null);
        setHasAlternativeAccessCode(false);
        setHasAlternativeMfa(false);
      }
    } catch {
      window.localStorage.removeItem(PENDING_AUTH_KEY);
      setPendingStep("none");
      setPendingUserId(null);
      setPendingMfaFactorId(null);
        setHasAlternativeAccessCode(false);
        setHasAlternativeMfa(false);
    }
  };

  const syncVerifiedState = (nextSession: Session | null) => {
    if (nextSession?.user) {
      const storedId = window.localStorage.getItem(VERIFIED_USER_KEY);
      setFullyAuthenticated(storedId === nextSession.user.id);
    } else {
      window.localStorage.removeItem(VERIFIED_USER_KEY);
      setFullyAuthenticated(false);
    }

    loadPendingFromStorage(nextSession);
  };

  const VALID_ROLES: AppRole[] = ["admin", "processor", "customer_service", "opr", "cs_admin", "opr_admin"];

  const forceSignOutOrphan = async () => {
    // The signed-in account no longer has a profile or a valid role. Clear
    // every trace of authentication and let the app redirect to /login.
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("Failed to sign out orphan session", err);
    }
    window.localStorage.removeItem(VERIFIED_USER_KEY);
    window.localStorage.removeItem(PENDING_AUTH_KEY);
    setSession(null);
    setUser(null);
    setProfile(null);
    setRole(null);
    setPermissions([]);
    setProfileLoaded(true);
    setFullyAuthenticated(false);
    setPendingStep("none");
    setPendingUserId(null);
    setPendingMfaFactorId(null);
        setHasAlternativeAccessCode(false);
        setHasAlternativeMfa(false);
  };

  const fetchUserData = async (userId: string) => {
    const [profileRes, roleRes, permRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      supabase.from("navigation_permissions").select("*").eq("user_id", userId),
    ]);

    const loadedProfile = profileRes.data as Profile | null;
    const loadedRoleRaw = roleRes.data?.role as string | undefined;
    const loadedRole = VALID_ROLES.includes(loadedRoleRaw as AppRole) ? (loadedRoleRaw as AppRole) : null;

    // Transient failures (network/permission errors) must NOT be treated as a
    // deleted account — only sign out when the queries succeeded and the rows
    // are genuinely missing.
    if (profileRes.error || roleRes.error) {
      const err = profileRes.error ?? roleRes.error;
      console.error("Failed to load user data", err);
      // If the JWT is expired or invalid, force re-authentication instead of
      // leaving the user on a blank page with no feedback.
      const msg = err?.message ?? "";
      if (msg.includes("JWT") || msg.includes("token") || msg.includes("expired")) {
        await forceSignOutOrphan();
        return;
      }
      setProfileLoaded(true);
      return;
    }

    // If the profile or a valid role is missing, the account was deleted or
    // never fully provisioned. Force the session out immediately.
    if (!loadedProfile || !loadedRole) {
      await forceSignOutOrphan();
      return;
    }


    setProfile(loadedProfile);
    setRole(loadedRole);
    setPermissions((permRes.data ?? []) as NavigationPermission[]);
    setProfileLoaded(true);
  };

  const refetchProfile = async () => {
    if (user) {
      await fetchUserData(user.id);
    }
  };

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      // Skip noisy TOKEN_REFRESHED events that fire on tab refocus — they cause
      // full app refetches even though the user did not change.
      if (_event === "TOKEN_REFRESHED") {
        setSession(nextSession);
        setLoading(false);
        return;
      }

      setSession(nextSession);
      setUser((prev) => {
        const nextUser = nextSession?.user ?? null;
        if (prev?.id === nextUser?.id) return prev; // keep reference stable
        return nextUser;
      });

      if (nextSession?.user) {
        setTimeout(() => {
          void fetchUserData(nextSession.user.id);
        }, 0);
      } else {
        setProfile(null);
        setRole(null);
        setPermissions([]);
        setProfileLoaded(false);
      }

      syncVerifiedState(nextSession);
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        void fetchUserData(initialSession.user.id);
      } else {
        setProfile(null);
        setRole(null);
        setPermissions([]);
        setProfileLoaded(true);
      }

      syncVerifiedState(initialSession);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const persistPendingAuth = (state: PendingAuthState | null) => {
    if (!state || state.step === "none" || !state.userId) {
      window.localStorage.removeItem(PENDING_AUTH_KEY);
      setPendingStep("none");
      setPendingUserId(null);
      setPendingMfaFactorId(null);
        setHasAlternativeAccessCode(false);
        setHasAlternativeMfa(false);
      return;
    }

    window.localStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(state));
    setPendingStep(state.step);
    setPendingUserId(state.userId);
    setPendingMfaFactorId(state.mfaFactorId ?? null);
      setHasAlternativeAccessCode(state.hasAlternativeAccessCode ?? false);
      setHasAlternativeMfa(state.hasAlternativeMfa ?? false);
  };

  const clearPendingAuth = () => {
    persistPendingAuth(null);
  };

  const startPendingAccessCode = (userId: string, hasAltMfa?: boolean, factorId?: string) => {
    window.localStorage.removeItem(VERIFIED_USER_KEY);
    setFullyAuthenticated(false);
    persistPendingAuth({ step: "access_code", userId, mfaFactorId: factorId || null, hasAlternativeMfa: hasAltMfa });
  };

  const startPendingMfa = (userId: string, factorId: string, hasAltAccessCode?: boolean) => {
    window.localStorage.removeItem(VERIFIED_USER_KEY);
    setFullyAuthenticated(false);
    persistPendingAuth({ step: "mfa", userId, mfaFactorId: factorId, hasAlternativeAccessCode: hasAltAccessCode });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setRole(null);
    setPermissions([]);
    setProfileLoaded(false);
    window.localStorage.removeItem(VERIFIED_USER_KEY);
    window.localStorage.removeItem(PENDING_AUTH_KEY);
    setFullyAuthenticated(false);
    setPendingStep("none");
    setPendingUserId(null);
    setPendingMfaFactorId(null);
        setHasAlternativeAccessCode(false);
        setHasAlternativeMfa(false);
  };

  const canAccess = (navItem: string): boolean => {
    if (navItem === "cx_updates") return canAccessCxUpdates(role);
    if (navItem === "quote_pending_requests") {
      // CS Admins do not work the Quote to Send queue.
      return role === "admin" || profile?.is_quotation_master === true;
    }
    if (navItem === "settings") {
      return role === "admin" || (role === "cs_admin" && profile?.can_manage_users === true);
    }
    if (navItem === "ai_assistance") {
      // CS Missed-Lead Tracker — shared CS worklist for Admin, CS Admin and CS
      // agents; not grantable to other roles, so an override cannot widen it.
      return role === "admin" || role === "cs_admin" || role === "customer_service";
    }
    if (navItem in userOverrides) return userOverrides[navItem];
    return canAccessNavItem(role, navItem, permissions);
  };

  const markFullyAuthenticated = (userId?: string) => {
    const currentUserId = userId ?? user?.id ?? session?.user?.id;
    if (!currentUserId) return;

    window.localStorage.setItem(VERIFIED_USER_KEY, currentUserId);
    setFullyAuthenticated(true);
    clearPendingAuth();
  };

  const value = useMemo<AuthContextType>(
    () => ({
      session,
      user,
      profile,
      role,
      permissions,
      loading,
      profileLoaded,
      fullyAuthenticated,
      pendingStep,
      pendingUserId,
      pendingMfaFactorId,
      hasAlternativeAccessCode,
      hasAlternativeMfa,
      signOut,
      canAccess,
      refetchProfile,
      markFullyAuthenticated,
      startPendingAccessCode,
      startPendingMfa,
      clearPendingAuth,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      session,
      user,
      profile,
      role,
      permissions,
      loading,
      profileLoaded,
      fullyAuthenticated,
      pendingStep,
      pendingUserId,
      pendingMfaFactorId,
      hasAlternativeAccessCode,
      hasAlternativeMfa,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};



