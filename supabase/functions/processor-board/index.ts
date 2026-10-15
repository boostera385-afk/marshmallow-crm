import { createClient } from "@supabase/supabase-js";
import { createProcessorBoardHandler } from "../_shared/processor-board-handler.ts";

Deno.serve(createProcessorBoardHandler({
  createClient,
  env: (name) => Deno.env.get(name),
}));
