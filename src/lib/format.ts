/** Medium date for a UTC-midnight date column; "-" when absent. */
export const fmtDateUtc = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" }) : "-";
