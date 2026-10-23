import { createClient } from "@supabase/supabase-js";
import { createProcessorDailyHandler } from "../_shared/processor-board-handler.ts";

Deno.serve(createProcessorDailyHandler({
  createClient,
  env: (name) => Deno.env.get(name),
}));
