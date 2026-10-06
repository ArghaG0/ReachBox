import { useState } from "react";
import { addDays, format, setHours, setMinutes, setSeconds, startOfDay } from "date-fns";
import { Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
const tomorrowAt = (h: number) => setSeconds(setMinutes(setHours(startOfDay(addDays(new Date(), 1)), h), 0), 0);

const QUICK: { label: string; get: () => Date }[] = [
  { label: "Tomorrow", get: () => tomorrowAt(9) },
  { label: "Tomorrow, 10:00 AM", get: () => tomorrowAt(10) },
  { label: "Tomorrow, 11:00 AM", get: () => tomorrowAt(11) },
  { label: "Tomorrow, 3:00 PM", get: () => tomorrowAt(15) },
];

interface Props {
  value: Date | null;
  onChange: (d: Date | null) => void;
}

export function SendLaterPopover({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const handleOpen = (o: boolean) => {
    if (o) setDraft(value ? toLocalInput(value) : "");
    setOpen(o);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Send later"
          className={cn("rounded-full p-1.5 hover:bg-field", value ? "text-brand" : "text-muted-foreground")}
        >
          <Clock className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={22} className="w-80 rounded-md p-4 shadow-lg">
        <h3 className="text-[15px] font-medium text-foreground">Send Later</h3>
        <input
          type="datetime-local"
          value={draft}
          min={toLocalInput(new Date())}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Pick date & time"
          className="mt-5 w-full border-b border-border bg-transparent pb-2 text-sm text-muted-foreground outline-none focus:border-brand"
        />
        <ul className="mt-4 space-y-1">
          {QUICK.map((q) => (
            <li key={q.label}>
              <button
                type="button"
                onClick={() => setDraft(toLocalInput(q.get()))}
                className="w-full rounded-md py-1.5 text-left text-sm text-foreground/80 hover:text-brand"
              >
                {q.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex items-center justify-end gap-4">
          {value && (
            <button type="button" className="mr-auto text-xs text-muted-foreground hover:underline" onClick={() => { onChange(null); setOpen(false); }}>
              Send now
            </button>
          )}
          <button type="button" className="px-3 text-sm text-foreground" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <Button
            variant="brand-outline"
            className="h-8 px-6"
            disabled={!draft}
            onClick={() => {
              onChange(draft ? new Date(draft) : null);
              setOpen(false);
            }}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
