/** Display only saved customer location data. Never geocode, infer or persist it. */
export function processorLocation(job: { city?: string | null; state?: string | null; address?: string | null; half_address?: string | null }) {
  const clean = (value: string | null | undefined) => {
    const text = value?.trim() ?? "";
    return /^(?:unknown|n\/?a|none|null|undefined|[-—])?$/i.test(text) ? "" : text;
  };
  const city = clean(job.city);
  const state = clean(job.state);
  const address = clean(job.address);
  const partial = clean(job.half_address);
  if (city || state) return { text: [city, state].filter(Boolean).join(", "), note: !city ? "City not saved" : !state ? "State not saved" : null };
  if (address) return { text: address, note: "Saved address · city/state not saved" };
  if (partial) return { text: partial, note: "Partial address · city/state not saved" };
  return { text: "Job location missing", note: "Update the saved address" };
}
