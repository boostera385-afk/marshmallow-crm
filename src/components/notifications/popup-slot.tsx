import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * The full-screen notification popups all render centred at the same z-index, so when a user was
 * eligible for two at once (Urgent Job + Job in Progress for admins and processors, Urgent Job +
 * Quote Updated for CS Admins) they landed on top of each other and the covered card's buttons
 * could not be clicked.
 *
 * Each popup claims a slot instead. Only the highest-priority claim renders; the rest wait their
 * turn and appear as soon as it is dismissed. Lower number wins.
 */

export const POPUP_PRIORITY = {
  crmUpdate: 1,
  holdJob: 5,
  urgent: 10,
  jobInProgress: 20,
  incompleteDetails: 25,
  quoteUpdated: 30,
} as const;

export type PopupId = keyof typeof POPUP_PRIORITY;

interface PopupSlotContextValue {
  claim: (id: PopupId) => void;
  release: (id: PopupId) => void;
  activeId: PopupId | null;
}

const PopupSlotContext = createContext<PopupSlotContextValue | null>(null);

export function NotificationPopupProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<PopupId[]>([]);

  const claim = useCallback((id: PopupId) => {
    setClaims((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const release = useCallback((id: PopupId) => {
    setClaims((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : prev));
  }, []);

  const activeId = useMemo(() => {
    if (claims.length === 0) return null;
    return [...claims].sort((a, b) => POPUP_PRIORITY[a] - POPUP_PRIORITY[b])[0];
  }, [claims]);

  const value = useMemo(() => ({ claim, release, activeId }), [claim, release, activeId]);

  return <PopupSlotContext.Provider value={value}>{children}</PopupSlotContext.Provider>;
}

/**
 * Returns whether this popup is the one allowed to render right now. `wantsToShow` is the
 * popup's own "I have something to display" condition.
 *
 * Without a provider every popup renders, which is the old behaviour — so the popups still work
 * if they are ever mounted outside the layout.
 */
export function useNotificationPopupSlot(id: PopupId, wantsToShow: boolean): boolean {
  const context = useContext(PopupSlotContext);

  useEffect(() => {
    if (!context) return;
    if (wantsToShow) {
      context.claim(id);
      return () => context.release(id);
    }
    context.release(id);
  }, [context, id, wantsToShow]);

  if (!context) return wantsToShow;
  return wantsToShow && context.activeId === id;
}
