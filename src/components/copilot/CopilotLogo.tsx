import { useId } from "react";
import { cn } from "@/lib/utils";

/** Original lightweight vector inspired by the supplied mascot. No remote assets. */
export default function CopilotLogo({ className, monochrome = false }: { className?: string; monochrome?: boolean }) {
  const id = useId().replace(/:/g, "");
  return <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" focusable="false" className={cn("shrink-0", className)}>
    <defs>
      <linearGradient id={`${id}-shell`} x1="16" y1="26" x2="64" y2="72" gradientUnits="userSpaceOnUse"><stop stopColor="white"/><stop offset="1" stopColor="#ddd9ff"/></linearGradient>
      <linearGradient id={`${id}-brand`} x1="12" y1="20" x2="64" y2="60" gradientUnits="userSpaceOnUse"><stop stopColor="#22d3ee"/><stop offset=".5" stopColor="#4f7cff"/><stop offset="1" stopColor="#a78bfa"/></linearGradient>
    </defs>
    <path d="M40 23c0-9 4-12 9-15" stroke={monochrome ? "currentColor" : "#6261ce"} strokeWidth="4" strokeLinecap="round"/>
    <circle cx="51" cy="8" r="5" fill={monochrome ? "currentColor" : `url(#${id}-brand)`}/>
    <path d="m69 17 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" fill={monochrome ? "currentColor" : "#a78bfa"}/>
    <rect x="6" y="37" width="10" height="22" rx="5" fill={monochrome ? "currentColor" : `url(#${id}-brand)`}/>
    <rect x="64" y="37" width="10" height="22" rx="5" fill={monochrome ? "currentColor" : `url(#${id}-brand)`}/>
    <rect x="13" y="23" width="54" height="47" rx="18" fill={monochrome ? "none" : `url(#${id}-shell)`} stroke={monochrome ? "currentColor" : "#c4baff"} strokeWidth="2.5"/>
    <rect x="20" y="31" width="40" height="31" rx="12" fill={monochrome ? "currentColor" : "#161c45"}/>
    <path d="M27 45c0-7 9-7 9 0m8 0c0-7 9-7 9 0" stroke={monochrome ? "hsl(var(--background))" : "#67e8f9"} strokeWidth="3.5" strokeLinecap="round"/>
    <path d="M36 52c2 3 6 3 8 0" stroke={monochrome ? "hsl(var(--background))" : "#b8f5ff"} strokeWidth="3" strokeLinecap="round"/>
    {!monochrome && <><ellipse cx="27" cy="52" rx="3" ry="2" fill="#c084fc"/><ellipse cx="53" cy="52" rx="3" ry="2" fill="#c084fc"/></>}
  </svg>;
}
