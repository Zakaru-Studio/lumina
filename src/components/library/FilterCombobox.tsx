import { useEffect, useRef } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** One selectable row in a {@link FilterCombobox}. */
export interface ComboOption {
  /** The value applied on select (unique within the list). */
  value: string;
  /** Displayed text; also what the search box matches against. */
  label: string;
  /** Extra search terms (matched in addition to the label). */
  keywords?: string[];
  /** Optional leading content (e.g. an avatar). */
  node?: React.ReactNode;
  /** Optional trailing count. */
  count?: number;
}

/**
 * A compact filter dropdown: an icon/label trigger that opens a searchable list.
 * Shared by the place and person filters — the caller supplies the options and
 * the trigger presentation; this owns the popover, the search box (cmdk), outside
 * click / Escape dismissal, and the optional "clear" row. `open` is controlled so
 * the toolbar can keep only one filter surface open at a time.
 */
export function FilterCombobox({
  active,
  triggerIcon,
  triggerLabel,
  options,
  selectedValue,
  onSelect,
  searchPlaceholder,
  emptyText,
  clearLabel,
  open,
  onOpenChange,
}: {
  /** Whether a value is currently applied (drives the trigger's active style). */
  active: boolean;
  /** Leading trigger content (an icon, or an avatar when something is selected). */
  triggerIcon: React.ReactNode;
  /** Trigger text: the selected label, or a placeholder. */
  triggerLabel: string;
  options: ComboOption[];
  /** Currently-applied value (for the check mark), or null. */
  selectedValue: string | null;
  /** Apply a value, or `null` to clear. The popover closes afterwards. */
  onSelect: (value: string | null) => void;
  searchPlaceholder: string;
  emptyText: string;
  clearLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const pick = (value: string | null) => {
    onSelect(value);
    onOpenChange(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant={active ? "secondary" : "ghost"}
        size="sm"
        className="h-8 gap-2"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {triggerIcon}
        <span className="max-w-[8rem] truncate">{triggerLabel}</span>
      </Button>

      {open ? (
        <div className="absolute left-0 top-9 z-50 w-64 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
          <Command>
            <CommandInput placeholder={searchPlaceholder} autoFocus />
            <CommandList className="max-h-72">
              <CommandEmpty>{emptyText}</CommandEmpty>
              {selectedValue ? (
                <>
                  <CommandGroup>
                    <CommandItem value="__clear__" onSelect={() => pick(null)}>
                      {clearLabel}
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                </>
              ) : null}
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    keywords={[o.label, ...(o.keywords ?? [])]}
                    onSelect={() => pick(o.value)}
                    className="gap-2"
                  >
                    {o.node}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {typeof o.count === "number" ? (
                      <span className="text-xs text-muted-foreground">{o.count}</span>
                    ) : null}
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        selectedValue === o.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
