import { PastryLogo } from "@/components/brand/PastryLogo";

/** Company that owns Marshmallow; shown in the copyright notice. */
export const COPYRIGHT_OWNER = "Pastry Marketing";

interface Props {
  className?: string;
  /** Defaults to the current year so the notice never goes stale. */
  year?: number;
}

/**
 * Copyright notice for the sign-in screens: "© <year> Pastry Marketing. All rights reserved."
 * Muted and small so it never competes with the form, but always readable.
 */
export function LegalFooter({ className = "", year = new Date().getFullYear() }: Props) {
  return (
    <footer className={`flex flex-col items-center gap-1.5 text-center text-[11px] leading-relaxed text-muted-foreground/70 ${className}`}>
      {/* The text below names the company, so the logo is decorative for screen readers. */}
      <PastryLogo title="" className="h-5 w-auto opacity-90" />
      <p>
        © {year} <span className="font-semibold text-muted-foreground">{COPYRIGHT_OWNER}</span>. All rights reserved.
      </p>
    </footer>
  );
}
