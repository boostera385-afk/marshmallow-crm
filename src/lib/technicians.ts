import { supabase } from "@/integrations/supabase/client";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { TechnicianRecord } from "@/components/technicians/TechnicianDialog";

export const TECHNICIAN_SELECT =
  "id, name, area, service, notes, chat_link, phone_number, latitude, longitude, code, opr_code, is_active, created_by, created_at, updated_at, is_good_tech";
export const TECHNICIAN_FALLBACK_SELECT =
  "id, name, area, service, notes, chat_link, phone_number, latitude, longitude, is_active, created_by, created_at, updated_at, is_good_tech";

/** How the technician list is scoped for the requesting user. */
export interface TechnicianVisibility {
  mode: "all" | "coded" | "own";
  oprCode?: string | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // hard safety cap = 50,000 rows

export async function fetchAllTechnicians(): Promise<TechnicianRecord[]> {
  const byId = new Map<string, TechnicianRecord>();
  let useFallback = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const selectCols = useFallback ? TECHNICIAN_FALLBACK_SELECT : TECHNICIAN_SELECT;
    let res = await supabase
      .from("technicians")
      .select(selectCols)
      .order("is_active", { ascending: false })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PostgrestSingleResponse<TechnicianRecord[]>;

    if (res.error && (res.error.message?.includes("code") || res.error.code === "42703")) {
      useFallback = true;
      res = await supabase
        .from("technicians")
        .select(TECHNICIAN_FALLBACK_SELECT)
        .order("is_active", { ascending: false })
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    }
    if (res.error) throw res.error;

    const rows = (res.data ?? []) as unknown as TechnicianRecord[];
    for (const r of rows) if (r?.id) byId.set(r.id, r);
    if (rows.length < PAGE_SIZE) break;
  }
  return Array.from(byId.values()).sort((a, b) =>
    Number(b.is_active !== false) - Number(a.is_active !== false) ||
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  );
}

// Shared React Query key for the full technician dataset (used by Map View).
export const TECHNICIANS_QUERY_KEY = ["technicians", "all"] as const;
// Root key covering every technician-related query (paginated, count, all).
export const TECHNICIANS_ROOT_KEY = ["technicians"] as const;

export function upsertTechnicianInList(
  list: TechnicianRecord[] | undefined,
  tech: TechnicianRecord,
): TechnicianRecord[] {
  const base = list ? list.filter((t) => t.id !== tech.id) : [];
  base.push(tech);
  return base.sort((a, b) =>
    Number(b.is_active !== false) - Number(a.is_active !== false) ||
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  );
}

export interface PaginatedTechnicians {
  technicians: TechnicianRecord[];
  totalCount: number;
}

export type TechnicianSortOption =
  | "name_asc" | "name_desc"
  | "code_asc" | "code_desc" | "code_count"
  | "service_asc" | "service_desc"
  | "area_asc" | "area_desc";

/**
 * Database-backed paginated technician fetch with code filtering and sorting support.
 */
export interface TechnicianColumnFilters {
  name?: string;
  code?: string;
  service?: string;
  area?: string;
}

// PostgREST `.or()` treats commas and parentheses as syntax, so strip anything
// that would break the filter expression out of a user-typed search term.
function sanitizeIlikeTerm(value: string): string {
  return value.replace(/[(),%]/g, " ").trim();
}

export async function fetchTechniciansPage(params: {
  page: number;
  pageSize: number;
  search: string;
  /** CRM-only deep link from a permitted Copilot search; RLS still applies. */
  technicianId?: string;
  /** Filters on opr_code now: "all" | "none" | "has_code" | "<OPR code>". */
  codeFilter?: string;
  sortBy?: TechnicianSortOption;
  /** columnFilters.code targets the opr_code column. */
  columnFilters?: TechnicianColumnFilters;
  visibility?: TechnicianVisibility;
}): Promise<PaginatedTechnicians> {
  const page = Math.max(1, params.page | 0);
  const pageSize = Math.max(1, params.pageSize | 0);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const search = (params.search ?? "").trim();
  const codeFilter = (params.codeFilter ?? "all").trim();
  const sortBy = params.sortBy ?? "name_asc";

  const columnFilters = params.columnFilters ?? {};
  const nameFilter = (columnFilters.name ?? "").trim();
  const codeColFilter = (columnFilters.code ?? "").trim();
  const serviceFilter = (columnFilters.service ?? "").trim();
  const areaFilter = (columnFilters.area ?? "").trim();
  const hasColumnFilters = Boolean(nameFilter || codeColFilter || serviceFilter || areaFilter);

  const visibility = params.visibility ?? { mode: "all" as const };
  // "own" scope with no OPR code can never match anything.
  if (visibility.mode === "own" && !visibility.oprCode) {
    return { technicians: [], totalCount: 0 };
  }
  const restrictByOpr = visibility.mode !== "all";

  // The RPC search path can't express per-column filters or the OPR scope, so
  // fall through to the query builder whenever either is active.
  if (search && !hasColumnFilters && !restrictByOpr && !params.technicianId) {
    const { data, error } = await supabase.rpc("search_technicians", {
      _q: search,
      _limit: pageSize,
      _offset: from,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<TechnicianRecord & { total_count: number | string | null }>;
    const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;

    // Attach opr_code / created_at (and legacy code) for the returned rows.
    let extra = new Map<string, { code: string | null; opr_code: string | null; is_active: boolean; is_good_tech: boolean | null; created_by: string | null; created_at: string | null; updated_at: string | null }>();
    if (rows.length > 0) {
      try {
        const ids = rows.map((r) => r.id);
        const { data: ex } = await supabase.from("technicians").select("id, code, opr_code, is_active, is_good_tech, created_by, created_at, updated_at").in("id", ids);
        const exRows = (ex ?? []) as unknown as Array<{ id: string; code: string | null; opr_code: string | null; is_active: boolean; is_good_tech: boolean | null; created_by: string | null; created_at: string | null; updated_at: string | null }>;
        extra = new Map(exRows.map((c) => [c.id, { code: c.code ?? null, opr_code: c.opr_code ?? null, is_active: c.is_active, is_good_tech: c.is_good_tech, created_by: c.created_by ?? null, created_at: c.created_at ?? null, updated_at: c.updated_at ?? null }]));
      } catch {
        // ignore if columns missing
      }
    }

    let technicians: TechnicianRecord[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.area,
      service: r.service,
      notes: r.notes,
      chat_link: r.chat_link,
      phone_number: r.phone_number,
      latitude: r.latitude,
      longitude: r.longitude,
      is_active: extra.get(r.id)?.is_active ?? true,
      // search_technicians does not return this column and it was missing from
      // the supplementary select as well, so on the search path every row
      // arrived with it undefined and the Good Tech star never rendered filled.
      is_good_tech: extra.get(r.id)?.is_good_tech ?? false,
      created_by: extra.get(r.id)?.created_by ?? null,
      code: extra.get(r.id)?.code ?? null,
      opr_code: extra.get(r.id)?.opr_code ?? null,
      created_at: extra.get(r.id)?.created_at ?? null,
      updated_at: extra.get(r.id)?.updated_at ?? null,
    }));

    if (codeFilter !== "all") {
      if (codeFilter === "none") technicians = technicians.filter((t) => !t.opr_code);
      else if (codeFilter === "has_code") technicians = technicians.filter((t) => !!t.opr_code);
      else technicians = technicians.filter((t) => (t.opr_code ?? "").toLowerCase() === codeFilter.toLowerCase());
    }

    return { technicians, totalCount: codeFilter !== "all" ? technicians.length : totalCount };
  }

  let query = supabase.from("technicians").select(TECHNICIAN_SELECT, { count: "exact" });
  if (params.technicianId) query = query.eq("id", params.technicianId);

  if (visibility.mode === "own") query = query.eq("opr_code", visibility.oprCode as string);
  else if (visibility.mode === "coded") query = query.not("opr_code", "is", null);

  if (codeFilter === "none") query = query.is("opr_code", null);
  else if (codeFilter === "has_code") query = query.not("opr_code", "is", null);
  else if (codeFilter && codeFilter !== "all") query = query.eq("opr_code", codeFilter);

  // Per-column header filters (each an independent contains-match).
  if (nameFilter) query = query.ilike("name", `%${nameFilter}%`);
  if (codeColFilter) query = query.ilike("opr_code", `%${codeColFilter}%`);
  if (serviceFilter) query = query.ilike("service", `%${serviceFilter}%`);
  if (areaFilter) query = query.ilike("area", `%${areaFilter}%`);

  if (search) {
    const term = sanitizeIlikeTerm(search);
    if (term) {
      query = query.or(
        `name.ilike.%${term}%,opr_code.ilike.%${term}%,service.ilike.%${term}%,area.ilike.%${term}%,phone_number.ilike.%${term}%`,
      );
    }
  }

  query = query.order("is_active", { ascending: false });
  if (sortBy === "name_desc") query = query.order("name", { ascending: false }).order("id", { ascending: true });
  else if (sortBy === "code_asc") query = query.order("opr_code", { ascending: true, nullsFirst: false }).order("name", { ascending: true });
  else if (sortBy === "code_desc") query = query.order("opr_code", { ascending: false, nullsFirst: false }).order("name", { ascending: true });
  else if (sortBy === "service_asc") query = query.order("service", { ascending: true, nullsFirst: false }).order("name", { ascending: true });
  else if (sortBy === "service_desc") query = query.order("service", { ascending: false, nullsFirst: false }).order("name", { ascending: true });
  else if (sortBy === "area_asc") query = query.order("area", { ascending: true, nullsFirst: false }).order("name", { ascending: true });
  else if (sortBy === "area_desc") query = query.order("area", { ascending: false, nullsFirst: false }).order("name", { ascending: true });
  else query = query.order("name", { ascending: true }).order("id", { ascending: true });

  query = query.range(from, to);
  const { data, error, count } = await query;
  if (error) throw error;
  return {
    technicians: (data ?? []) as unknown as TechnicianRecord[],
    totalCount: count ?? 0,
  };
}
