import { useEffect, useId, useRef, useState } from "react";

interface Option<T> {
  value: T;
  label: string;
  disabled?: boolean;
}
interface Props<T> {
  value: T;
  options: readonly Option<T>[];
  label: string;
  display?: string;
  menuClass?: string;
  lang?: string;
  onChange: (value: T) => void;
}

export function Picker<T extends string | number>({ value, options, label, display, menuClass = "", lang, onChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const typeahead = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (!open) return;
    const selected = ref.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)');
    (selected ?? ref.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)'))?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      className={`option-picker ${open ? "open" : ""}`}
      ref={ref}
      lang={lang}
      onKeyDown={(event) => {
        if (event.key === "Tab" && open) {
          trigger.current?.focus();
          setOpen(false);
          return;
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
          return;
        }
        if (!open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
          return;
        }
        if (!open) return;
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: HTMLButtonElement | undefined;
        if (event.key === "ArrowDown") next = items[(current + 1) % items.length];
        else if (event.key === "ArrowUp") next = items[(current - 1 + items.length) % items.length];
        else if (event.key === "Home") next = items[0];
        else if (event.key === "End") next = items.at(-1);
        else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now();
          typeahead.current = { text: (now - typeahead.current.at < 700 ? typeahead.current.text : "") + event.key.toLocaleLowerCase(), at: now };
          next = items.find((item) => item.textContent?.toLocaleLowerCase().startsWith(typeahead.current.text));
        }
        if (next) {
          event.preventDefault();
          next.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="picker-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{display ?? options.find((option) => option.value === value)?.label ?? "SELECT"}</span>
        <b className="picker-arrow" aria-hidden="true" />
      </button>
      {open && (
        <div className={`picker-menu ${menuClass}`} id={menuId} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
