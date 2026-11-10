/**
 * Column projection for the "index" read of leads.
 *
 * The Leads page needs two very different things and was paying for both on
 * every row:
 *
 *  1. Complete, correct status counts and client-side filtering/search/sorting
 *     across EVERY lead. This is why the page deliberately pages the whole
 *     table rather than a single page - see the comment above fetchLeads.
 *  2. The full set of card fields, but only for the rows actually on screen.
 *
 * Serving (1) with all 53 list columns meant transferring ~1.96 MB per load for
 * an admin/processor/opr, and the card-only columns are the expensive ones:
 * service_details alone is 314 kB across the table, quote 139 kB,
 * nearby_areas 150 kB.
 *
 * This projection is everything the filters, counts, search and sort need, and
 * nothing else:
 *
 *   status                        - status tabs, counts, useAllowedStatuses
 *   cs_tag                        - tag filters, compareLeadDisplayPriority rank
 *   created_at, id                - ordering and the deterministic tie-break
 *   created_by, quote_requested_by- quote pinning (isLeadPinnedForUser)
 *   urgent_at                     - urgent ordering inside the Urgent Job bucket
 *   assigned_cs                   - the "shared with me" bucket
 *   customer_name, job_id,
 *   customer_phone, customer_landline, address, city, state, service_type
 *                                - the search box matches on exactly these
 *   customer_schedule_requirements - leadNeedsAttention, for the Need Attention view
 *   updated_at                    - the delta-sync cursor (src/lib/leads-sync.ts)
 *
 * Measured across 3,857 rows this is 577 kB, against 2,110 kB for every column.
 * The full card row is then fetched for just the 20-100 leads on screen.
 */
export const LEADS_INDEX_COLUMNS = [
  "id",
  "status",
  "created_at",
  "last_edited_at",
  "cs_tag",
  "created_by",
  "assigned_cs",
  "quote_requested_by",
  "urgent_at",
  "customer_name",
  "job_id",
  "customer_phone",
  "customer_landline",
  "address",
  "city",
  "state",
  "service_type",
  "customer_schedule_requirements",
  "updated_at",
].join(", ");
