/** Turn the editor's parallel line inputs back into the array the services validate. */
export function formToDoc(fd: FormData): Record<string, unknown> {
  const get = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  const all = (k: string) => fd.getAll(k).map((v) => (typeof v === "string" ? v : ""));
  const d = all("lineDescription");
  const q = all("lineQuantity");
  const p = all("lineUnitPrice");
  const t = all("lineTaxable");
  const lines = d.map((description, i) => ({
    description,
    quantity: q[i] ?? "",
    unitPrice: p[i] ?? "",
    taxable: t[i] ?? "true",
  }));
  const out: Record<string, unknown> = { lines };
  for (const k of ["clientId", "projectId", "title", "notes", "terms", "dueDate", "validUntil"]) out[k] = get(k);
  return out;
}

/** Scalar fields to echo back after a validation error. */
export function docValues(doc: Record<string, unknown>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc)) if (typeof v === "string") o[k] = v;
  return o;
}
