import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

/**
 * Open a Radix popover / dropdown when the mouse rests on its trigger, and close it when the
 * mouse leaves both the trigger and the popup. Touch and keyboard keep the normal click / Enter.
 * A popup opened by a click is "pinned": leaving with the mouse does not close it.
 *
 * Spread `hoverProps` on the trigger and the content, `triggerProps` on the trigger, and use
 * `open` / `onOpenChange` on the root. Dropdown menus need `modal={false}` so the page keeps
 * receiving pointer events while the menu is open.
 */
export function useHoverOpen({ openDelay = 150, closeDelay = 200 } = {}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const hoverOpened = useRef(false);
  /** How the popup was last opened; kept through closing for the close-focus decision. */
  const lastOpenByHover = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const onOpenChange = useCallback((next: boolean) => {
    clear();
    pinned.current = next && !hoverOpened.current;
    if (next) lastOpenByHover.current = hoverOpened.current;
    if (!next) hoverOpened.current = false;
    setOpen(next);
  }, []);

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === "touch") return; // touch has no hover; a tap opens it
    clear();
    if (open) return;
    timer.current = setTimeout(() => {
      hoverOpened.current = true;
      lastOpenByHover.current = true;
      pinned.current = false;
      setOpen(true);
    }, openDelay);
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === "touch") return; // touch has no hover; a tap opens it
    clear();
    if (pinned.current) return;
    timer.current = setTimeout(() => {
      hoverOpened.current = false;
      setOpen(false);
    }, closeDelay);
  };

  /** A click on a hover-opened trigger pins it open instead of toggling it shut. */
  const keepOpen = (event: MouseEvent | PointerEvent) => {
    if (open && hoverOpened.current) {
      event.preventDefault();
      pinned.current = true;
    }
  };

  return {
    open,
    onOpenChange,
    hoverProps: { onPointerEnter, onPointerLeave },
    triggerProps: { onPointerDown: keepOpen, onClick: keepOpen },
    /** True when the popup was opened by hover (skip moving focus into or out of it). */
    isHoverOpen: () => lastOpenByHover.current,
  };
}
