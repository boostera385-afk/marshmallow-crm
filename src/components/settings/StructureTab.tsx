import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Cloud, Globe, LayoutDashboard, Puzzle, Route, Search, Server, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/documentation-content";
import {
  DONUT_CAPABILITIES,
  EDGE_CALLER_LABELS,
  EDGE_FUNCTIONS,
  EDGE_FUNCTION_GROUPS,
  LEAD_JOURNEY,
  OUTSIDE_SERVICES,
  SCREENS,
  defaultRolesFor,
  screenAccessRule,
  screenLabel,
  statusLabel,
} from "@/lib/app-structure";

const SECTION_IDS = ["screens", "edge", "donut", "journey", "services"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const matches = (query: string, ...texts: Array<string | null | undefined>) => {
  const needle = query.trim().toLowerCase();
  return !needle || texts.some((text) => (text ?? "").toLowerCase().includes(needle));
};

function Section({
  id,
  icon: Icon,
  title,
  summary,
  count,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  icon: typeof Server;
  title: string;
  summary: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`structure-${id}`}
        onClick={onToggle}
        className="flex min-h-11 w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
            <span className="text-[14px] font-semibold text-foreground">{title}</span>
            <Badge variant="outline" className="text-[10px]">{count}</Badge>
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{summary}</span>
        </span>
      </button>
      {open && (
        <div id={`structure-${id}`} className="ml-4 mt-1 border-l border-border/60 pb-2 pl-4">
          {children}
        </div>
      )}
    </li>
  );
}

function Chip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "fn" | "role" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px]",
        tone === "fn" && "border-primary/25 bg-primary/[0.06] font-mono text-primary",
        tone === "role" && "border-border/70 bg-muted/50 text-foreground",
        tone === "default" && "border-border/60 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Item({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <li className="rounded-lg px-2 py-2 hover:bg-muted/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        {meta}
      </div>
      {children && <div className="mt-1 space-y-1.5 text-[12px] leading-snug text-muted-foreground">{children}</div>}
    </li>
  );
}

export default function StructureTab() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(["journey"]));
  const searching = query.trim().length > 0;

  const screens = useMemo(
    () =>
      SCREENS.map((screen) => ({ ...screen, label: screenLabel(screen.navItem), rule: screenAccessRule(screen.navItem), roles: defaultRolesFor(screen.navItem) }))
        .filter((s) => matches(query, s.label, s.path, s.purpose, s.rule, ...s.edgeFunctions, ...s.roles.map((r) => ROLE_LABELS[r]))),
    [query],
  );
  const functions = useMemo(
    () => EDGE_FUNCTIONS.filter((fn) => matches(query, fn.name, fn.purpose, fn.group, ...fn.callers.map((c) => EDGE_CALLER_LABELS[c]))),
    [query],
  );
  const donut = useMemo(
    () => DONUT_CAPABILITIES.filter((c) => matches(query, c.title, c.description, ...c.talksTo.map((t) => t.name))),
    [query],
  );
  const journey = useMemo(
    () => LEAD_JOURNEY.filter((step) => matches(query, step.title, step.who, step.description, ...step.edgeFunctions, ...step.statuses.map(statusLabel))),
    [query],
  );
  const services = useMemo(() => OUTSIDE_SERVICES.filter((s) => matches(query, s.name, s.role, s.via)), [query]);

  const isOpen = (id: SectionId) => searching || open.has(id);
  const toggle = (id: SectionId) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const nothing = screens.length + functions.length + donut.length + journey.length + services.length === 0;

  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/95">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/8 p-2.5 text-primary">
              <Workflow className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Marshmallow Structure</h2>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                How the pieces fit together: how a lead moves through the system, every CRM screen and who opens it, the
                Edge Functions behind them, what Donut does, and the outside services. Default roles are read from the
                app's access rules; per-user grants in Feature Access can add more. Read-only.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search the Marshmallow structure"
                placeholder="Search screens, roles, functions, statuses…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(new Set(SECTION_IDS))}>Expand all</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(new Set())}>Collapse all</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/95">
        <CardContent className="p-3 sm:p-5">
          <p className="flex items-center gap-2 px-2 pb-2 text-[14px] font-semibold">
            <LayoutDashboard aria-hidden="true" className="h-4 w-4 text-primary" /> Marshmallow
          </p>
          <ul className="ml-2 space-y-1 border-l border-border/60 pl-2">
            {journey.length > 0 && (
              <Section id="journey" icon={Route} title="Lead journey" summary="From a Quo chat to Paid: who acts at each step, the statuses and the functions involved." count={journey.length} open={isOpen("journey")} onToggle={() => toggle("journey")}>
                <ol className="space-y-1">
                  {journey.map((step) => (
                    <Item key={step.title} title={step.title} meta={<Chip>{step.who}</Chip>}>
                      <p>{step.description}</p>
                      {(step.statuses.length > 0 || step.edgeFunctions.length > 0) && (
                        <div className="flex flex-wrap gap-1">
                          {step.statuses.map((status) => <Chip key={status} tone="role">{statusLabel(status)}</Chip>)}
                          {step.edgeFunctions.map((fn) => <Chip key={fn} tone="fn">{fn}</Chip>)}
                        </div>
                      )}
                    </Item>
                  ))}
                </ol>
              </Section>
            )}

            {screens.length > 0 && (
              <Section id="screens" icon={LayoutDashboard} title="CRM screens" summary="Every sidebar item, its address, who opens it by default and the Edge Functions it calls." count={screens.length} open={isOpen("screens")} onToggle={() => toggle("screens")}>
                <ul className="space-y-1">
                  {screens.map((screen) => (
                    <Item key={screen.navItem} title={screen.label} meta={<Chip>{screen.path ?? "inside another screen"}</Chip>}>
                      <p>{screen.purpose}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">Opens by default:</span>
                        {screen.roles.map((role) => <Chip key={role} tone="role">{ROLE_LABELS[role]}</Chip>)}
                      </div>
                      <p className="italic">{screen.rule}</p>
                      {screen.edgeFunctions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">Calls:</span>
                          {screen.edgeFunctions.map((fn) => <Chip key={fn} tone="fn">{fn}</Chip>)}
                        </div>
                      )}
                    </Item>
                  ))}
                </ul>
              </Section>
            )}

            {functions.length > 0 && (
              <Section id="edge" icon={Server} title="Edge Functions" summary="Server code that holds the secrets and does the checked work, grouped by job, with who calls each one." count={functions.length} open={isOpen("edge")} onToggle={() => toggle("edge")}>
                <div className="space-y-3">
                  {EDGE_FUNCTION_GROUPS.map((group) => {
                    const inGroup = functions.filter((fn) => fn.group === group);
                    if (inGroup.length === 0) return null;
                    return (
                      <div key={group}>
                        <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group}</p>
                        <ul className="space-y-0.5">
                          {inGroup.map((fn) => (
                            <Item
                              key={fn.name}
                              title={<code>{fn.name}</code>}
                              meta={fn.callers.length > 0
                                ? fn.callers.map((c) => <Chip key={c} tone="role">{EDGE_CALLER_LABELS[c]}</Chip>)
                                : <Chip>Not called</Chip>}
                            >
                              <p>{fn.purpose}</p>
                            </Item>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {donut.length > 0 && (
              <Section id="donut" icon={Puzzle} title="Donut extension" summary="The Chrome extension used inside Quo. It signs in as the user and uses the same server checks as the CRM." count={donut.length} open={isOpen("donut")} onToggle={() => toggle("donut")}>
                <ul className="space-y-1">
                  {donut.map((capability) => (
                    <Item key={capability.title} title={capability.title}>
                      <p>{capability.description}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">Talks to:</span>
                        {capability.talksTo.map((target) => (
                          <Chip key={`${target.kind}-${target.name}`} tone={target.kind === "edge" ? "fn" : "default"}>
                            {target.kind === "site" && <Globe aria-hidden="true" className="mr-1 h-3 w-3" />}
                            {{ edge: "", rpc: "function ", table: "table ", storage: "bucket ", site: "" }[target.kind]}
                            {target.name}
                          </Chip>
                        ))}
                      </div>
                    </Item>
                  ))}
                </ul>
              </Section>
            )}

            {services.length > 0 && (
              <Section id="services" icon={Cloud} title="Outside services" summary="Everything Marshmallow depends on outside its own code." count={services.length} open={isOpen("services")} onToggle={() => toggle("services")}>
                <ul className="space-y-1">
                  {services.map((service) => (
                    <Item key={service.name} title={service.name} meta={<Chip>{service.via}</Chip>}>
                      <p>{service.role}</p>
                    </Item>
                  ))}
                </ul>
              </Section>
            )}

            {searching && nothing && (
              <li className="px-2 py-3 text-[13px] text-muted-foreground">Nothing matches “{query.trim()}”.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
