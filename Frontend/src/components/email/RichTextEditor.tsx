import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, IndentDecrease, IndentIncrease, Italic, List, ListOrdered,
  Quote, Redo2, Strikethrough, Type, Underline as UnderlineIcon, Undo2, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onChange: (html: string, isEmpty: boolean) => void;
}

function Tool({ icon: Icon, label, onClick, active, disabled }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-foreground/70 hover:bg-field hover:text-foreground disabled:opacity-40",
        active && "bg-brand-soft text-brand",
      )}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}

const Sep = () => <span className="mx-1.5 h-6 w-px bg-border" />;

type Align = "left" | "center" | "right";
const ALIGN_NEXT: Record<Align, Align> = { left: "center", center: "right", right: "left" };
const ALIGN_ICON: Record<Align, LucideIcon> = { left: AlignLeft, center: AlignCenter, right: AlignRight };

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      ol: e.isActive("orderedList"),
      ul: e.isActive("bulletList"),
      quote: e.isActive("blockquote"),
      align: (["center", "right"] as const).find((a) => e.isActive({ textAlign: a })) ?? ("left" as Align),
      heading: ([1, 2, 3] as const).find((l) => e.isActive("heading", { level: l })) ?? 0,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      inList: e.isActive("listItem"),
    }),
  });
  const c = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center rounded-full bg-background px-3 py-1 shadow-[0_0_0_1px_var(--color-border)]">
      <Tool icon={Undo2} label="Undo" disabled={!s.canUndo} onClick={() => c().undo().run()} />
      <Tool icon={Redo2} label="Redo" disabled={!s.canRedo} onClick={() => c().redo().run()} />
      <Sep />
      <label className="flex items-center gap-1 rounded-md px-1 text-foreground/70 hover:bg-field">
        <Type className="size-[18px]" />
        <select
          aria-label="Text style"
          value={s.heading}
          onChange={(e) => {
            const lvl = Number(e.target.value);
            if (lvl === 0) c().setParagraph().run();
            else c().setHeading({ level: lvl as 1 | 2 | 3 }).run();
          }}
          className="cursor-pointer bg-transparent py-1.5 text-xs outline-none"
        >
          <option value={0}>Normal</option>
          <option value={1}>Heading 1</option>
          <option value={2}>Heading 2</option>
          <option value={3}>Heading 3</option>
        </select>
      </label>
      <Sep />
      <Tool icon={Bold} label="Bold" active={s.bold} onClick={() => c().toggleBold().run()} />
      <Tool icon={Italic} label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()} />
      <Tool icon={UnderlineIcon} label="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()} />
      <Sep />
      <Tool icon={ALIGN_ICON[s.align]} label={`Align (${s.align})`} onClick={() => c().setTextAlign(ALIGN_NEXT[s.align]).run()} />
      <Sep />
      <Tool icon={ListOrdered} label="Numbered list" active={s.ol} onClick={() => c().toggleOrderedList().run()} />
      <Tool icon={List} label="Bullet list" active={s.ul} onClick={() => c().toggleBulletList().run()} />
      <Tool icon={IndentIncrease} label="Indent" disabled={!s.inList} onClick={() => c().sinkListItem("listItem").run()} />
      <Tool icon={IndentDecrease} label="Outdent" disabled={!s.inList} onClick={() => c().liftListItem("listItem").run()} />
      <Tool icon={Quote} label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()} />
      <Sep />
      <Tool icon={Strikethrough} label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()} />
    </div>
  );
}

export function RichTextEditor({ onChange }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ underline: false }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Type Your Reply..." }),
    ],
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.isEmpty),
  });

  return (
    <div className="min-h-[470px] rounded-xl bg-editor p-4 text-[15px]">
      {editor ? (
        <div className="flex flex-col gap-4">
          <EditorContent editor={editor} className="px-1" />
          <Toolbar editor={editor} />
        </div>
      ) : (
        <div className="min-h-[400px]" />
      )}
    </div>
  );
}
