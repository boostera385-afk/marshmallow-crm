import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  services: string[];
  states: { code: string; name: string }[];
  service: string;
  state: string;
  onServiceChange: (value: string) => void;
  onStateChange: (value: string) => void;
  onMenuOpen?: () => void;
}

export default function MapFilterControls({ services, states, service, state, onServiceChange, onStateChange, onMenuOpen }: Props) {
  const [openMenu, setOpenMenu] = useState<"service" | "state" | null>(null);
  const changeOpen = (menu: "service" | "state", open: boolean) => {
    setOpenMenu(open ? menu : null);
    if (open) onMenuOpen?.();
  };
  const triggerClass = "h-10 min-w-0 w-full gap-2 px-3 text-sm sm:h-8 sm:text-xs [&>span]:block [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0";
  const contentClass = "max-h-[min(24rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-0 max-w-[calc(100vw-1rem)]";
  return (
    <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:w-auto sm:grid-cols-[180px_150px]" role="group" aria-label="Map filters">
      <Select value={service} onValueChange={onServiceChange} open={openMenu === "service"} onOpenChange={(open) => changeOpen("service", open)}>
        <SelectTrigger className={triggerClass} aria-label="Filter map by service"><SelectValue placeholder="All services" /></SelectTrigger>
        <SelectContent className={contentClass} position="popper" align="start" collisionPadding={8} avoidCollisions>
          <SelectItem value="all">All services</SelectItem>
          {services.map((name) => <SelectItem key={name} value={name} className="break-words">{name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={state} onValueChange={onStateChange} open={openMenu === "state"} onOpenChange={(open) => changeOpen("state", open)}>
        <SelectTrigger className={triggerClass} aria-label="Filter map by state"><SelectValue placeholder="All states" /></SelectTrigger>
        <SelectContent className={contentClass} position="popper" align="start" collisionPadding={8} avoidCollisions>
          <SelectItem value="all">All states</SelectItem>
          {states.map(({ code, name }) => <SelectItem key={code} value={code}>{code} · {name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
