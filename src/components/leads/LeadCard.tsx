import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { memo } from "react";
import { differenceInCalendarDays, startOfDay, isBefore } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLastMessageFromCustomer } from "@/hooks/useIsLastMessageFromCustomer";
import { expandStateAbbreviation } from "@/lib/utils";
import { openLeadFromClick } from "@/lib/lead-navigation";
import { requestQuoteApproval } from "@/lib/quote-approval-requests";
import { Lead, LeadStatus, STATUS_LABELS, getChangeableStatuses, canChangeStatus } from "@/lib/constants";
import { CS_TAG_LABELS, type CsTag } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Phone,
  MapPin,
  UserRound,
  Trash2,
  Pencil,
  MessageSquare,
  Wrench,
  CalendarDays,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  ShieldCheck,
  XCircle,
  Copy,
  Check,
  Clipboard,
  ExternalLink,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import NoteThread from "./NoteThread";
import PaymentDialog from "./PaymentDialog";
import LeadShareDialog from "./LeadShareDialog";
import CancelledStatusBadge from "./CancelledStatusBadge";
import NearbyUrgentLeads from "./NearbyUrgentLeads";
import type { ProximityLead } from "@/lib/lead-proximity";
import MultiDateTimePicker from "./MultiDateTimePicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CopyValueButton from "./CopyValueButton";
import CancellationRequestSheet from "./CancellationRequestSheet";
import QuoPhoneTrigger from "./QuoPhoneTrigger";
import { adminApi } from "@/lib/admin-api";
import { logActivity } from "@/lib/activity";
import LeadPhotoActions from "./LeadPhotoActions";
import CompleteLeadCopyButton from "./CompleteLeadCopyButton";
import CxUpdateRequestButton from "./CxUpdateRequestButton";
import {
  canCreateCancellationRequest,
  createCancellationRequest,
  fetchPendingCancellationRequest,
} from "@/lib/cancellation-requests";
import { createPaymentRequest } from "@/lib/payment-requests";
import type { LeadCancellationRequest } from "@/types";
import { optimizeImageForUpload } from "@/lib/image-upload";
import { getAssignableLeadTags, isQuotationMaster } from "@/lib/lead-tags";
import { countTechs } from "@/lib/lead-techs";
import { dispatchLeadStatusNotification } from "@/lib/lead-notifications";
import { saveLeadTag } from "@/lib/lead-tag-actions";
import { canSeeTechDetails, isOperatorRole } from "@/lib/access";
import BookingDateTimeDialog, { formatBookingCompact, isBookingExpired } from "./BookingDateTimeDialog";
import AssignLeadToOperatorDialog from "./AssignLeadToOperatorDialog";
import ActivateCustomerNoteDialog from "./ActivateCustomerNoteDialog";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuoAttention } from "@/hooks/useQuoAttention";
import { History } from "lucide-react";
import LeadStatusHistoryDialog from "./LeadStatusHistoryDialog";
import LeadCoverageBadge from "./LeadCoverageBadge";
import UrgentAICheckDialog from "./UrgentAICheckDialog";
import { showsUrgentCheck } from "@/lib/urgent-verification";

interface LeadCardProps {
  lead: Lead;
  profiles: Record<string, string>;
  onRefresh: () => void;
  photoUrls?: string[];
  disablePhotoPreview?: boolean;
  initialHasNotes?: { general: boolean; cs: boolean; processor: boolean; opr?: boolean };
  /** Techs recorded in the processor notes, shown on the collapsed row. */
  initialTechCount?: number;
  /** Reason from the newest cancellation request, shown inline on a cancelled card. */
  initialCancellationReason?: string | null;
  /** Lets the list drop the card immediately instead of waiting for the refetch. */
  onDeleted?: (leadId: string) => void;
  /** Other urgent leads in this one's area. Computed by the list so it stays live. */
  nearbyUrgentLeads?: ProximityLead[];
  initialPhotoCount?: number;
  initialPhotoPaths?: string[];
  initialPendingCancellationRequest?: LeadCancellationRequest | null;
  /** A quote approval this lead is still waiting on a CS Admin to decide. */
  pendingQuoteApproval?: boolean;
  /**
   * A quote approval this viewer can decide, rendered with its actions directly
   * above the status control. Supplied by the Quote Approval page; every other
   * list leaves it out and shows no review actions.
   */
  quoteApproval?: {
    requestedByName?: string | null;
    requestedAt?: string | null;
    busy?: boolean;
    onApprove: () => void;
    onDecline: () => void;
  } | null;
}

const NOTE_INDICATOR_START_AT = new Date("2026-06-12T12:01:26.000Z").getTime();

function formatDateTime(value?: string | null) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDate(value?: string | null) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

type ScheduleDateEntry = { month: number; day: number; year?: number; endDay?: number };

const SCHEDULE_WEEKDAYS: Record<string, string> = {
  sunday: "Sun", sun: "Sun",
  monday: "Mon", mon: "Mon",
  tuesday: "Tue", tue: "Tue", tues: "Tue",
  wednesday: "Wed", wed: "Wed",
  thursday: "Thu", thu: "Thu", thur: "Thu", thurs: "Thu",
  friday: "Fri", fri: "Fri",
  saturday: "Sat", sat: "Sat",
};

const SCHEDULE_MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const SCHEDULE_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCHEDULE_MONTH_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function findDatesInScheduleText(rawSeg: string): ScheduleDateEntry[] {
  const TIME_RANGE_RX_G = /(?<!\d[-/])\b(?:noon|midnight|\d{1,2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(?:noon|midnight|\d{1,2}(?::\d{2})?)\s*(?:a\.?m\.?|p\.?m\.?)?(?![-/]\d)/gi;
  const TIME_SINGLE_RX_G = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:noon|midnight)\b/gi;
  const seg = rawSeg.replace(TIME_RANGE_RX_G, " ").replace(TIME_SINGLE_RX_G, " ");
  const results: ScheduleDateEntry[] = [];
  const nowMonth = new Date().getMonth();

  const push = (mo: number, d: number, endD?: number, yr?: number) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return;
    if (endD !== undefined && (endD < d || endD > 31)) return;
    if (endD === undefined && results.some((r) => r.month === mo && r.day === d && r.endDay === undefined)) return;
    results.push({ month: mo, day: d, endDay: endD, year: yr });
  };

  // 1. ISO date: YYYY-MM-DD or YYYY/MM/DD
  const iso = rawSeg.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    push(Number(iso[2]) - 1, Number(iso[3]), undefined, Number(iso[1]));
  }

  // 2. Slash date: MM/DD/YYYY or DD/MM/YYYY
  const slash = rawSeg.match(/(?<!\d[-/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/);
  if (slash) {
    const p1 = Number(slash[1]);
    const p2 = Number(slash[2]);
    const yr = slash[3] ? (Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3])) : undefined;
    if (p1 > 12 && p2 <= 12) {
      push(p2 - 1, p1, undefined, yr);
    } else if (p1 <= 12) {
      push(p1 - 1, p2, undefined, yr);
    }
  }

  // Date range: "August 25, 2026 to August 29, 2026" or "August 25 to August 29"
  const rangeMonthFirst = seg.match(
    new RegExp(
      `\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\s+(?:to|through|until|–|-)\\s+${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`,
      "i"
    )
  );
  if (rangeMonthFirst) {
    const m1 = SCHEDULE_MONTHS[rangeMonthFirst[1].toLowerCase()];
    const m2 = SCHEDULE_MONTHS[rangeMonthFirst[4].toLowerCase()];
    if (m1 !== undefined && m2 !== undefined) {
      const yr = rangeMonthFirst[6]
        ? Number(rangeMonthFirst[6]) < 100
          ? 2000 + Number(rangeMonthFirst[6])
          : Number(rangeMonthFirst[6])
        : rangeMonthFirst[3]
        ? Number(rangeMonthFirst[3]) < 100
          ? 2000 + Number(rangeMonthFirst[3])
          : Number(rangeMonthFirst[3])
        : undefined;

      if (m1 === m2) {
        push(m1, Number(rangeMonthFirst[2]), Number(rangeMonthFirst[5]), yr);
        return results;
      }
    }
  }

  // Date range: "27th July to 31st July"
  const rangeA = seg.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}\\s+(?:to|through|until|–|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeA && SCHEDULE_MONTHS[rangeA[2].toLowerCase()] === SCHEDULE_MONTHS[rangeA[4].toLowerCase()]) {
    const yr = rangeA[5] ? (Number(rangeA[5]) < 100 ? 2000 + Number(rangeA[5]) : Number(rangeA[5])) : undefined;
    push(SCHEDULE_MONTHS[rangeA[2].toLowerCase()], Number(rangeA[1]), Number(rangeA[3]), yr);
    return results;
  }

  // "27th to 31st July"
  const rangeB = seg.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|through|until|–|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeB) {
    const yr = rangeB[4] ? (Number(rangeB[4]) < 100 ? 2000 + Number(rangeB[4]) : Number(rangeB[4])) : undefined;
    push(SCHEDULE_MONTHS[rangeB[3].toLowerCase()], Number(rangeB[1]), Number(rangeB[2]), yr);
    return results;
  }

  // "July 27-31" / "July 27 to 31"
  const rangeC = seg.match(new RegExp(`\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|through|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeC) {
    const yr = rangeC[4] ? (Number(rangeC[4]) < 100 ? 2000 + Number(rangeC[4]) : Number(rangeC[4])) : undefined;
    push(SCHEDULE_MONTHS[rangeC[1].toLowerCase()], Number(rangeC[2]), Number(rangeC[3]), yr);
    return results;
  }

  // Grouped: "21st or 22nd July", "20, 21 July"
  const grouped = seg.match(new RegExp(`((?:\\d{1,2}(?:st|nd|rd|th)?)(?:\\s*(?:,|&|and|or|\\/)\\s*\\d{1,2}(?:st|nd|rd|th)?)+)\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (grouped) {
    const mo = SCHEDULE_MONTHS[grouped[2].toLowerCase()];
    const yr = grouped[3] ? (Number(grouped[3]) < 100 ? 2000 + Number(grouped[3]) : Number(grouped[3])) : undefined;
    const days = grouped[1]
      .split(/,|&|\band\b|\bor\b|\//i)
      .map((s) => Number(s.replace(/\D/g, "")))
      .filter((d) => d >= 1 && d <= 31);
    if (mo !== undefined) days.forEach((d) => push(mo, d, undefined, yr));
    return results;
  }

  // "21st July 2026" / "21 July"
  let m: RegExpExecArray | null;
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "gi");
  while ((m = dm.exec(seg)) !== null) {
    const yr = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    push(SCHEDULE_MONTHS[m[2].toLowerCase()], Number(m[1]), undefined, yr);
  }

  // "July 21, 2026" / "July 21"
  const md = new RegExp(`\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "gi");
  while ((m = md.exec(seg)) !== null) {
    const yr = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    push(SCHEDULE_MONTHS[m[1].toLowerCase()], Number(m[2]), undefined, yr);
  }

  // Bare ordinal — use current month
  if (results.length === 0) {
    const ord = seg.match(/\b(\d{1,2})(st|nd|rd|th)\b/i);
    if (ord) push(nowMonth, Number(ord[1]));
  }

  results.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.month - b.month || a.day - b.day);
  return results;
}

function isScheduleRequirementFarFuture(text?: string | null, daysThreshold = 3): boolean {
  if (!text || !text.trim()) return false;
  const dates = findDatesInScheduleText(text);
  if (!dates || dates.length === 0) return false;

  const now = startOfDay(new Date());
  const currentYear = now.getFullYear();

  const calendarDates = dates.map((d) => {
    const y = d.year ?? currentYear;
    let dt = startOfDay(new Date(y, d.month, d.day));
    if (!d.year && isBefore(dt, now) && d.month < now.getMonth()) {
      dt = startOfDay(new Date(currentYear + 1, d.month, d.day));
    }
    return dt;
  });

  const futureDates = calendarDates.filter((dt) => !isBefore(dt, now));
  if (futureDates.length === 0) {
    return false;
  }

  const earliestFuture = futureDates.sort((a, b) => a.getTime() - b.getTime())[0];
  const diffDays = differenceInCalendarDays(earliestFuture, now);
  return diffDays > daysThreshold;
}

function formatScheduleRequirementCompact(text?: string | null): { summary: string; full: string } | null {
  if (!text) return null;
  const full = text.trim();
  if (!full) return null;

  const lower = full.toLowerCase();

  type PT = { h: number; m: number; ap: "am" | "pm" | null };
  const parseTimeToken = (str: string): PT | null => {
    if (/noon/i.test(str)) return { h: 12, m: 0, ap: "pm" };
    if (/midnight/i.test(str)) return { h: 12, m: 0, ap: "am" };
    const m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
    if (!m) return null;
    const h = Number(m[1]);
    if (h > 24) return null;
    return { h, m: m[2] ? Number(m[2]) : 0, ap: m[3] ? (m[3][0].toLowerCase() === "p" ? "pm" : "am") : null };
  };
  const displayHr = (h: number) => (h === 0 ? 12 : h > 12 ? h - 12 : h);
  const fmtOne = (t: PT, inheritAp: "am" | "pm" | null = null) => {
    const ap = t.ap ?? inheritAp;
    let s = String(displayHr(t.h));
    if (t.m) s += `:${String(t.m).padStart(2, "0")}`;
    if (ap) s += ` ${ap.toUpperCase()}`;
    return s;
  };

  const findTime = (seg: string): string | null => {
    const rangeRe = new RegExp(
      `(?:from\\s+)?(noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?)\\s*(?:-|–|—|to)\\s*(noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?)`,
      "i",
    );
    const r = seg.match(rangeRe);
    if (r) {
      const t1 = parseTimeToken(r[1]);
      const t2 = parseTimeToken(r[2]);
      if (t1 && t2) {
        const ap1 = t1.ap ?? t2.ap;
        const ap2 = t2.ap ?? ap1;
        if (ap1 && ap2 && ap1 === ap2) {
          const h1 = `${displayHr(t1.h)}${t1.m ? `:${String(t1.m).padStart(2, "0")}` : ""}`;
          const h2 = `${displayHr(t2.h)}${t2.m ? `:${String(t2.m).padStart(2, "0")}` : ""}`;
          return `${h1}–${h2} ${ap2.toUpperCase()}`;
        }
        return `${fmtOne(t1, ap1)}–${fmtOne(t2, ap2)}`;
      }
    }
    const a = seg.match(/\b(after|before|around|by|past)\s+(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
    if (a) {
      const t = parseTimeToken(a[2]);
      if (t) {
        const ap = t.ap ?? (t.h >= 8 && t.h <= 11 ? "am" : t.h >= 1 && t.h <= 7 ? "pm" : null);
        return `${a[1].toLowerCase()} ${fmtOne(t, ap)}`;
      }
    }
    const single = seg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(noon|midnight)\b/i);
    if (single) {
      const t = parseTimeToken(single[0]);
      if (t) return fmtOne(t);
    }
    if (/\bmorning\b/i.test(seg)) return "Morning";
    if (/\bafternoon\b/i.test(seg)) return "Afternoon";
    if (/\bevening\b/i.test(seg)) return "Evening";
    if (/\banytime\b|\ball\s*day\b/i.test(seg)) return "Anytime";
    return null;
  };

  const findWeekdays = (seg: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const re = /\b(sunday|sun|monday|mon|tuesday|tues?|wednesday|wed|thursday|thurs?|thu|friday|fri|saturday|sat)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      const w = SCHEDULE_WEEKDAYS[m[1].toLowerCase()];
      if (w && !seen.has(w)) { seen.add(w); out.push(w); }
    }
    return out;
  };

  const fmtDate = (d: ScheduleDateEntry) => {
    const base = `${SCHEDULE_MONTH_SHORT[d.month]} ${d.day}`;
    return d.endDay ? `${base} to ${SCHEDULE_MONTH_SHORT[d.month]} ${d.endDay}` : base;
  };

  const joinTime = (dayPart: string, time: string | null): string => {
    if (!time) return dayPart;
    if (!dayPart) return time;
    if (/^(after|before|around|by|past)\s/i.test(time)) return `${dayPart} ${time}`;
    return `${dayPart} · ${time}`;
  };

  const renderSeg = (seg: string, assignedDate?: ScheduleDateEntry): string => {
    const weekdays = findWeekdays(seg);
    const dates = assignedDate ? [assignedDate] : findDatesInScheduleText(seg);
    const time = findTime(seg);
    const dayStrs: string[] = [];
    if (dates.length) {
      for (let i = 0; i < dates.length; i++) {
        const wd = weekdays[i] ?? (weekdays.length === 1 ? weekdays[0] : "");
        const s = fmtDate(dates[i]);
        dayStrs.push(wd ? `${wd} ${s}` : s);
      }
    } else {
      for (const wd of weekdays) dayStrs.push(wd);
    }
    return joinTime(dayStrs.join(" / "), time);
  };

  // Extract trailing parenthetical of dates so weekday-only segments can be paired to them.
  let workingText = full;
  let sharedDates: ScheduleDateEntry[] = [];
  const parenMatch = full.match(/\(([^)]+)\)\s*$/);
  if (parenMatch && parenMatch.index !== undefined) {
    const innerDates = findDatesInScheduleText(parenMatch[1]);
    if (innerDates.length) {
      sharedDates = innerDates;
      workingText = full.slice(0, parenMatch.index).trim();
    }
  }

  // Split into option segments. Only split on " or " / ";" / " / " when followed by a capitalized token
  // (avoids breaking "Mon 3/4" style content).
  const rawSegs = workingText
    .split(/\n|\s+or\s+|\s*;\s*|\s*\/\s*(?=[A-Z])/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const segments = rawSegs.length > 1 ? rawSegs : [workingText];

  let summary = "";
  if (sharedDates.length && sharedDates.length === segments.length) {
    summary = segments.map((s, i) => renderSeg(s, sharedDates[i])).filter(Boolean).join(" / ");
  } else if (sharedDates.length === 1 && segments.length >= 1) {
    const bodies = segments.map((s) => renderSeg(s)).filter(Boolean);
    const dateStr = fmtDate(sharedDates[0]);
    const joined = bodies.join(" / ");
    summary = joined ? (joined.includes(SCHEDULE_MONTH_SHORT[sharedDates[0].month]) ? joined : `${dateStr} · ${joined}`) : dateStr;
  } else if (segments.length === 1) {
    summary = renderSeg(segments[0]);
  } else {
    summary = segments.map((s) => renderSeg(s)).filter(Boolean).join(" / ");
  }

  // Preserve flexibility wording when meaningful
  const anyDay = /\bany\s*day\b/i.test(full);
  const anyTime = /\bany\s*time\b/i.test(full);
  const flexible = /\bflex(ible)?\b|\bwhenever\b/i.test(full);
  let flexTag = "";
  if (anyDay && anyTime) flexTag = "Any Day & Time";
  else if (anyDay) flexTag = "Any Day";
  else if (anyTime) flexTag = "Anytime";
  else if (flexible) flexTag = "Flexible";
  if (flexTag) {
    if (!summary) summary = flexTag;
    else if (!new RegExp(flexTag.replace(/&/g, "&").replace(/\s+/g, "\\s+"), "i").test(summary)) {
      summary = `${summary} · ${flexTag}`;
    }
  }

  if (!summary) {
    const hasWeekend = /\bweekend\b/.test(lower);
    const hasNextWeek = /\bnext\s+week\b/.test(lower);
    const hasThisWeek = /\bthis\s+week\b/.test(lower);
    if (hasWeekend) summary = "Weekend · Flexible";
    else if (hasNextWeek) summary = "Next week · Flexible";
    else if (hasThisWeek) summary = "This week · Flexible";
    else summary = full.length > 32 ? full.slice(0, 30).trim() + "…" : full;
  }

  if (summary.length > 64) summary = summary.slice(0, 62).trim() + "…";
  return { summary, full };
}

function formatScheduleForCopy(lead: Lead) {
  const date = lead.scheduled_date || "TBD";
  const start = lead.scheduled_time_start || "";
  const end = lead.scheduled_time_end || "";
  const time = start && end ? `${start} - ${end}` : start || end;
  return time ? `${date}, ${time}` : date;
}

// Hoisted out of LeadCard: defining it inside caused a remount on every card re-render
// (realtime updates), which reset the notes textarea focus/cursor while typing.
interface NoteCollapsibleProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  pinned: boolean;
  setPinned: (v: boolean) => void;
  label: string;
  noteType: "general" | "cs" | "processor" | "opr";
  tone?: "default" | "cs" | "processor" | "opr";
  hasNotes?: boolean;
  techCount?: number;
  reduceMotion?: boolean;
  leadId: string;
  profiles: Record<string, string>;
  refreshCardMeta: () => void;
}

function NoteCollapsible({
  open,
  setOpen,
  pinned,
  setPinned,
  label,
  noteType,
  tone = "default",
  hasNotes = false,
  techCount = 0,
  reduceMotion,
  leadId,
  profiles,
  refreshCardMeta,
}: NoteCollapsibleProps) {
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const toneClasses =
    tone === "cs"
      ? "crm-lead-card-soft border-amber-200/70 bg-[linear-gradient(180deg,hsl(42_100%_99%/0.86),hsl(42_100%_96%/0.7))] shadow-[0_14px_22px_-20px_rgba(245,158,11,0.12)] hover:border-amber-300/75 hover:bg-[linear-gradient(180deg,hsl(42_100%_99%/0.92),hsl(42_100%_96%/0.76))] dark:border-amber-400/22 dark:bg-[linear-gradient(180deg,hsl(34_34%_20%/0.94),hsl(32_28%_18%/0.9))] dark:shadow-none"
      : tone === "processor"
        ? "crm-lead-card-soft border-sky-200/72 bg-[linear-gradient(180deg,hsl(198_100%_99%/0.86),hsl(201_100%_96%/0.72))] shadow-[0_14px_22px_-20px_rgba(59,130,246,0.12)] hover:border-sky-300/78 hover:bg-[linear-gradient(180deg,hsl(198_100%_99%/0.92),hsl(201_100%_96%/0.78))] dark:border-sky-400/20 dark:bg-[linear-gradient(180deg,hsl(210_38%_20%/0.95),hsl(214_32%_18%/0.9))] dark:shadow-none"
        : tone === "opr"
          ? "crm-lead-card-soft border-emerald-200/70 bg-[linear-gradient(180deg,hsl(152_100%_99%/0.86),hsl(155_100%_96%/0.7))] shadow-[0_14px_22px_-20px_rgba(16,185,129,0.12)] hover:border-emerald-300/75 hover:bg-[linear-gradient(180deg,hsl(152_100%_99%/0.92),hsl(155_100%_96%/0.76))] dark:border-emerald-400/22 dark:bg-[linear-gradient(180deg,hsl(158_34%_20%/0.94),hsl(156_28%_18%/0.9))] dark:shadow-none"
          : "crm-lead-card-soft shadow-[0_16px_26px_-22px_rgba(59,130,246,0.12)] hover:border-primary/20 hover:bg-[linear-gradient(180deg,hsl(210_100%_99%/0.98),hsl(212_100%_97%/0.86))] dark:bg-[linear-gradient(180deg,hsl(223_22%_18%/0.94),hsl(224_20%_16%/0.9))] dark:shadow-none";

  const dotColor =
    tone === "cs" ? "bg-amber-500" : tone === "processor" ? "bg-sky-500" : tone === "opr" ? "bg-emerald-500" : "bg-primary";

  // Compact label so all four note toggles fit on one row of a narrow card.
  const shortLabel =
    noteType === "general" ? "Notes" : noteType === "cs" ? "CS" : noteType === "processor" ? "Processor" : "OPR";

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (!open) {
      enterTimerRef.current = setTimeout(() => {
        setOpen(true);
      }, 350);
    }
  };

  const handleMouseMove = () => {
    if (!open && !pinned) {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      enterTimerRef.current = setTimeout(() => {
        setOpen(true);
      }, 350);
    }
  };

  const handleMouseLeave = () => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (!pinned) {
      leaveTimerRef.current = setTimeout(() => {
        setOpen(false);
      }, 300);
    }
  };

  return (
    <div
      className="min-w-0 flex-1"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
          if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
          if (nextOpen) {
            setPinned(true);
            setOpen(true);
          } else {
            setPinned(false);
            setOpen(false);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
              if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
              if (pinned) {
                setPinned(false);
                setOpen(false);
              } else {
                setPinned(true);
                setOpen(true);
              }
            }}
            title={hasNotes ? `${label} — has notes` : label}
            className={`flex w-full items-center justify-center gap-1.5 h-11 rounded-xl border px-1.5 text-[11px] text-muted-foreground hover:text-foreground ${open ? "border-primary/30" : ""} ${toneClasses}`}
          >
            <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <MessageSquare className="h-3.5 w-3.5" />
              {hasNotes && (
                <span className="absolute -right-1 -top-1 flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-70`} />
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
                </span>
              )}
            </span>
            <span className="min-w-0 truncate font-medium">{shortLabel}</span>
            {techCount > 0 && (
              <span className="shrink-0 rounded-full bg-sky-500/15 px-1 py-px text-[9px] font-semibold text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
                {techCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <AnimatePresence initial={false}>
          {open && (
            <PopoverContent 
              forceMount 
              asChild
              side="bottom"
              align="center"
              sideOffset={8}
              collisionPadding={12}
              className="z-[100] w-[min(360px,calc(100vw-2rem))] p-2"
              onInteractOutside={(e) => {
                if (pinned) {
                  e.preventDefault(); 
                  setPinned(false);
                  setOpen(false);
                }
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.2,
                  ease: "easeOut",
                }}
              >
                <NoteThread
                  leadId={leadId}
                  noteType={noteType}
                  label={label}
                  profiles={profiles}
                  onNotesChanged={refreshCardMeta}
                />
              </motion.div>
            </PopoverContent>
          )}
        </AnimatePresence>
      </Popover>
    </div>
  );
}

function LeadCard({
  lead,
  profiles,
  onRefresh,
  photoUrls,
  disablePhotoPreview = false,
  initialHasNotes,
  initialTechCount,
  initialCancellationReason,
  onDeleted,
  nearbyUrgentLeads,
  initialPhotoCount,
  initialPhotoPaths,
  initialPendingCancellationRequest,
  pendingQuoteApproval = false,
  quoteApproval = null,
}: LeadCardProps) {
  const { user, role, profile, canAccess } = useAuth();
  const navigate = useNavigate();
  const [changingStatus, setChangingStatus] = useState(false);
  const [csOpen, setCsOpen] = useState(false);
  const [processorOpen, setProcessorOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(false);
  const [oprOpen, setOprOpen] = useState(false);
  // Seeded from the list query so the collapsed row can show it, then recounted locally once
  // the thread has been opened and edited.
  const [techCount, setTechCount] = useState(initialTechCount ?? 0);

  // Schedule requirement is editable straight from the card, so CS does not have to open the
  // lead just to add a date.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Service details shows on the card surface, clamped until the user expands it.
  const [serviceDetailsExpanded, setServiceDetailsExpanded] = useState(false);

  useEffect(() => {
    if (initialTechCount !== undefined) setTechCount(initialTechCount);
  }, [initialTechCount]);

  const [generalPinned, setGeneralPinned] = useState(false);
  const [csPinned, setCsPinned] = useState(false);
  const [processorPinned, setProcessorPinned] = useState(false);
  const [oprPinned, setOprPinned] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [cancelRequestOpen, setCancelRequestOpen] = useState(false);
  const [cancelRequestLoading, setCancelRequestLoading] = useState(false);
  const [cancelReviewLoading, setCancelReviewLoading] = useState(false);
  const [pendingCancellationRequest, setPendingCancellationRequest] = useState<LeadCancellationRequest | null>(
    initialPendingCancellationRequest !== undefined ? initialPendingCancellationRequest : null
  );
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [bookingDialogMode, setBookingDialogMode] = useState<"add" | "edit">("add");
  const [assignOprOpen, setAssignOprOpen] = useState(false);
  const [activateCustomerOpen, setActivateCustomerOpen] = useState(false);
  const [statusHistoryOpen, setStatusHistoryOpen] = useState(false);
  const [urgentCheckOpen, setUrgentCheckOpen] = useState(false);
  // Tick every 30s so blinking/expiry state stays fresh without a full refetch.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [resolvedPaymentOriginal, setResolvedPaymentOriginal] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(
    initialPhotoCount !== undefined ? initialPhotoCount : 0
  );
  const [hasNotes, setHasNotes] = useState<{ general: boolean; cs: boolean; processor: boolean; opr: boolean }>(
    initialHasNotes !== undefined ? { opr: false, ...initialHasNotes } : {
      general: false,
      cs: false,
      processor: false,
      opr: false,
    }
  );
  const reduceMotion = useReducedMotion();
  const { needsAttention: quoNeedsAttention } = useQuoAttention({
    leadId: lead.id,
    phone: lead.customer_phone,
    status: lead.status,
    updatedAt: lead.updated_at,
  });

  useEffect(() => {
    if (initialHasNotes !== undefined) {
      setHasNotes({ opr: false, ...initialHasNotes });
    }
  }, [initialHasNotes]);

  useEffect(() => {
    if (initialPhotoCount !== undefined) {
      setPhotoCount(initialPhotoCount);
    }
  }, [initialPhotoCount]);

  useEffect(() => {
    if (initialPendingCancellationRequest !== undefined) {
      setPendingCancellationRequest(initialPendingCancellationRequest);
    }
  }, [initialPendingCancellationRequest]);

  const shouldShowPersistentNoteDots = () => {
    const createdAt = new Date(lead.created_at).getTime();
    return !Number.isNaN(createdAt) && createdAt >= NOTE_INDICATOR_START_AT;
  };

  const refreshNotePresence = async () => {
    if (!shouldShowPersistentNoteDots()) {
      setHasNotes({ general: false, cs: false, processor: false, opr: false });
      return;
    }

    const { data } = await supabase
      .from("lead_notes")
      .select("note_type")
      .eq("lead_id", lead.id);
    if (!data) return;

    const present = new Set((data as { note_type: string }[]).map((row) => row.note_type));
    setHasNotes({
      general: present.has("general"),
      cs: present.has("cs"),
      processor: present.has("processor"),
      opr: present.has("opr"),
    });
  };

  useEffect(() => {
    if (initialHasNotes === undefined) {
      void refreshNotePresence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.created_at, initialHasNotes]);

  const loadPhotoCount = async () => {
    if (photoUrls) {
      setPhotoCount(photoUrls.length);
      return;
    }

    const { count } = await supabase
      .from("lead_photos")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    setPhotoCount(count ?? 0);
  };

  useEffect(() => {
    if (initialPhotoCount === undefined) {
      void loadPhotoCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, photoUrls, initialPhotoCount]);

  const refreshPendingCancellationRequest = async () => {
    const request = await fetchPendingCancellationRequest(lead.id);
    setPendingCancellationRequest(request);
  };

  useEffect(() => {
    if (initialPendingCancellationRequest === undefined) {
      void refreshPendingCancellationRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.status, initialPendingCancellationRequest]);

  const refreshCardMeta = () => {
    void refreshNotePresence();
    void loadPhotoCount();
    void refreshPendingCancellationRequest();
  };

  const isAdmin = role === "admin";
  const hasQuickChatAccess = canAccess("quick_chat");
  // CS Admins never see technician details, so no tech chat either.
  const hasTechQuickChatAccess = canAccess("tech_quick_chat") && canSeeTechDetails(role);
  const isCS = role === "customer_service";
  const isCsAdmin = role === "cs_admin";
  const isProcessor = role === "processor";
  const isOpr = isOperatorRole(role);
  const isPaid = lead.status === "paid";
  const isUrgent = lead.status === "urgent_job";

  // Amount revealed on hover over the Paid badge. Prefer the recorded payment
  // amount; if none was recorded, fall back to the CS quote. The legacy numeric
  // `amount` column is intentionally not used — it holds stale placeholder data.
  const paidAmountInfo = (() => {
    if (!isPaid) return null;
    const paidRaw = lead.payment_amount;
    const paid = paidRaw == null ? NaN : Number(paidRaw);
    if (Number.isFinite(paid) && paid > 0) {
      return {
        heading: "Payment amount",
        value: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(paid),
      };
    }
    const quote = (lead.quote ?? "").trim();
    if (quote) return { heading: "Quote", value: quote };
    return null;
  })();
  const currentTag = lead.cs_tag ?? null;
  const assignableTags = getAssignableLeadTags(role, { isQuotationMaster: profile?.is_quotation_master });

  const hasScheduleTag =
    currentTag === "ready_to_schedule" ||
    currentTag === "confirmation_sent" ||
    currentTag === "waiting_schedule_confirmation" ||
    currentTag === "booked";

  const { isFromCustomer } = useIsLastMessageFromCustomer(lead.customer_phone, hasScheduleTag);
  const needsScheduleBlink = hasScheduleTag && isFromCustomer;
  const isActivateCustomer = lead.status === "activate_customer";
  const isQuoteUpdatedForMe = lead.status === "quote_updated" && (role === "cs_admin" || lead.quote_requested_by === user?.id);
  const isPendingQuoteForMaster = lead.status === "pending_to_send" && isQuotationMaster(role, profile?.is_quotation_master);
  const baseShouldBlink =
    needsScheduleBlink || isActivateCustomer || isQuoteUpdatedForMe || isPendingQuoteForMaster;

  // Suppress blink if schedule requirement date is more than 3 days in the future
  const isFarFutureSchedule = isScheduleRequirementFarFuture(lead.customer_schedule_requirements, 3);
  const shouldBlinkCard = baseShouldBlink && !isFarFutureSchedule;


  const secondaryDetailRows = [
    // A second number, marked so nobody tries to text it.
    {
      key: "landline",
      label: "Landline",
      value: lead.customer_landline ?? "",
      icon: Phone,
      wrap: false,
    },
    // CS Admins never see technician details.
    ...(canSeeTechDetails(role)
      ? [
        {
          key: "technician",
          label: "Technician",
          value: [lead.tech_name, lead.tech_number].filter(Boolean).join(" · "),
          icon: UserRound,
          wrap: true,
        },
        ]
      : []),
    {
      key: "source_url",
      label: "Source URL",
      value: lead.source_url,
      icon: ExternalLink,
      wrap: true,
    },
  ].filter((row): row is { key: string; label: string; value: string; icon: LucideIcon; wrap: boolean } => Boolean(row.value));

  // Service details live on the card surface. They can be long, so the preview is
  // clamped and only gets a toggle when the text actually overflows the clamp.
  const serviceDetails = lead.service_details?.trim() ?? "";
  const serviceDetailsLong = serviceDetails.length > 120 || serviceDetails.includes("\n");

  // Reload key can be kept in case we need it to force updates
  const [reloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (disablePhotoPreview) {
      setPhotoPaths([]);
      return;
    }

    if (initialPhotoPaths !== undefined) {
      setPhotoPaths(initialPhotoPaths);
      setPhotoCount(initialPhotoPaths.length);
      return;
    }

    const loadPhotos = async () => {
      const { data } = await supabase
        .from("lead_photos")
        .select("photo_url")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: true });

      if (!data || cancelled) return;

      const paths = data.map((photo: { photo_url: string }) => photo.photo_url);
      setPhotoCount(paths.length);

      if (!cancelled) {
        setPhotoPaths(paths);
      }
    };

    void loadPhotos();

    return () => {
      cancelled = true;
    };
  }, [disablePhotoPreview, initialPhotoPaths, lead.id, reloadKey]);

  const handleCopyPaymentScreenshot = async () => {
    if (!lead.payment_screenshot_url) return;
    toast.info("Copying payment screenshot...");
    try {
      const { getSignedUrl } = await import("@/lib/storage");
      const original = await getSignedUrl(lead.payment_screenshot_url);
      if (original) {
        const { copyImageToClipboard } = await import("@/lib/lead-copy");
        await copyImageToClipboard(original);
        toast.success("Payment screenshot copied to clipboard!");
      }
    } catch (err) {
      console.error("Failed to copy image:", err);
      toast.error("Failed to copy payment screenshot");
    }
  };

  const handleCopyPhoto = async (path: string, index: number) => {
    toast.info(`Copying photo ${index + 1}...`);
    try {
      const { getSignedUrl } = await import("@/lib/storage");
      const url = await getSignedUrl(path);
      if (url) {
        const { copyImageToClipboard } = await import("@/lib/lead-copy");
        await copyImageToClipboard(url);
        toast.success(`Photo ${index + 1} copied to clipboard!`);
      }
    } catch (err) {
      console.error("Failed to copy photo:", err);
      toast.error(`Failed to copy photo ${index + 1}`);
    }
  };

  const handleStatusChange = async (newStatus: string, cancellationReason?: string) => {
    if (isPaid) return;
    if (!canChangeStatus(role, newStatus as LeadStatus)) {
      toast.error("You do not have permission to set that status");
      return;
    }

    if (newStatus === "paid") {
      setPaymentOpen(true);
      return;
    }

    if (newStatus === "cancelled" && cancellationReason === undefined) {
      // Only open the dialog when not already coming from the dialog submit
      setCancelRequestOpen(true);
      return;
    }

    if (newStatus === "activate_customer" && (isAdmin || isProcessor)) {
      setActivateCustomerOpen(true);
      return;
    }

    // Card-level status changes must use the same conversation review as the
    // detail views. The review applies the status through its audited RPC.
    if (newStatus === "urgent_job" && showsUrgentCheck(role)) {
      setUrgentCheckOpen(true);
      return;
    }

    if (newStatus === "pending_to_send" && role === "customer_service") {
      if (!user) return;
      setChangingStatus(true);
      try {
        await requestQuoteApproval({ lead, requesterId: user.id });
        toast.success("Quote sent for approval");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to request quote approval");
      } finally {
        setChangingStatus(false);
      }
      return;
    }

    setChangingStatus(true);

    const statusUpdate: Record<string, unknown> = {
      status: newStatus as LeadStatus,
      last_edited_by: user?.id,
      last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
      updated_at: new Date().toISOString(),
      last_edited_at: new Date().toISOString(),
    };
    // Clear tag on any status change and unpin the lead
    statusUpdate.cs_tag = null;

    if (newStatus === "cancelled") {
      statusUpdate.cancellation_reason = cancellationReason || null;
    }

    const { error } = await supabase
      .from("leads")
      .update(statusUpdate as never)
      .eq("id", lead.id);

    setChangingStatus(false);

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    toast.success(`Status -> ${STATUS_LABELS[newStatus as LeadStatus]}`);

    await logActivity(user!.id, "status_changed", "lead", lead.id, {
      target_name: lead.job_id,
      customer_name: lead.customer_name,
      job_id: lead.job_id,
      status_from: lead.status,
      status_to: newStatus,
      changes: {
        status: {
          before: lead.status,
          after: newStatus,
        },
      },
    });

    onRefresh();
    
    // Job in Progress reminders stay owned by the detail views, same as before.
    if (newStatus === "urgent_job" || newStatus === "need_tech" || newStatus === "quote_updated") {
      await dispatchLeadStatusNotification({
        leadId: lead.id,
        leadName: lead.customer_name,
        status: newStatus,
        quoteRequestedBy: lead.quote_requested_by,
      });
    }

    onRefresh();
  };

 const handleCancellationRequestSubmit = async (comment: string, proof: string, proofImage: File | null, aiReasonCode?: string, aiReasonApplied?: boolean, aiSuggestedReason?: string) => {
    if (!user) return;

    setCancelRequestLoading(true);
    try {
      if (isAdmin) {
        // Admin cancels directly — no request tab needed
        let proofImagePath: string | null = null;
        if (proofImage) {
          const { optimizeImageForUpload } = await import("@/lib/image-upload");
          const optimized = await optimizeImageForUpload(proofImage);
          const ext = optimized.name.split(".").pop() || "jpg";
          proofImagePath = `cancellation-requests/${lead.id}_${Date.now()}.${ext}`;
          const { error: uploadError } = await supabase.storage.from("lead-photos").upload(proofImagePath, optimized);
          if (uploadError) throw uploadError;
        }
        const reason = [
          comment.trim() ? `Comment: ${comment.trim()}` : "",
          proof.trim() ? `Proof: ${proof.trim()}` : "",
          proofImagePath ? `Proof image: ${proofImagePath}` : "",
          aiReasonApplied ? `(AI Reason: ${aiReasonCode})` : "",
        ].filter(Boolean).join("\n");
        await handleStatusChange("cancelled", reason);
      } else {
        // CS / Processor — send to cancellation requests tab
        await createCancellationRequest({
          lead,
          userId: user.id,
          userName: profile?.full_name || user.email || "Unknown user",
          requesterRole: role,
          comment,
          proof,
          proofImage,
          aiReasonCode,
          aiReasonApplied,
          aiSuggestedReason,
        });
        toast.success("Cancellation request sent for approval");
        await refreshPendingCancellationRequest();
        onRefresh();
      }
      setCancelRequestOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel lead");
    } finally {
      setCancelRequestLoading(false);
    }
  };
  const handlePaymentConfirm = async (amount: number, screenshotFile: File | null, comment?: string) => {
    if (!user) return;
    setPaymentLoading(true);
    try {
      if (isProcessor) {
        // Processor -> send Paid approval request (Admin must approve)
        await createPaymentRequest({
          lead,
          userId: user.id,
          userName: profile?.full_name || user.email || "Unknown user",
          requesterRole: role,
          amount,
          comment,
          screenshotFile,
        });
        toast.success("Paid request sent for Admin approval");
        setPaymentOpen(false);
        onRefresh();
        return;
      }

      // Admin (or any other bypass) -> mark Paid directly
      let screenshotUrl: string | null = null;
      if (screenshotFile) {
        const optimizedScreenshot = await optimizeImageForUpload(screenshotFile);
        const ext = optimizedScreenshot.name.split(".").pop() || "jpg";
        const path = `payments/${lead.id}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("lead-photos").upload(path, optimizedScreenshot);
        // Never record the payment without the proof that was attached to it.
        // Swallowing this marked the lead Paid with no screenshot and still
        // reported success, so the proof was lost with nobody told. The
        // cancellation proof and the Processor payment request both throw here.
        if (uploadError) throw uploadError;
        screenshotUrl = path;
      }

      const { error } = await supabase
        .from("leads")
        .update({
          status: "paid" as LeadStatus,
          amount,
          payment_amount: amount,
          payment_screenshot_url: screenshotUrl,
          last_edited_by: user?.id,
          last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
          updated_at: new Date().toISOString(),
          last_edited_at: new Date().toISOString(),
        })
        .eq("id", lead.id);

      if (error) {
        toast.error("Failed to update status");
        return;
      }

      await logActivity(user.id, "payment_recorded", "lead", lead.id, {
        target_name: lead.job_id,
        customer_name: lead.customer_name,
        job_id: lead.job_id,
        amount,
        status_from: lead.status,
        status_to: "paid",
      });

      toast.success("Payment recorded & status updated to Paid");
      setPaymentOpen(false);
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // The delete itself is the only thing worth waiting on. The Google Sheets sync used to run
      // first, so the card sat there through a round trip to Google before anything happened.
      await adminApi.deleteLead(lead.id, lead.job_id);

      // Confirm and remove the card straight away rather than waiting for a refetch.
      toast.success("Lead deleted", {
        description: `"${lead.customer_name || lead.job_id}" was removed.`,
      });
      onDeleted?.(lead.id);
      onRefresh();

      void logActivity(user!.id, "deleted", "lead", lead.id, {
        target_name: lead.job_id,
        customer_name: lead.customer_name,
        job_id: lead.job_id,
        message: `${profiles[user!.id] || "Unknown"} deleted lead "${lead.customer_name}".`,
      }).catch((logErr) => {
        console.warn("Failed to log lead deletion:", logErr);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to delete lead: " + message);
    } finally {
      setDeleting(false);
    }
  };

  const openScheduleDialog = () => {
    setScheduleDraft(lead.customer_schedule_requirements || "");
    setScheduleOpen(true);
  };

  const saveScheduleRequirement = async () => {
    setSavingSchedule(true);
    const next = scheduleDraft.trim() ? scheduleDraft.trim() : null;
    const patch = {
      customer_schedule_requirements: next,
      last_edited_by: user?.id,
      last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
      updated_at: new Date().toISOString(),
      last_edited_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("leads").update(patch as never).eq("id", lead.id);
    setSavingSchedule(false);

    if (error) {
      toast.error("Failed to update schedule requirement");
      return;
    }

    toast.success(next ? "Schedule requirement updated" : "Schedule requirement cleared");
    setScheduleOpen(false);
    onRefresh();
  };

  const persistCsTag = async (
    newTag: CsTag | null,
    opts: { bookedAt?: string | null } = {},
  ) => {
    // Shared with the lead detail page, so a tag saves the same way from either place.
    const { ok } = await saveLeadTag({
      lead,
      newTag,
      editor: { id: user?.id, name: profile?.full_name || user?.email || "Unknown user" },
      options: opts,
    });
    if (ok) onRefresh();
    return ok;
  };

  const handleCsTagChange = async (value: string) => {
    if (isOpr) {
      toast.error("Operators cannot change lead tags");
      return;
    }
    const newTag = value === "__clear__" ? null : (value as CsTag);
    if (newTag && !assignableTags.includes(newTag)) {
      toast.error("You do not have permission to assign this tag");
      return;
    }

    // Booked tag requires a booking date/time before it's applied.
    if (newTag === "booked") {
      setBookingDialogMode("add");
      setBookingDialogOpen(true);
      return;
    }

    await persistCsTag(newTag);
  };

  const handleBookingConfirm = async (iso: string) => {
    if (isOpr) {
      toast.error("Operators cannot edit booking details");
      return;
    }
    if (bookingDialogMode === "edit") {
      // Editing an already-booked lead — keep tag, just update booked_at.
      const { error } = await supabase
        .from("leads")
        .update({
          booked_at: iso,
          last_edited_by: user?.id,
          last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
          updated_at: new Date().toISOString(),
          last_edited_at: new Date().toISOString(),
        } as never)
        .eq("id", lead.id);
      if (error) {
        toast.error("Failed to update booking time");
        return;
      }
      toast.success("Booking time updated");
      onRefresh();
      return;
    }
    await persistCsTag("booked", { bookedAt: iso });
  };



  const renderCollapsible = ({
    open,
    setOpen,
    pinned,
    setPinned,
    label,
    noteType,
    tone = "default",
    hasNotes = false,
    techCount = 0,
  }: {
    open: boolean;
    setOpen: (v: boolean) => void;
    pinned: boolean;
    setPinned: (v: boolean) => void;
    label: string;
    noteType: "general" | "cs" | "processor" | "opr";
    tone?: "default" | "cs" | "processor" | "opr";
    hasNotes?: boolean;
    techCount?: number;
  }) => (
    <NoteCollapsible
      open={open}
      setOpen={setOpen}
      pinned={pinned}
      setPinned={setPinned}
      label={label}
      noteType={noteType}
      tone={tone}
      hasNotes={hasNotes}
      techCount={techCount}
      reduceMotion={reduceMotion}
      leadId={lead.id}
      profiles={profiles}
      refreshCardMeta={refreshCardMeta}
    />
  );

  return (
    <motion.div
      className="h-full relative"
      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.006 }}
      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 200, damping: 24, mass: 0.6 }}
    >
      <Card
        className={`crm-lead-card group relative flex h-full flex-col overflow-hidden rounded-[30px] transition-shadow duration-500 hover:border-primary/28 hover:shadow-[0_42px_92px_-46px_rgba(59,130,246,0.34),0_20px_36px_-26px_rgba(125,211,252,0.2)] ${
          shouldBlinkCard 
            ? "ring-[3px] ring-emerald-500 border-emerald-500 bg-emerald-500/20 animate-pulse hover:animate-none"
            : isUrgent 
              ? "ring-1 ring-destructive/15 border-destructive/15" 
              : "border-border/60"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(194_100%_86%/0.18),transparent_32%),radial-gradient(circle_at_top_right,hsl(211_100%_88%/0.22),transparent_28%),radial-gradient(circle_at_bottom_left,hsl(188_100%_90%/0.14),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.26),transparent_42%)] opacity-100 dark:bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.14),transparent_28%),radial-gradient(circle_at_bottom_left,hsl(196_100%_72%/0.08),transparent_24%)]" />
        <div className="pointer-events-none absolute inset-x-6 top-0 h-16 rounded-b-[28px] bg-[linear-gradient(180deg,rgba(255,255,255,0.5),transparent)] blur-xl opacity-90 dark:hidden" />

        {isUrgent && (
          <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-destructive via-destructive/70 to-transparent" />
        )}

        <div className="relative px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3 border-b border-border/55 pb-3">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="truncate text-lg font-semibold text-foreground">
                    {lead.customer_name}
                  </p>
                  {lead.source_url && (
                    <a
                      href={lead.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source chat on Quo.com"
                      className="inline-flex items-center justify-center rounded-[8px] bg-[#EEFF41] hover:bg-[#F4FF40] text-[#1A237E] font-extrabold text-[9px] px-1.5 py-0.5 tracking-wider transition-all duration-300 border border-[#D4E157] shadow-sm select-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      QUO
                    </a>
                  )}
                </div>

                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <p className="font-mono text-[10px] text-muted-foreground/70">{lead.job_id}</p>
                  {lead.number_name && (
                    <span className="inline-flex max-w-[160px] items-center gap-1 truncate rounded-full border border-primary/15 bg-primary/[0.07] px-2 py-0.5 text-[10px] font-semibold text-white">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span className="truncate">{lead.number_name}</span>
                    </span>
                  )}
                  {lead.created_at && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                      <CalendarDays className="h-3 w-3" />
                      {formatDate(lead.created_at)}
                    </span>
                  )}
                  {isActivateCustomer && (
                    <span
                      title="Customer is ready for activation"
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                    >
                      📌 Activate Customer
                    </span>
                  )}
                  {lead.cs_tag === "booked" && lead.booked_at && (
                    isOpr ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                          isBookingExpired(lead.booked_at)
                            ? "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300 animate-pulse"
                            : "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        }`}
                      >
                        <CalendarDays className="h-3 w-3" />
                        {formatBookingCompact(lead.booked_at)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBookingDialogMode("edit");
                          setBookingDialogOpen(true);
                        }}
                        title={isBookingExpired(lead.booked_at) ? "Booking overdue — click to reschedule" : "Edit booking date/time"}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                          isBookingExpired(lead.booked_at)
                            ? "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300 animate-pulse"
                            : "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        }`}
                      >
                        <CalendarDays className="h-3 w-3" />
                        {formatBookingCompact(lead.booked_at)}
                      </button>
                    )
                  )}
                  {(() => {
                    const sched = formatScheduleRequirementCompact(lead.customer_schedule_requirements);
                    const chipClass =
                      "inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300";

                    if (!sched) {
                      if (isOpr) return null;
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openScheduleDialog();
                          }}
                          title="Add schedule requirement"
                          className={`${chipClass} border-dashed opacity-80 transition-opacity hover:opacity-100`}
                        >
                          <CalendarClock className="h-3 w-3" />
                          <span>Add schedule</span>
                        </button>
                      );
                    }

                    if (isOpr) {
                      return (
                        <span title={`Schedule Requirement: ${sched.full}`} className={chipClass}>
                          <CalendarClock className="h-3 w-3" />
                          <span className="opacity-80">Schedule Requirement:</span>
                          <span>{sched.summary}</span>
                        </span>
                      );
                    }

                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openScheduleDialog();
                        }}
                        title={`Schedule Requirement: ${sched.full} - click to edit`}
                        className={`${chipClass} transition-colors hover:bg-sky-500/20`}
                      >
                        <CalendarClock className="h-3 w-3" />
                        <span className="opacity-80">Schedule Requirement:</span>
                        <span>{sched.summary}</span>
                      </button>
                    );
                  })()}
                </div>
            </div>


            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <CancelledStatusBadge
                leadId={lead.id}
                status={lead.status}
                size="sm"
                paidInfo={isOpr ? null : paidAmountInfo}
              />
              {hasQuickChatAccess && lead.customer_phone && (
                <QuoPhoneTrigger
                  contactName={lead.customer_name}
                  phone={lead.customer_phone}
                  chatType="customer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-all no-underline shadow-sm"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>CX Quick Chat</span>
                </QuoPhoneTrigger>
              )}
              <LeadCoverageBadge
                level={lead.coverage_level}
                count={lead.coverage_tech_count}
                areaLabel={lead.coverage_area_label}
                className="max-w-full"
              />
              {hasTechQuickChatAccess && lead.tech_number && (
                <QuoPhoneTrigger
                  contactName={lead.tech_name || "Technician"}
                  phone={lead.tech_number}
                  chatType="tech"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/22 transition-all no-underline shadow-sm"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>Tech Quick Chat</span>
                </QuoPhoneTrigger>
              )}
              {quoNeedsAttention && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300 animate-pulse"
                  title="Customer messaged again on Quo after this lead was resolved/cancelled"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  Needs attention
                </span>
              )}
            </div>
          </div>

          {isUrgent && nearbyUrgentLeads && nearbyUrgentLeads.length > 0 && (
            <NearbyUrgentLeads nearby={nearbyUrgentLeads} />
          )}

          {lead.status === "cancelled" && initialCancellationReason && (
            <div className="mt-2 flex items-start gap-1.5 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-2.5 py-1.5">
              <Ban className="mt-[1px] h-3 w-3 shrink-0 text-rose-600 dark:text-rose-400" />
              <p className="line-clamp-2 text-[11px] leading-4 text-rose-900/90 dark:text-rose-200/90">
                <span className="font-semibold">Reason: </span>
                {initialCancellationReason}
              </p>
            </div>
          )}

          <div className="divide-y divide-border/50">
            {lead.customer_phone && (
              <div className="flex items-start gap-3 py-3 text-[13px] text-foreground/90">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <p className="min-w-0 flex-1 truncate font-medium">{lead.customer_phone}</p>
                <CopyValueButton value={lead.customer_phone} label="Phone number" className="h-7 w-7 shrink-0 rounded-lg" />
              </div>
            )}

            {lead.service_type && (
              <div className="flex items-start gap-3 py-3 text-[13px] text-foreground/90">
                <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <p className="min-w-0 flex-1 break-words leading-5">{lead.service_type}</p>
                <CopyValueButton value={lead.service_type} label="Service" className="h-7 w-7 shrink-0 rounded-lg" />
              </div>
            )}

            {serviceDetails && (
              <div className="flex items-start gap-3 py-3 text-[13px] text-foreground/90">
                <Clipboard className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <div className="min-w-0 flex-1">
                  <p className={`whitespace-pre-wrap break-words leading-5 ${serviceDetailsExpanded ? "" : "line-clamp-2"}`}>
                    {serviceDetails}
                  </p>
                  {serviceDetailsLong && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setServiceDetailsExpanded((value) => !value);
                      }}
                      className="mt-0 h-auto p-0 text-[11px] font-semibold"
                    >
                      {serviceDetailsExpanded ? "Show less" : "Show more"}
                    </Button>
                  )}
                </div>
                <CopyValueButton value={serviceDetails} label="Service Details" className="h-7 w-7 shrink-0 rounded-lg" />
              </div>
            )}

            {lead.address && (
              <div className="flex items-start gap-3 py-3 text-[13px] text-foreground/90">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <p className="min-w-0 flex-1 break-words leading-5">{expandStateAbbreviation(lead.address)}</p>
                <CopyValueButton value={expandStateAbbreviation(lead.address)} label="Address" className="h-7 w-7 shrink-0 rounded-lg" />
              </div>
            )}

            {secondaryDetailRows.map(({ key, label, value, icon: Icon, wrap }) => (
              <div
                key={key}
                className="flex items-start gap-3 py-3 text-[13px] text-foreground/90"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <div className="min-w-0 flex-1">
                  {key === "landline" ? (
                    <span className="truncate text-[13px] font-medium leading-5">{value}</span>
                  ) : key === "technician" && lead.tech_number ? (
                    <div className={`text-[13px] leading-5 text-foreground/90 ${wrap ? "break-words" : "truncate"}`}>
                      {lead.tech_name ? <span>{lead.tech_name} {" · "}</span> : null}
                      <span>{lead.tech_number}</span>
                    </div>
                  ) : key === "source_url" ? (
                    <a
                      href={value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] leading-5 text-primary hover:underline inline-flex items-center gap-1 font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>Quo Chat Thread</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className={`text-[13px] leading-5 text-foreground/90 ${wrap ? "break-words" : "truncate"}`}>{value}</p>
                  )}
                </div>
                <CopyValueButton value={value} label={label} className="h-7 w-7 shrink-0 rounded-lg" />
              </div>
            ))}
          </div>
        </div>

        {(lead.payment_screenshot_url || photoPaths.length > 0) && (
          <div className="relative flex flex-wrap gap-2 border-t border-border/55 px-4 py-3">
                {lead.payment_screenshot_url && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      void handleCopyPaymentScreenshot();
                    }}
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Payment
                  </Button>
                )}

                <LeadPhotoActions paths={photoPaths} techNumber={lead.tech_number} />
                {photoPaths.map((path, index) => (
                  <Button
                    key={path}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      void handleCopyPhoto(path, index);
                    }}
                    title={`Copy photo ${index + 1}`}
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Photo {index + 1}
                  </Button>
                ))}
          </div>
        )}

        {(isCS || isCsAdmin || isProcessor || isAdmin || isOpr) && lead.status !== "scheduled" && (
          <div className="px-4 pt-2">
            <Select
              value={currentTag ?? "__clear__"}
              onValueChange={handleCsTagChange}
              disabled={isOpr}
            >
              <SelectTrigger className={`crm-lead-card-inner h-11 w-full rounded-[14px] text-[12px] font-medium ${isOpr ? "cursor-default opacity-85" : ""}`}>
                <SelectValue placeholder="Lead tag (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__" className="text-[12px] text-muted-foreground">
                  No tag
                </SelectItem>
                {currentTag && !assignableTags.includes(currentTag) && (
                  <SelectItem value={currentTag} disabled className="text-[12px]">
                    {CS_TAG_LABELS[currentTag] ?? currentTag} (view only)
                  </SelectItem>
                )}
                {assignableTags.map((tag) => (
                  <SelectItem key={tag} value={tag} className="text-[12px]">
                    {CS_TAG_LABELS[tag]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Coverage sits with the tag rather than inside the tag dropdown,
                because it is derived and never assignable, and it must survive a
                status change that clears the workflow tag. */}
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              {currentTag && (
                <>
                  <p
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      currentTag === "booked"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200"
                        : currentTag === "ready_to_schedule"
                          ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-400/20 dark:text-indigo-200"
                          : currentTag === "incomplete_details"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-400/20 dark:text-rose-200"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200"
                    }`}
                  >
                    📌 {CS_TAG_LABELS[currentTag] ?? currentTag}
                  </p>
                </>
              )}
            </div>
            {currentTag && (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                {currentTag === "booked" && lead.booked_at && (
                  isOpr ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        isBookingExpired(lead.booked_at)
                          ? "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300 animate-pulse"
                          : "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      }`}
                    >
                      <CalendarDays className="h-3 w-3" />
                      {formatBookingCompact(lead.booked_at)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBookingDialogMode("edit");
                        setBookingDialogOpen(true);
                      }}
                      title={isBookingExpired(lead.booked_at) ? "Booking overdue — click to reschedule" : "Edit booking date/time"}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        isBookingExpired(lead.booked_at)
                          ? "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300 animate-pulse"
                          : "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      }`}
                    >
                      <CalendarDays className="h-3 w-3" />
                      {formatBookingCompact(lead.booked_at)}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-1.5 px-4 pt-3">
          {renderCollapsible({
            open: generalOpen,
            setOpen: setGeneralOpen,
            pinned: generalPinned,
            setPinned: setGeneralPinned,
            label: "Notes",
            noteType: "general",
            tone: "default",
            hasNotes: hasNotes.general,
          })}

          {(isCS || isCsAdmin || isProcessor || isAdmin || isOpr) &&
            renderCollapsible({
              open: csOpen,
              setOpen: setCsOpen,
              pinned: csPinned,
              setPinned: setCsPinned,
              label: "CS Notes",
              noteType: "cs",
              tone: "cs",
              hasNotes: hasNotes.cs,
            })}

          {(isProcessor || isAdmin) &&
            renderCollapsible({
              open: processorOpen,
              setOpen: setProcessorOpen,
              pinned: processorPinned,
              setPinned: setProcessorPinned,
              label: "Processor Notes",
              noteType: "processor",
              tone: "processor",
              hasNotes: hasNotes.processor,
              techCount,
            })}
          {(isProcessor || isAdmin || isOpr) &&
            renderCollapsible({
              open: oprOpen,
              setOpen: setOprOpen,
              pinned: oprPinned,
              setPinned: setOprPinned,
              label: "OPR Notes",
              noteType: "opr",
              tone: "opr",
              hasNotes: hasNotes.opr,
            })}

        </div>

        <div className="mt-3 px-4">
          <div className="crm-lead-card-inner space-y-1 rounded-[18px] px-3.5 py-2.5 shadow-[0_16px_24px_-22px_rgba(59,130,246,0.14)] dark:shadow-none">
            {(lead.last_edited_by || lead.last_edited_by_name) && (
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-warning/80" />
                <p className="text-[11px] text-muted-foreground/90">
                  Last edited <span className="font-medium text-foreground">{formatDateTime(lead.updated_at)}</span> by{" "}
                  <span className="font-semibold text-foreground">{(lead.last_edited_by ? profiles[lead.last_edited_by] : null) || lead.last_edited_by_name || "Unknown"}</span>
                </p>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/80">
              Created by <span className="font-semibold text-foreground">{(lead.created_by ? profiles[lead.created_by] : null) || lead.created_by_name || "Deleted user"}</span>{" "}
              · {formatDate(lead.created_at)}
            </p>
          </div>
        </div>

        <div className="mt-auto border-t border-white/30 px-4 pb-4 pt-4 dark:border-white/5">
          <div className="crm-lead-card-footer rounded-[24px] p-2.5 shadow-[0_24px_40px_-28px_rgba(59,130,246,0.18)] dark:shadow-none">
            {pendingQuoteApproval && !quoteApproval && (
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>Pending CS Admin approval</span>
              </div>
            )}

            {quoteApproval && (
              <div className="mb-2.5 space-y-2 rounded-[18px] border border-violet-500/25 bg-violet-500/[0.07] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-500">
                    Quote approval requested
                  </p>
                  {quoteApproval.requestedAt && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatDateTime(quoteApproval.requestedAt)}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  By {quoteApproval.requestedByName || "Customer Service"}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" className="h-9 gap-1.5 px-2 text-[11px]" disabled={quoteApproval.busy}>
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Forward to Quotation Master</span>
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Forward this quote to the Quotation Master?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {lead.customer_name || "This lead"} will move to Quotes to Send for the quotation team.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Go back</AlertDialogCancel>
                        <AlertDialogAction onClick={quoteApproval.onApprove}>
                          Forward to Quotation Master
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="h-9 gap-1.5 px-2 text-[11px]" disabled={quoteApproval.busy}>
                        <XCircle className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Decline request</span>
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Decline this quote request?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The request will close and the lead will stay at its current status.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Go back</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={quoteApproval.onDecline}
                        >
                          Decline request
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}
            <div className="mb-2.5 flex items-center gap-2">
              <Select value={lead.status} onValueChange={handleStatusChange} disabled={changingStatus || isPaid || isOpr}>
                <SelectTrigger
                  className={`crm-lead-card-inner h-10 flex-1 rounded-[16px] text-[12px] font-medium shadow-[0_18px_28px_-24px_rgba(59,130,246,0.16)] ${
                    isPaid || isOpr ? "cursor-not-allowed opacity-60" : ""
                  }`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getChangeableStatuses(role).map((s) => (
                    <SelectItem key={s} value={s} className="text-[12px]">
                      {STATUS_LABELS[s as LeadStatus]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                className="h-10 shrink-0 gap-1.5 px-3 rounded-[16px] crm-lead-card-inner shadow-[0_18px_28px_-24px_rgba(59,130,246,0.16)] hover:bg-muted/50"
                onClick={() => setStatusHistoryOpen(true)}
              >
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium text-muted-foreground">History</span>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <CxUpdateRequestButton leadId={lead.id} customerName={lead.customer_name} />
              {!isOpr && (
                <Button
                  variant="outline"
                  size="sm"
                  className="crm-lead-card-inner h-11 min-w-[100px] flex-1 overflow-hidden rounded-[14px] px-2 text-[11px] font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/28 hover:bg-primary/[0.05] hover:shadow-[0_18px_28px_-20px_rgba(59,130,246,0.2)] dark:hover:bg-primary/[0.10] dark:hover:shadow-none"
                  onClick={(event) => openLeadFromClick(event, lead.id, navigate)}
                >
                  <Pencil className="h-3 w-3 shrink-0" />
                  <span className="truncate">Edit Lead</span>
                </Button>
              )}

              <CompleteLeadCopyButton
                lead={lead}
                className="crm-lead-card-inner h-11 shrink-0 whitespace-nowrap rounded-[14px] px-3 text-[11px] font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/28 hover:bg-primary/[0.05] hover:shadow-[0_18px_28px_-20px_rgba(59,130,246,0.2)] dark:hover:bg-primary/[0.10] dark:hover:shadow-none"
              />

              {(isAdmin || isProcessor) && (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {isAdmin && (
                    <LeadShareDialog
                      leadId={lead.id}
                      customerName={lead.customer_name}
                      className="crm-lead-card-inner h-11 w-9 rounded-[14px] border-border/60 bg-transparent text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/28 hover:bg-primary/[0.05] hover:shadow-[0_18px_28px_-20px_rgba(59,130,246,0.2)] dark:hover:bg-primary/[0.10] dark:hover:shadow-none"
                    />
                  )}

                  <Button
                    variant="outline"
                    size="icon"
                    className="crm-lead-card-inner h-11 w-9 rounded-[14px] text-emerald-600 dark:text-emerald-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/30 hover:bg-emerald-500/[0.06] hover:shadow-[0_18px_26px_-20px_rgba(16,185,129,0.22)] dark:hover:shadow-none"
                    onClick={() => setAssignOprOpen(true)}
                    title="Assign to Operator"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>

                  {isAdmin && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Delete lead"
                          className="crm-lead-card-inner h-11 w-9 rounded-[14px] text-destructive/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-destructive/30 hover:bg-destructive/[0.06] hover:text-destructive hover:shadow-[0_18px_26px_-20px_rgba(239,68,68,0.22)] dark:hover:shadow-none"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>

                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete lead?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete "{lead.customer_name}". This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDelete}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground"
                          >
                            {deleting ? "Deleting..." : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          onConfirm={handlePaymentConfirm}
          loading={paymentLoading}
          mode={isProcessor ? "request" : "direct"}
        />

        <CancellationRequestSheet
          open={cancelRequestOpen}
          onOpenChange={setCancelRequestOpen}
          onSubmit={handleCancellationRequestSubmit}
          loading={cancelRequestLoading}
          mode={isAdmin ? "direct" : "request"}
          requesterLabel={isProcessor ? "Admin" : "Processor or Admin"}
          leadId={lead.id}
        />

        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogContent className="sm:max-w-[460px]" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle className="text-base">Customer Schedule Requirement</DialogTitle>
              <DialogDescription className="text-xs">
                {lead.customer_name} - add or remove the dates the customer is available.
              </DialogDescription>
            </DialogHeader>

            <MultiDateTimePicker value={scheduleDraft} onChange={setScheduleDraft} />

            <DialogFooter>
              <Button variant="outline" onClick={() => setScheduleOpen(false)} disabled={savingSchedule}>
                Cancel
              </Button>
              <Button onClick={saveScheduleRequirement} disabled={savingSchedule}>
                {savingSchedule ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <BookingDateTimeDialog
          open={bookingDialogOpen}
          onOpenChange={setBookingDialogOpen}
          initialValue={bookingDialogMode === "edit" ? lead.booked_at : null}
          onConfirm={handleBookingConfirm}
          title={bookingDialogMode === "edit" ? "Edit Booking Date & Time" : "Set Booking Date & Time"}
        />

        <AssignLeadToOperatorDialog
          open={assignOprOpen}
          onOpenChange={setAssignOprOpen}
          lead={lead}
          onSuccess={onRefresh}
        />

        <LeadStatusHistoryDialog
          open={statusHistoryOpen}
          onOpenChange={setStatusHistoryOpen}
          leadId={lead.id}
          currentStatus={lead.status}
        />

        <UrgentAICheckDialog
          open={urgentCheckOpen}
          onOpenChange={setUrgentCheckOpen}
          leadId={lead.id}
          onProceed={onRefresh}
        />

        <ActivateCustomerNoteDialog
          open={activateCustomerOpen}
          onOpenChange={setActivateCustomerOpen}
          leadId={lead.id}
          customerName={lead.customer_name}
          jobId={lead.job_id}
          currentStatus={lead.status}
          onSuccess={() => {
            onRefresh?.();
            void refreshNotePresence();
          }}
        />

      </Card>
    </motion.div>
  );
}

export default memo(LeadCard);
