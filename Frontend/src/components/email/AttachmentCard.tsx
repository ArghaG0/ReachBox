import { X } from "lucide-react";

interface Props {
  name: string;
  size?: string;
  url: string;
  onRemove?: () => void;
}

export function AttachmentCard({ name, size, url, onRemove }: Props) {
  return (
    <div className="group relative w-[210px] overflow-hidden rounded-lg bg-field">
      <img src={url} alt={name} className="h-[116px] w-full object-cover" loading="lazy" />
      <div className="px-2.5 py-2">
        <p className="truncate text-sm text-foreground">{name}</p>
        {size && <p className="text-xs text-muted-foreground">{size}</p>}
      </div>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 hidden rounded-full bg-background/90 p-1 text-foreground shadow group-hover:block"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
