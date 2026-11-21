import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatUSPhoneInput, phoneOverflowError, stripPhone, validateUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

type PhoneInputProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "maxLength" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** An error from the parent (e.g. a failed submit). Shown instead of the built-in check. */
  error?: string | null;
};

/** Caret index in `formatted` that sits right after its `digitCount`-th digit. */
function caretAfterDigits(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return formatted.startsWith("(") ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen++;
      if (seen === digitCount) return i + 1;
    }
  }
  return formatted.length;
}

/**
 * US phone field: formats typed and pasted numbers to (XXX) XXX-XXXX, keeps the
 * caret in place for mid-field edits, refuses input past 10 digits with a message,
 * and reports an incomplete/invalid number after the user leaves the field. No
 * maxLength: the browser would truncate a paste such as "+1 305 555 0123"
 * before its country code could be removed.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onValueChange, error, onBlur, className, id, readOnly, disabled, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    const pendingCaret = React.useRef<number | null>(null);
    const [touched, setTouched] = React.useState(false);
    const [overflow, setOverflow] = React.useState<string | null>(null);
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;

    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    React.useLayoutEffect(() => {
      const el = innerRef.current;
      const caret = pendingCaret.current;
      pendingCaret.current = null;
      if (el && caret !== null && document.activeElement === el) el.setSelectionRange(caret, caret);
    }, [value]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const tooLong = phoneOverflowError(raw);
      if (tooLong) {
        // Refuse the keystroke/paste: the field keeps its last valid value.
        setOverflow(tooLong);
        return;
      }
      setOverflow(null);
      const formatted = formatUSPhoneInput(raw);
      const selection = event.target.selectionStart ?? raw.length;
      if (selection < raw.length) {
        // Mid-field edit: keep the caret after the same digit it followed.
        const dropped = stripPhone(raw).length - stripPhone(formatted).length;
        const digitsBefore = stripPhone(raw.slice(0, selection)).length - dropped;
        pendingCaret.current = caretAfterDigits(formatted, digitsBefore);
      }
      onValueChange(formatted);
    };

    const locked = readOnly || disabled;
    const message = error ?? overflow ?? (touched && !locked ? validateUSPhone(value) : null);

    return (
      <>
        <Input
          {...props}
          ref={innerRef}
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete={props.autoComplete ?? "tel"}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          onChange={handleChange}
          onBlur={(event) => {
            setTouched(true);
            setOverflow(null);
            onBlur?.(event);
          }}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : props["aria-describedby"]}
          className={cn(className, message && "border-destructive ring-1 ring-destructive/40")}
        />
        {message && (
          <p id={errorId} role="alert" className="text-[11px] text-destructive">
            {message}
          </p>
        )}
      </>
    );
  },
);
PhoneInput.displayName = "PhoneInput";
