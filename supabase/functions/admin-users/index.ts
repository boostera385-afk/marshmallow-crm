import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return String(
      candidate.message ??
        candidate.error_description ??
        candidate.error ??
        candidate.msg ??
        JSON.stringify(candidate),
    );
  }
  return String(error);
}

function base32ToBytes(base32: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, index = 0;
  const clean = base32.toUpperCase().replace(/=+$/, "");
  const output = new Uint8Array(((clean.length * 5) / 8) | 0);
  for (let i = 0; i < clean.length; i++) {
    const val = chars.indexOf(clean[i]);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return output;
}

async function generateTotpCode(secret: string): Promise<string> {
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30);
  const timeBuffer = new ArrayBuffer(8);
  const timeView = new DataView(timeBuffer);
  timeView.setBigUint64(0, BigInt(timeStep));

  const keyBytes = base32ToBytes(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, timeBuffer);
  const hash = new Uint8Array(signature);
  const offset = hash[hash.length - 1] & 0xf;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, "0");
}

async function verifyCallerToken(req: Request, adminClient: ReturnType<typeof createClient>, supabaseUrl: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Unauthorized - no token provided", status: 401 };
  }
  const token = authHeader.replace("Bearer ", "");

  let { data: { user }, error } = await adminClient.auth.getUser(token);
  
  if (!user || error) {
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (anonKey) {
      const anonClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      const { data: anonData, error: anonError } = await anonClient.auth.getUser();
      if (!anonError && anonData?.user) {
        user = anonData.user;
        error = null;
      }
    }
  }

  if (!user || error) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        const sub = payload.sub;
        if (sub) {
          const { data: profile } = await adminClient.from('profiles').select('id').eq('id', sub).single();
          if (profile) {
            user = { id: sub } as NonNullable<typeof user>;
            error = null;
          }
        }
      }
    } catch (e) { /* Leave the caller invalid when token fallback decoding fails. */ }
  }

  if (!user || error) {
    return { error: "Unauthorized - invalid token", status: 401 };
  }

  return { user, token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing env: SUPABASE_URL and service role key");
      return jsonResponse({ error: "Server configuration missing. Set SB_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY in Supabase secrets." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { action } = body;

    if (action === "ping") {
      return jsonResponse({ success: true, message: "pong" });
    }

    if (action === "verify_access_code") {
      const { email, password, code } = body;

      if (!code) {
        return jsonResponse({ error: "Code is required" }, 400);
      }

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!anonKey) {
        return jsonResponse({ error: "Server configuration missing" }, 500);
      }

      const verifyAndRotateCode = async (userId: string) => {
        const { data: codeData } = await adminClient
          .from("user_access_codes")
          .select("code")
          .eq("user_id", userId)
          .single();

        if (!codeData || codeData.code !== code) {
          return { ok: false as const };
        }

        const arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        const newCode = String(100000 + (arr[0] % 900000));

        await adminClient.from("user_access_codes").update({ code: newCode }).eq("user_id", userId);

        return { ok: true as const };
      };

      if (email && password) {
        const anonClient = createClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError || !signInData.user) {
          return jsonResponse({ error: "Invalid credentials" }, 401);
        }

        const userId = signInData.user.id;
        const result = await verifyAndRotateCode(userId);

        if (!result.ok) {
          await anonClient.auth.signOut();
          return jsonResponse({ error: "Invalid access code" }, 403);
        }

        return jsonResponse({
          success: true,
          session: {
            access_token: signInData.session?.access_token,
            refresh_token: signInData.session?.refresh_token,
          },
        });
      }

      const { user: callerUserForVerify, error: verifyError } = await verifyCallerToken(req, adminClient, supabaseUrl);
      if (verifyError || !callerUserForVerify) {
        return jsonResponse({ error: verifyError || "Unauthorized" }, 401);
      }

      const verifyResult = await verifyAndRotateCode(callerUserForVerify.id);
      if (!verifyResult.ok) {
        return jsonResponse({ error: "Invalid access code" }, 403);
      }

      return jsonResponse({ success: true });
    }

    if (action === "check_access_code") {
      // Require authentication - extract user_id from JWT instead of request body
      const { user: checkUser, error: checkError } = await verifyCallerToken(req, adminClient, supabaseUrl);
      if (checkError || !checkUser) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const checkUserId = checkUser.id;

      const { data: roleData } = await adminClient.from("user_roles").select("role").eq("user_id", checkUserId).single();

      if (roleData?.role === "admin") {
        return jsonResponse({ requires_code: false });
      }

      const { data: codeData } = await adminClient
        .from("user_access_codes")
        .select("id")
        .eq("user_id", checkUserId)
        .single();

      return jsonResponse({ requires_code: !!codeData });
    }

    const { user: callerUser, error: callerError } = await verifyCallerToken(req, adminClient, supabaseUrl);

    if (callerError || !callerUser) {
      console.error("Auth verification failed:", callerError);
      return jsonResponse({ error: callerError || "Unauthorized - invalid token" }, 401);
    }

    const callerId = callerUser.id;

    const { data: roleData } = await adminClient.from("user_roles").select("role").eq("user_id", callerId).single();
    const { data: profileData } = await adminClient.from("profiles").select("can_manage_users").eq("id", callerId).single();

    const isAdmin = roleData?.role === "admin";
    const isCsAdminUserMgr = roleData?.role === "cs_admin" && profileData?.can_manage_users === true;

    if (!isAdmin && !isCsAdminUserMgr) {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    if (action === "create_user") {
      const { email, password, full_name, role, access_code } = body;

      if (!isAdmin && role !== "customer_service") {
        return jsonResponse({ error: "You can only create customer_service users" }, 403);
      }

      const VALID_ROLES = ["admin", "processor", "customer_service", "opr", "cs_admin", "opr_admin"] as const;
      if (!role || !VALID_ROLES.includes(role)) {
        return jsonResponse(
          {
            error:
              "A valid role is required. Choose Admin, Processor, Customer Service, CS Admin, OPR, or OPR Admin.",
          },
          400,
        );
      }

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

      if (createError) {
        console.error("Create user error:", createError.message);
        return jsonResponse({ error: createError.message }, 400);
      }

      const userId = newUser.user.id;

      // Provision the profile + role together. If any of the required rows
      // cannot be created we roll back the newly-created auth account so we
      // never leave a half-provisioned user that could sign in without a role.
      const rollback = async (reason: string) => {
        console.error("Rolling back new auth user after create_user failure:", reason);
        await adminClient.from("user_access_codes").delete().eq("user_id", userId);
        await adminClient.from("user_roles").delete().eq("user_id", userId);
        await adminClient.from("profiles").delete().eq("id", userId);
        try {
          await adminClient.auth.admin.deleteUser(userId);
        } catch (err) {
          console.error("Rollback deleteUser failed:", getErrorMessage(err));
        }
      };

      // Use upsert because an Auth trigger (handle_new_user) may have already
      // inserted the profile row for this user id.
      const { error: profileError } = await adminClient
        .from("profiles")
        .upsert({ id: userId, full_name, email }, { onConflict: "id" });
      if (profileError) {
        await rollback(profileError.message);
        return jsonResponse({ error: "Failed to create profile: " + profileError.message }, 400);
      }

      const { error: roleError } = await adminClient
        .from("user_roles")
        .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
      if (roleError) {
        await rollback(roleError.message);
        return jsonResponse({ error: "Failed to assign role: " + roleError.message }, 400);
      }

      if (role === "opr" || role === "opr_admin") {
        const { error: oprCodeError } = await adminClient.rpc("assign_next_opr_code", { _user_id: userId });
        if (oprCodeError) {
          await rollback(oprCodeError.message);
          return jsonResponse({ error: "Failed to assign OPR code: " + oprCodeError.message }, 400);
        }
      }

      if (role !== "admin" && access_code) {
        const { error: codeError } = await adminClient
          .from("user_access_codes")
          .insert({ user_id: userId, code: access_code });
        if (codeError) {
          await rollback(codeError.message);
          return jsonResponse(
            { error: "Failed to save access code: " + codeError.message },
            400,
          );
        }
      }

      return jsonResponse({ success: true, user_id: userId });
    }

    if (action === "set_password") {
      const { user_id, password } = body;

      if (!isAdmin) {
        const { data: targetRole } = await adminClient.from("user_roles").select("role").eq("user_id", user_id).single();
        if (targetRole?.role !== "customer_service") {
          return jsonResponse({ error: "You can only change passwords for customer_service users" }, 403);
        }
      }

      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        password,
      });

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ success: true });
    }

    if (action === "delete_user") {
      const { user_id } = body;

      if (!isAdmin) {
        const { data: targetRole } = await adminClient.from("user_roles").select("role").eq("user_id", user_id).single();
        if (targetRole?.role !== "customer_service") {
          return jsonResponse({ error: "You can only delete customer_service users" }, 403);
        }
      }

      if (!user_id) {
        return jsonResponse({ error: "user_id is required" }, 400);
      }

      if (user_id === callerId) {
        return jsonResponse({ error: "You cannot delete your own account while signed in." }, 400);
      }

      const { data: profileBeforeDelete } = await adminClient
        .from("profiles")
        .select("full_name, email")
        .eq("id", user_id)
        .maybeSingle();

      const deletedName = String(profileBeforeDelete?.full_name || profileBeforeDelete?.email || "Deleted user")
        .replace(/\s*\(deleted\)$/i, "")
        .trim();

      const displayName = `${deletedName || "Deleted user"} (deleted)`;

      const preDeleteCleanupResults = await Promise.all([
        adminClient.from("leads").update({ created_by_name: displayName }).eq("created_by", user_id).is("created_by_name", null),
        adminClient.from("leads").update({ last_edited_by_name: displayName }).eq("last_edited_by", user_id).is("last_edited_by_name", null),
        adminClient.from("lead_notes").update({ user_name: displayName }).eq("user_id", user_id).is("user_name", null),
        adminClient.from("lead_updates").update({ author_name: displayName }).eq("author_id", user_id),
        adminClient.from("activity_logs").update({ user_name: displayName }).eq("user_id", user_id),
        adminClient.from("lead_photos").update({ uploaded_by_name: displayName }).eq("uploaded_by", user_id).is("uploaded_by_name", null),
        adminClient.from("lead_payments").update({ created_by_name: displayName }).eq("created_by", user_id).is("created_by_name", null),
        adminClient.from("lead_payment_requests").update({ requested_by_name: displayName }).eq("requested_by", user_id).is("requested_by_name", null),
        adminClient.from("lead_payment_requests").update({ reviewed_by_name: displayName }).eq("reviewed_by", user_id).is("reviewed_by_name", null),
        adminClient.from("lead_cancellation_requests").update({ requested_by_name: displayName }).eq("requested_by", user_id).is("requested_by_name", null),
        adminClient.from("lead_cancellation_requests").update({ reviewed_by_name: displayName }).eq("reviewed_by", user_id).is("reviewed_by_name", null),
        adminClient.from("user_roles").delete().eq("user_id", user_id),
        adminClient.from("navigation_permissions").delete().eq("user_id", user_id),
        adminClient.from("status_permissions").delete().eq("user_id", user_id),
        adminClient.from("notifications").delete().eq("user_id", user_id),
        adminClient.from("user_access_codes").delete().eq("user_id", user_id),
        adminClient.from("lead_shares").delete().or(`shared_with_user_id.eq.${user_id},shared_by.eq.${user_id}`),
      ]);

      const preDeleteCleanupError = preDeleteCleanupResults.find((result) => result.error)?.error;
      if (preDeleteCleanupError) {
        return jsonResponse({ error: preDeleteCleanupError.message }, 400);
      }

      // Hard-delete the auth account. Database constraints clear user links and the
      // delete trigger preserves display-name snapshots on historical CRM rows.
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(user_id);

      const authDeleteMessage = getErrorMessage(authDeleteError);

      if (authDeleteError && !authDeleteMessage.toLowerCase().includes("user not found")) {
        console.error("auth.admin.deleteUser failed:", authDeleteMessage);
        return jsonResponse(
          {
            error:
              "The auth account could not be deleted: " +
              authDeleteMessage,
          },
          400,
        );
      }

      // Keep CRM history intact. Only remove permission/access records that should not
      // remain active for a deleted user. If the auth user was already gone, also remove
      // any leftover CRM profile so the user no longer exists in CRM user lists.
      const cleanupTables = [
        "user_roles",
        "navigation_permissions",
        "status_permissions",
        "notifications",
        "user_access_codes",
        "profiles",
      ];

      const cleanupResults = await Promise.all([
        adminClient.from("user_roles").delete().eq("user_id", user_id),
        adminClient.from("navigation_permissions").delete().eq("user_id", user_id),
        adminClient.from("status_permissions").delete().eq("user_id", user_id),
        adminClient.from("notifications").delete().eq("user_id", user_id),
        adminClient.from("user_access_codes").delete().eq("user_id", user_id),
        adminClient.from("profiles").delete().eq("id", user_id),
      ]);

      const cleanupErrors = cleanupResults
        .map((r, i) => (r.error ? `${cleanupTables[i]}: ${r.error.message}` : null))
        .filter(Boolean);

      if (cleanupErrors.length > 0) {
        console.warn("Cleanup warnings after deleteUser (normal if cascade deleted):", cleanupErrors);
        // Do not fail the request here since the auth account is successfully deleted.
      }

      return jsonResponse({ success: true });
    }

    if (action === "delete_lead") {
      const { lead_id, job_id } = body;

      // Retrieve lead's job_id if not already supplied
      let resolvedJobId = job_id;
      if (!resolvedJobId && lead_id) {
        const { data: leadRecord } = await adminClient
          .from("leads")
          .select("job_id")
          .eq("id", lead_id)
          .maybeSingle();
        if (leadRecord?.job_id) {
          resolvedJobId = leadRecord.job_id;
        }
      }

      await Promise.all([
        adminClient.from("lead_notes").delete().eq("lead_id", lead_id),
        adminClient.from("lead_photos").delete().eq("lead_id", lead_id),
        adminClient.from("lead_shares").delete().eq("lead_id", lead_id),
        adminClient.from("lead_updates").delete().eq("lead_id", lead_id),
        adminClient.from("notifications").delete().eq("lead_id", lead_id),
        adminClient.from("lead_payments").delete().eq("lead_id", lead_id),
        adminClient.from("lead_cancellation_requests").delete().eq("lead_id", lead_id),
        adminClient.from("lead_operator_assignments").delete().eq("lead_id", lead_id),
      ]);

      const { error } = await adminClient.from("leads").delete().eq("id", lead_id);

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ success: true, job_id: resolvedJobId });
    }

    if (action === "list_totp_factors") {
      const { user_id } = body;
      if (!user_id) return jsonResponse({ error: "User ID required" }, 400);

      if (!isAdmin) {
        const { data: targetRoleData } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", user_id)
          .single();

        if (targetRoleData?.role !== "customer_service") {
          return jsonResponse({ error: "CS Admins can only manage customer_service users" }, 403);
        }
      }

      const { data: factorData, error: factorError } = await adminClient.auth.admin.mfa.listFactors({
        userId: user_id,
      });

      if (factorError) {
        return jsonResponse({ error: factorError.message }, 400);
      }

      const totpFactors = factorData?.factors?.filter((f) => f.factor_type === "totp") || [];
      return jsonResponse({
        success: true,
        factors: totpFactors,
        has_active_totp: totpFactors.some((f) => f.status === "verified"),
      });
    }

    if (action === "enroll_totp_user") {
      const { user_id } = body;
      if (!user_id) return jsonResponse({ error: "User ID required" }, 400);

      if (!isAdmin) {
        const { data: targetRoleData } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", user_id)
          .single();

        if (targetRoleData?.role !== "customer_service") {
          return jsonResponse({ error: "CS Admins can only manage customer_service users" }, 403);
        }
      }

      const { data: { user: targetUser }, error: targetUserError } = await adminClient.auth.admin.getUserById(user_id);
      if (targetUserError || !targetUser?.email) {
        return jsonResponse({ error: "Target user not found" }, 404);
      }

      // Delete any existing factors first
      const { data: existingFactors } = await adminClient.auth.admin.mfa.listFactors({ userId: user_id });
      for (const factor of existingFactors?.factors || []) {
        if (factor.factor_type === "totp") {
          await adminClient.auth.admin.mfa.deleteFactor({ userId: user_id, id: factor.id });
        }
      }

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!anonKey) {
        return jsonResponse({ error: "Server configuration missing (SUPABASE_ANON_KEY)" }, 500);
      }

      const anonClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: targetUser.email,
      });

      if (linkError || !linkData?.properties?.hashed_token) {
        return jsonResponse({ error: "Failed to generate session link for MFA enrollment" }, 500);
      }

      const { data: sessionData, error: verifyOtpError } = await anonClient.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: "magiclink",
      });

      if (verifyOtpError || !sessionData?.session?.access_token) {
        return jsonResponse({ error: "Failed to create session for enrollment: " + (verifyOtpError?.message || "") }, 500);
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } },
      });

      const { data: enrollData, error: enrollError } = await userClient.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Marshmallow Authenticator",
        issuer: "Marshmallow",
      });

      if (enrollError || !enrollData) {
        return jsonResponse({ error: "Enrollment failed: " + (enrollError?.message || "") }, 500);
      }

      // Auto-verify with computed TOTP code so it becomes active immediately
      try {
        const secret = enrollData.totp.secret;
        const totpCode = await generateTotpCode(secret);

        const { data: challengeData } = await userClient.auth.mfa.challenge({
          factorId: enrollData.id,
        });

        if (challengeData) {
          await userClient.auth.mfa.verify({
            factorId: enrollData.id,
            challengeId: challengeData.id,
            code: totpCode,
          });
        }
      } catch (verifyErr) {
        console.warn("Auto-verify warning:", verifyErr);
      }

      return jsonResponse({
        success: true,
        factorId: enrollData.id,
        qr_code: enrollData.totp.qr_code,
        secret: enrollData.totp.secret,
        uri: enrollData.totp.uri,
      });
    }

    if (action === "delete_totp_user") {
      const { user_id } = body;
      if (!user_id) return jsonResponse({ error: "User ID required" }, 400);

      if (!isAdmin) {
        const { data: targetRoleData } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", user_id)
          .single();

        if (targetRoleData?.role !== "customer_service") {
          return jsonResponse({ error: "CS Admins can only manage customer_service users" }, 403);
        }
      }

      const { data: factorData, error: factorError } = await adminClient.auth.admin.mfa.listFactors({
        userId: user_id,
      });

      if (factorError) {
        return jsonResponse({ error: factorError.message }, 400);
      }

      for (const factor of factorData?.factors || []) {
        if (factor.factor_type === "totp") {
          await adminClient.auth.admin.mfa.deleteFactor({
            userId: user_id,
            id: factor.id,
          });
        }
      }

      return jsonResponse({ success: true, message: "TOTP factor deleted" });
    }
    return jsonResponse({ error: "Unknown action: " + action }, 400);
  } catch (err) {
    console.error("Edge function error:", err);
    return jsonResponse({ error: "An internal error occurred" }, 500);
  }
});
