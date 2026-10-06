import Papa from "papaparse";

export const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export interface ParsedRecipients {
  valid: string[];
  invalid: number;
}

/** Parse CSV/TXT text into deduped valid emails + an invalid count. */
export function parseRecipientText(text: string): ParsedRecipients {
  const rows = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
  const tokens = rows
    .flat()
    .flatMap((cell) => String(cell).split(/[\s,;]+/))
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const valid = new Set<string>();
  let invalid = 0;
  for (const t of tokens) {
    if (EMAIL_RE.test(t)) valid.add(t.toLowerCase());
    else if (t.includes("@") || !/^(email|e-mail|name|mail)$/i.test(t)) invalid += t.includes("@") ? 1 : 0;
  }
  return { valid: [...valid], invalid };
}
