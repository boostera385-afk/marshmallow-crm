interface Props {
  className?: string;
  /** Accessible name; pass "" when nearby text already names the company. */
  title?: string;
}

/**
 * Pastry Marketing wordmark (vector, from the brand sample): a layered cake slice with a
 * cherry, then "PASTRY" with a lime triangle as the "A". The letters inherit the text
 * colour and the navy layer lightens in dark mode, so it reads on both themes.
 * Letter widths are fixed with textLength, so a fallback font cannot shift the layout.
 */
export function PastryLogo({ className = "h-6 w-auto", title = "Pastry Marketing" }: Props) {
  const decorative = title === "";
  return (
    <svg
      viewBox="0 0 176 46"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`text-[#1b1b5e] dark:text-white ${className}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      focusable="false"
    >
      {!decorative && <title>{title}</title>}
      {/* Cherry */}
      <path d="M15.5 6.5c0-2.2 1.2-4.2 3.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14.5" cy="9" r="3.6" fill="#e0245e" />
      {/* Cake layers */}
      <path d="M2 17 L24 13 L24 20 L2 24 Z" fill="#ec4899" />
      <path d="M2 26 L24 22 L24 29 L2 33 Z" fill="#c5d92d" />
      <path d="M2 35 L24 31 L24 38 L2 42 Z" className="fill-[#1b1b5e] dark:fill-[#8b8bd8]" />
      {/* PASTRY, with the triangle as the A */}
      <g fill="currentColor" fontFamily="Montserrat, 'Arial Black', 'Segoe UI', Arial, sans-serif" fontWeight="900" fontSize="34">
        <text x="31" y="39" textLength="22" lengthAdjust="spacingAndGlyphs">P</text>
        <text x="84" y="39" textLength="90" lengthAdjust="spacingAndGlyphs">STRY</text>
      </g>
      <path d="M68 12.5 L81 39 L55 39 Z" fill="#c5d92d" />
    </svg>
  );
}
