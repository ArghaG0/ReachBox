import { useRef, useState, type KeyboardEvent } from "react";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { EMAIL_RE, parseRecipientText } from "@/lib/recipients";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

const VISIBLE = 3;

export function RecipientInput({ value, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = (list: string[]) => onChange([...new Set([...value, ...list])]);

  const commit = () => {
    const parts = draft.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    add(parts.filter((p) => EMAIL_RE.test(p)).map((p) => p.toLowerCase()));
    setDraft(bad.join(", "));
    if (bad.length) toast.error(`Invalid email: ${bad.join(", ")}`);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { valid, invalid } = parseRecipientText(await file.text());
      add(valid);
      setSummary(`${valid.length} valid emails detected${invalid ? `, ${invalid} invalid skipped` : ""}`);
      if (!valid.length) toast.error("No valid emails found in that file");
    } catch {
      toast.error("Couldn't read that file");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const shown = expanded ? value : value.slice(0, VISIBLE);
  const hidden = value.length - shown.length;

  return (
    <div className="flex-1">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b border-border py-2 pl-2">
        {shown.map((email) => (
          <span
            key={email}
            className="group inline-flex items-center gap-1 rounded-full border border-brand/60 bg-brand-soft px-2.5 py-0.5 text-sm text-foreground"
          >
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              onClick={() => onChange(value.filter((v) => v !== email))}
              className="hidden text-muted-foreground hover:text-foreground group-hover:inline"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-full border border-brand/60 bg-brand-soft px-2.5 py-0.5 text-sm text-foreground"
          >
            +{hidden}
          </button>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          placeholder={value.length ? "" : "recipient@example.com"}
          className="min-w-40 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="ml-auto inline-flex items-center gap-2 px-2 text-[15px] text-brand hover:underline"
        >
          <Upload className="size-4" /> Upload List
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {summary && <p className="mt-1.5 pl-2 text-xs text-brand">{summary}</p>}
    </div>
  );
}
