import markUrl from "@/assets/brand/marshmallow-mark.svg";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  /** Accessible name; pass "" when nearby text already says "Marshmallow". */
  title?: string;
}

/**
 * Marshmallow CRM mark. The SVG is bundled with the app (Vite inlines it), so the logo
 * never depends on a hosting-specific asset path. The generated favicons and app icons
 * in public/ come from the same file (npm run brand:icons).
 */
export function MarshmallowMark({ className, title = "Marshmallow" }: Props) {
  const decorative = title === "";
  return (
    <img
      src={markUrl}
      alt={title}
      aria-hidden={decorative || undefined}
      draggable={false}
      className={cn("block h-full w-full select-none", className)}
    />
  );
}
