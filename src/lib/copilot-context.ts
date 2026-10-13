import { createContext, useContext } from "react";
import type { CopilotAccess } from "@/lib/copilot-api";
export const CopilotContext = createContext<{ access: CopilotAccess | null; open: boolean; setOpen: (value: boolean) => void }>({ access: null, open: false, setOpen: () => undefined });
export const useCopilot = () => useContext(CopilotContext);
