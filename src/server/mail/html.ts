import { escapeHtml } from "./index";

/** Plain paragraphs in a minimal wrapper. Every line is HTML-escaped; blank lines become paragraph breaks. */
export function paragraphsHtml(lines: string[]): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1f">${lines
    .map((l) => (l ? `<p style="margin:0 0 12px">${escapeHtml(l)}</p>` : ""))
    .join("")}</div>`;
}
