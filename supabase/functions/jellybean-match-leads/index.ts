import { createClient } from "@supabase/supabase-js";
import { createJellybeanMatchHandler } from "../_shared/jellybean-match.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const service = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

Deno.serve(createJellybeanMatchHandler({
  env: (name) => Deno.env.get(name),
  rpc: async (fn, args) => {
    if (!service) return { data: null, error: new Error("Server setup is unavailable.") };
    const { data, error } = await service.rpc(fn, args);
    return { data, error };
  },
  fetch: (input, init) => fetch(input, init),
}));
