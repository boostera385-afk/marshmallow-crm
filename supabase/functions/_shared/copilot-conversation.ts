import { businessDate, emptyCopilotResult, isCopilotDate, reportRange, routeCopilotMessage, shiftDate, type CopilotAccess, type CopilotAsk, type CopilotResult } from "./copilot-core.ts";

// Only recognized refinements inherit a validated search, never model-generated
// permissions or card contents. All inherited filters are re-authorized by RPCs.
export function resolveCopilotQuestion(ask: CopilotAsk, access: CopilotAccess, now = new Date()): CopilotAsk {
  if (ask.intent) return ask;
  const message = ask.message;
  const today = businessDate(now, access.timezone);
  if (ask.previous && /^(only|just|instead|make that|what about|and|explain that|explain it)\b/i.test(message)) {
    const previous = ask.previous;
    const refinement = /^(only|just|instead|make that|what about|and)\s+/i;
    const next: CopilotAsk = { ...ask, ...previous, offset: 0 };
    if (previous.intent === "report" && /^explain (that|it)/i.test(message)) return { ...next, intent: "explain_report" };
    if (previous.intent === "report" && /today|yesterday|week|last 7/i.test(message)) return { ...next, ...reportRange(message, today) };
    if (previous.intent === "leads" && /^(only |just |instead |make that |what about |and )?(today|tomorrow|yesterday)[.! ]*$/i.test(message)) {
      return { ...next, date: shiftDate(today, /tomorrow/i.test(message) ? 1 : /yesterday/i.test(message) ? -1 : 0) };
    }
    if (previous.intent === "technicians" && /^(only|just) (active|inactive)[.! ]*$/i.test(message)) return { ...next, active: !/inactive/i.test(message) };
    const area = message.match(/^(?:only|just|instead|and) in (.{1,100})$/i);
    if (area && previous.intent !== "report") return { ...next, area: area[1].trim() };
    const service = message.match(/^(?:only|just|instead|and) (?:service )?(plumbing|electrical|hvac|cleaning|handyman|appliance repair)[.! ]*$/i);
    if (service && previous.intent !== "report") return { ...next, service: service[1] };
    const status = message.match(/^(?:only|just|instead|and) (urgent|scheduled|need tech)[.! ]*$/i);
    if (status && previous.intent === "leads") return { ...next, status: /urgent/i.test(status[1]) ? "urgent_job" : /scheduled/i.test(status[1]) ? "scheduled" : "need_tech" };
    if (refinement.test(message)) return { ...ask, intent: "clarify" };
  }
  // Natural-language filters with explicit meanings, without stripping arbitrary
  // customer names or pretending to support unsupported constraints.
  const match = message.match(/^(?:find|show|search|get)\s+(?:(urgent|scheduled|need tech|active|inactive)\s+)?(?:(plumbing|electrical|hvac|cleaning|handyman|appliance repair)\s+)?(leads|jobs|technicians|techs)(?:\s+in\s+(.+?))?(?:\s+(today|tomorrow|yesterday))?[.! ]*$/i);
  if (match && /tech/i.test(match[3]) && (match[5] || (match[1] && !/active/i.test(match[1])))) return { ...ask, intent: "clarify" };
  if (match && !/tech/i.test(match[3]) && /active/i.test(match[1] ?? "")) return { ...ask, intent: "clarify" };
  if (match) return { ...ask, intent: /tech/i.test(match[3]) ? "technicians" : "leads", query: "",
    status: match[1] && !/active/i.test(match[1]) ? /urgent/i.test(match[1]) ? "urgent_job" : /scheduled/i.test(match[1]) ? "scheduled" : "need_tech" : undefined,
    active: match[1] && /active/i.test(match[1]) ? !/inactive/i.test(match[1]) : undefined,
    service: match[2], area: match[4]?.trim(), date: match[5] ? shiftDate(today, /tomorrow/i.test(match[5]) ? 1 : /yesterday/i.test(match[5]) ? -1 : 0) : undefined };
  const route = routeCopilotMessage(message);
  if (["report", "explain_report"].includes(route.intent)) {
    const dates = message.match(/\b(\d{4}-\d{2}-\d{2})\s+(?:to|through)\s+(\d{4}-\d{2}-\d{2})\b/);
    if (dates) return isCopilotDate(dates[1]) && isCopilotDate(dates[2]) ? { ...ask, intent: route.intent, start: dates[1], end: dates[2], scope: /\bteam\b/i.test(message) ? "team" : "mine" } : { ...ask, intent: "clarify" };
  }
  if (/^(only|just|what about|explain that|explain it)\b/i.test(message) && !ask.previous) return { ...ask, intent: "clarify" };
  return { ...ask, intent: route.intent, query: ask.query ?? route.query, status: ask.status ?? route.status,
    date: ask.date ?? (route.dayOffset !== undefined ? shiftDate(today, route.dayOffset) : undefined) };
}

export function clarification(): CopilotResult {
  return { ...emptyCopilotResult("clarify"), title: "A little more detail", text: "Which records or date range do you mean? Try “Find leads in Miami tomorrow”, “My report this week”, or refine a previous search with “only active”, “only urgent”, or “only in Miami”. No AI allowance was used." };
}

export function interpretedFilters(ask: CopilotAsk): { label: string; value: string }[] {
  return Object.entries({ Search: ask.query, Status: ask.status?.replace(/_/g, " "), Service: ask.service, Area: ask.area,
    Scheduled: ask.date, Active: ask.active === true ? "Active" : ask.active === false ? "Inactive" : undefined,
    From: ask.start, To: ask.end, Scope: ask.scope }).flatMap(([label, value]) => value ? [{ label, value }] : []);
}
