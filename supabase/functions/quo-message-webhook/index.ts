import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createQuoWebhookHandler } from "../_shared/quo-webhook-handler.ts";

Deno.serve(createQuoWebhookHandler({ createClient, env: (name) => Deno.env.get(name) }));
