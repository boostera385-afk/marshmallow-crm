import { supabase } from '@/integrations/supabase/client';

async function forceReauth(message: string): Promise<never> {
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.removeItem('auth_verified_user_id');
    window.localStorage.removeItem('auth_pending_state');
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
  throw new Error(message);
}

async function getFreshAccessToken(): Promise<string> {
  let { data: { session } } = await supabase.auth.getSession();

  // Refresh when the token is missing or expires within the next 60 seconds,
  // otherwise the edge function rejects it with "invalid token".
  const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
  if (!session?.access_token || expiresAt - Date.now() < 60_000) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      return forceReauth('Your session expired. Please log in again.');
    }
    session = data.session;
  }

  // The cached session can point at a session that was revoked server-side
  // (deleted user, signed out elsewhere). Validate it against the auth server
  // and refresh once before giving up, so we never send a dead token.
  const { error: verifyError } = await supabase.auth.getUser();
  if (verifyError) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      return forceReauth('Your session is no longer valid. Please log in again.');
    }
    session = data.session;
  }

  return session.access_token;
}


async function callAdminFunction(body: Record<string, unknown>) {
  const accessToken = await getFreshAccessToken();

  const { data, error } = await supabase.functions.invoke('admin-users', {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (error) {
    // supabase-js FunctionsHttpError attaches the raw Response on error.context.
    // Read it so we surface the real backend error instead of "non-2xx status code".
    let backendMessage: string | null = null;
    const ctx = (error as unknown as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.clone().json();
        backendMessage = parsed?.error || parsed?.message || null;
      } catch {
        try {
          backendMessage = await ctx.clone().text();
        } catch {
          backendMessage = null;
        }
      }
    }

    const msg = backendMessage || error.message || '';
    console.error('admin-users function error:', msg, error);

    if (msg.includes('NOT_FOUND') || msg.includes('not found') || msg.includes('Failed to fetch')) {
      throw new Error('Admin backend is not deployed. Please redeploy the edge function from Supabase dashboard.');
    }
    if (msg.includes('Unauthorized') || msg.includes('401')) {
      await forceReauth('Your session is no longer valid. Please log in again.');
    }

    if (msg.includes('Admin access required') || msg.includes('403')) {
      throw new Error('You do not have admin permissions.');
    }
    throw new Error(msg || 'Admin action failed');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

export const adminApi = {
  ping: () => callAdminFunction({ action: 'ping' }),

  createUser: (email: string, password: string, full_name: string, role: string, access_code?: string) =>
    callAdminFunction({ action: 'create_user', email, password, full_name, role, access_code }),

  setPassword: (user_id: string, password: string) =>
    callAdminFunction({ action: 'set_password', user_id, password }),

  deleteUser: (user_id: string) =>
    callAdminFunction({ action: 'delete_user', user_id }),

  updateUserRole: (user_id: string, role: string) =>
    callAdminFunction({ action: 'update_user_role', user_id, role }),

  deleteLead: async (lead_id: string, job_id?: string) => {
    // 1. Try the atomic Postgres function first (bypasses RLS edge function flakiness)
    const { data: rpcData, error: rpcError } = await supabase.rpc('delete_lead_by_admin', { target_lead_id: lead_id });
    if (!rpcError && (rpcData as any)?.success) {
      return rpcData;
    }
    
    // 2. Fallback to edge function if RPC not deployed or fails
    try {
      return await callAdminFunction({ action: 'delete_lead', lead_id, job_id });
    } catch (edgeErr: any) {
      // 3. Fallback to direct client call if edge function has a cold start / token issue
      console.warn("Edge function fallback failed, attempting direct delete:", edgeErr.message);
      const { error: directError } = await supabase.from('leads').delete().eq('id', lead_id);
      if (directError) {
        throw new Error(directError.message);
      }
      return { success: true, job_id };
    }
  },

  listTotpFactors: (user_id: string) =>
    callAdminFunction({ action: 'list_totp_factors', user_id }),

  enrollTotpUser: (user_id: string) =>
    callAdminFunction({ action: 'enroll_totp_user', user_id }),

  deleteTotpUser: (user_id: string) =>
    callAdminFunction({ action: 'delete_totp_user', user_id }),
};
