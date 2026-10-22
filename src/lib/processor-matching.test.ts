// @vitest-environment node
import { describe, expect, it } from "vitest";
import { attributeTechnicianReplies, createJobMatcher, jobAnchors, phoneKey, type JobIdentity, type JobMessage } from "../../supabase/functions/_shared/processor-job-status";

// The pre-optimization algorithm, retained only as a behavioral/performance baseline.
function baseline(text: string, job: JobIdentity, peers: JobIdentity[]): boolean {
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const haystack = ` ${normalize(text)} `;
  const mentions = (anchor: string) => haystack.includes(` ${anchor} `);
  const phone = phoneKey(job.customer_phone);
  const phones = new Set((text.match(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g) ?? []).map(phoneKey).filter(Boolean));
  const own = jobAnchors(job).filter((a) => !peers.some((p) => p.id !== job.id && jobAnchors(p).includes(a)));
  const ownPhone = phone && !peers.some((p) => p.id !== job.id && phoneKey(p.customer_phone) === phone);
  if (!own.some(mentions) && !(ownPhone && phones.has(phone))) return false;
  return !peers.some((p) => p.id !== job.id && (jobAnchors(p).filter((a) => !jobAnchors(job).includes(a)).some(mentions) || (phoneKey(p.customer_phone) && phoneKey(p.customer_phone) !== phone && phones.has(phoneKey(p.customer_phone)!))));
}
const job: JobIdentity = { id: "target", job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", address: "10 Sample St Apt 2", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-15T00:00:00Z", created_at: "2026-10-01T00:00:00Z" };
const peer = { ...job, id: "peer", job_id: "JOB-1002", customer_name: "Jane Example", customer_phone: "4155550102", address: "12 Example St" };

describe("compiled job matching", () => {
  it("preserves unique identifiers, peer exclusion, shared identity and unit/phone boundaries", () => {
    const cases: [string, boolean][] = [["JOB-1001 is completed", true], ["JOB-1002 is completed", false], ["JOB-10010 is completed", false], ["JOB-1001 and JOB-1002 are completed", false], ["John Sample is working", true], ["10 Sample St Apt 22 is done", false], ["+1 (415) 555-0101 is completed", true], ["JOB-1001 and (415) 555-0102", false], ["Done", false]];
    const matches = createJobMatcher(job, [job, peer]);
    for (const [text, expected] of cases) { expect(matches(text), text).toBe(expected); expect(matches(text)).toBe(baseline(text, job, [job, peer])); }
    for (const duplicate of [{ ...peer, customer_name: job.customer_name }, { ...peer, customer_phone: job.customer_phone }, { ...peer, address: job.address }]) {
      const matchesShared = createJobMatcher(job, [job, duplicate]);
      for (const [text] of cases) expect(matchesShared(text)).toBe(baseline(text, job, [job, duplicate]));
    }
  });
  it("normalizes peer identities once, not per message, with identical full-history results", () => {
    let identityReads = 0;
    // Keep the intentionally slow baseline small enough for ordinary CI; exercise
    // the optimized path with 10,000 additional events below.
    const peers = [job, ...Array.from({ length: 60 }, (_, index) => ({ ...peer, id: `peer-${index}`, job_id: `OTHER-${index}`, address: `${index + 100} Example St`, customer_phone: null, get customer_name() { identityReads++; return `Example Person ${index}`; } }))];
    const history = Array.from({ length: 360 }, (_, index) => index % 10 === 0 ? "JOB-1001 is in progress" : `OTHER-${index % 60} is completed`);
    const startOld = performance.now();
    const oldResults = history.map((text) => baseline(text, job, peers));
    const oldMs = performance.now() - startOld; const oldReads = identityReads;
    identityReads = 0;
    const startNew = performance.now(); const matches = createJobMatcher(job, peers);
    const results = history.map(matches); const newMs = performance.now() - startNew;
    expect(results).toEqual(oldResults);
    expect(results.filter(Boolean)).toHaveLength(36);
    expect(identityReads).toBe(60);
    expect(oldReads).toBeGreaterThan(identityReads * 1000);
    // No timing assertion: machine contention must not make correctness tests flaky.
    console.info(`Synthetic 60-peer/360-message matcher: before ${oldMs.toFixed(1)}ms / ${oldReads} identity reads; after ${newMs.toFixed(1)}ms / ${identityReads} identity reads.`);
    for (let index = 0; index < 10000; index++) expect(matches(index % 2 ? "JOB-1001 is completed" : "JOB-1001 and OTHER-59 are completed")).toBe(Boolean(index % 2));
    expect(identityReads).toBe(60);
  });
  it("builds one peer identity index per attribution pass, not one matcher per peer", () => {
    let identityReads = 0;
    const peers = [job, ...Array.from({ length: 60 }, (_, index) => ({ ...peer, id: `peer-${index}`, job_id: `OTHER-${index}`, address: `${index + 100} Example St`, customer_phone: null, get customer_name() { identityReads++; return `Example Person ${index}`; } }))];
    const messages: JobMessage[] = [{ id: "dispatch", conversation_id: "chat", sender: "agent", text: "JOB-1001 is in progress", status: "delivered", message_time: "2026-10-15T14:00:00Z" },
      ...Array.from({ length: 360 }, (_, index) => ({ id: `m-${index}`, conversation_id: "chat", sender: index % 2 ? "customer" : "agent", text: index % 2 ? "Ok thank you" : "Please send the update", status: index % 2 ? "received" : "delivered", message_time: new Date(Date.parse("2026-10-15T14:01:00Z") + index * 60_000).toISOString() }))];
    // Compare the same roster/workload with the initial per-peer compile plan.
    createJobMatcher(job, peers);
    for (const other of peers.slice(1)) createJobMatcher(other, peers);
    const perPeerReads = identityReads;
    identityReads = 0;
    const attribution = attributeTechnicianReplies(job, peers, messages);
    // Target matcher reads each peer once; the attribution index reads each peer once.
    expect(attribution.contextual.size).toBe(180);
    expect(perPeerReads).toBe(3660);
    expect(identityReads).toBe(120);
  });
  it("does not reuse identity indexes after job reassignment or scope changes", () => {
    const before = createJobMatcher(job, [job]);
    const after = createJobMatcher(job, [job, { ...peer, customer_name: job.customer_name }]);
    expect(before("John Sample is completed")).toBe(true);
    expect(after("John Sample is completed")).toBe(false);
    expect(after("JOB-1001 is completed")).toBe(true);
  });
});
