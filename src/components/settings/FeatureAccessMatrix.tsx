import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COPY_ROLES } from "@/lib/operator-workflow";
import type { AppRole } from "@/types";

export interface AccessUser {
  id: string;
  full_name: string | null;
  role: AppRole;
}
export interface AccessFeature<T extends AccessUser> {
  key: string;
  label: string;
  searchTerms?: string[];
  renderControl: (user: T) => ReactNode;
}

const PAGE_SIZE = 4;
export default function FeatureAccessMatrix<T extends AccessUser>({ users, features }: {
  users: T[];
  features: AccessFeature<T>[];
}) {
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [featureSearch, setFeatureSearch] = useState("");
  const [page, setPage] = useState(0);
  const filteredUsers = users.filter((user) =>
    user.role !== "admin" && (roleFilter === "all" || user.role === roleFilter) &&
    (user.full_name || "Unnamed user").toLowerCase().includes(userSearch.trim().toLowerCase()),
  );
  const filteredFeatures = features.filter((feature) =>
    [feature.label, ...(feature.searchTerms ?? [])].some((label) => label.toLowerCase().includes(featureSearch.trim().toLowerCase())),
  );
  const lastPage = Math.max(0, Math.ceil(filteredFeatures.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  const visibleFeatures = filteredFeatures.slice(start, start + PAGE_SIZE);
  const userLabel = (user: AccessUser) => (
    <div className="min-w-0">
      <p className="break-words text-sm font-semibold">{user.full_name || "Unnamed user"}</p>
      <p className="mt-1 text-xs text-muted-foreground">{COPY_ROLES.find((item) => item.role === user.role)?.label}</p>
    </div>
  );

  return (
    <Card className="min-w-0 overflow-hidden border-border/60 bg-card/95">
      <CardContent className="p-0">
        <div className="space-y-4 border-b border-border/40 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Feature & Navigation Access</h3>
              <p className="mt-1 text-sm text-muted-foreground">Find a teammate or feature. Use the arrows to browse without dragging a scrollbar.</p>
<p className="mt-1 text-xs text-muted-foreground">Copy All Details shows each user's effective access. Choose Inherit, Allow or Deny here; role defaults and detailed Copilot controls are managed above. Fixed permissions cannot be changed here.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-xs font-medium">
              <span>Find user</span>
              <Input placeholder="Search by name…" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} />
            </label>
            <div className="space-y-1.5 text-xs font-medium">
              <span>Filter role</span>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger aria-label="Filter feature access by role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {COPY_ROLES.map((item) => <SelectItem key={item.role} value={item.role}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="space-y-1.5 text-xs font-medium">
              <span>Find feature</span>
              <Input placeholder="e.g. Quickchat, Manual Lead…" value={featureSearch} onChange={(event) => { setFeatureSearch(event.target.value); setPage(0); }} />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{filteredUsers.length} users · {features.length} features</p>
            <div className="flex items-center gap-2" aria-label="Feature pages">
              <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Previous features" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span className="min-w-28 text-center text-xs font-medium" role="status" aria-live="polite">
                {filteredFeatures.length ? `Features ${start + 1}–${start + visibleFeatures.length} of ${filteredFeatures.length}` : "No features"}
              </span>
              <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Next features" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
        {!filteredUsers.length || !visibleFeatures.length ? (
          <div className="space-y-3 p-6 text-center text-sm text-muted-foreground">
            <p>No matching {filteredUsers.length ? "features" : "users"}. Try another search or role.</p>
            <Button variant="outline" onClick={() => { setUserSearch(""); setRoleFilter("all"); setFeatureSearch(""); setPage(0); }}>Clear filters</Button>
          </div>
        ) : (
          <>
            <div className="hidden max-h-[65vh] overflow-y-auto overscroll-contain lg:block">
              <table className="w-full table-fixed text-sm">
                <caption className="sr-only">Feature permissions by user. Use Previous features and Next features to view more columns.</caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky top-0 z-20 w-[28%] border-b border-r border-border/40 bg-card px-4 py-4 text-left text-xs font-semibold">User</th>
                    {visibleFeatures.map((feature) => <th key={feature.key} scope="col" className="sticky top-0 z-10 break-words border-b border-border/40 bg-card px-2 py-4 text-center text-xs font-semibold">{feature.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="border-b border-border/30 last:border-0 hover:bg-muted/25 focus-within:bg-muted/25">
                      <th scope="row" className="border-r border-border/30 px-4 py-4 text-left font-normal">{userLabel(user)}</th>
                      {visibleFeatures.map((feature) => <td key={feature.key} className="px-2 py-3 text-center">{feature.renderControl(user)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 p-3 lg:hidden">
              {filteredUsers.map((user) => (
                <section key={user.id} aria-label={`Feature access for ${user.full_name || "Unnamed user"}`} className="rounded-xl border border-border/60 p-3">
                  {userLabel(user)}
                  <div className="mt-3 divide-y divide-border/40">
                    {visibleFeatures.map((feature) => <div key={feature.key} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm"><span>{feature.label}</span><div className="shrink-0">{feature.renderControl(user)}</div></div>)}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
