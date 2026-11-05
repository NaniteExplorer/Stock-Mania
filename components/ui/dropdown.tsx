"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../lib/utils";
import { Icon } from "../icons";
import styles from "./dropdown.module.css";

/**
 * The app's one dropdown. Options-driven and template-friendly:
 *
 *   <Dropdown options={[{ value: "INR", label: "Rupee" }]} name="currency" defaultValue="INR" />
 *
 * Customise with `renderOption` / `renderValue`, `searchable`, `size`, `description`
 * and `group` on options. A visually hidden native <select> mirrors the value, so
 * it still posts with server-action forms, honours `required`, and fires the
 * usual `onChange(event)` for callers written against a plain <select>.
 */
export interface DropdownOption {
  value: string;
  label: React.ReactNode;
  /** Plain text used for search and type-ahead when `label` is not a string. */
  textValue?: string;
  description?: React.ReactNode;
  group?: string;
  disabled?: boolean;
}

type SelectPassthrough = Omit<React.ComponentProps<"select">, "children" | "value" | "defaultValue" | "size">;

export interface DropdownProps extends SelectPassthrough {
  options: readonly DropdownOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: React.ReactNode;
  /** Show a filter box. Defaults to on when there are more than 8 options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  size?: "sm" | "md";
  renderOption?: (option: DropdownOption, state: { selected: boolean; active: boolean }) => React.ReactNode;
  renderValue?: (option: DropdownOption | undefined) => React.ReactNode;
  emptyMessage?: React.ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
}

const textOf = (o: DropdownOption) =>
  o.textValue ?? (typeof o.label === "string" || typeof o.label === "number" ? String(o.label) : o.value);

export function Dropdown({
  options,
  value,
  defaultValue,
  onValueChange,
  onChange,
  placeholder = "Select…",
  searchable,
  searchPlaceholder = "Search…",
  size = "md",
  renderOption,
  renderValue,
  emptyMessage = "No matches",
  className,
  triggerClassName,
  contentClassName,
  id,
  disabled,
  name,
  required,
  form,
  ref: callerRef,
  ...rest
}: DropdownProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const current = controlled ? value : inner;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(-1);
  const selectRef = React.useRef<HTMLSelectElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const typeahead = React.useRef({ text: "", at: 0 });
  const listId = React.useId();

  const showSearch = searchable ?? options.length > 8;
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => textOf(o).toLowerCase().includes(q)) : options;
  }, [options, query]);
  const selected = options.find((o) => o.value === current);
  const headers = React.useMemo(
    () => visible.map((o, i) => (o.group && o.group !== visible[i - 1]?.group ? o.group : null)),
    [visible],
  );

  // Split aria-* / data-* from the rest: ARIA belongs on the visible trigger.
  const ariaProps: Record<string, unknown> = {};
  const selectProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) (k.startsWith("aria-") ? ariaProps : selectProps)[k] = v;

  const openList = () => {
    if (disabled) return;
    setQuery("");
    const idx = options.findIndex((o) => o.value === current);
    setActive(idx >= 0 ? idx : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };

  const commit = (option: DropdownOption) => {
    if (option.disabled) return;
    setOpen(false);
    if (option.value === current) return;
    if (!controlled) setInner(option.value);
    onValueChange?.(option.value);
    const el = selectRef.current;
    if (el) {
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const move = (from: number, step: 1 | -1) => {
    if (!visible.length) return -1;
    let i = from;
    for (let n = 0; n < visible.length; n++) {
      i = (i + step + visible.length) % visible.length;
      if (!visible[i].disabled) return i;
    }
    return from;
  };

  React.useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onListKey = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); setActive((a) => move(a, 1)); break;
      case "ArrowUp": event.preventDefault(); setActive((a) => move(a, -1)); break;
      case "Home": if (!showSearch) { event.preventDefault(); setActive(move(-1, 1)); } break;
      case "End": if (!showSearch) { event.preventDefault(); setActive(move(visible.length, -1)); } break;
      case "Enter":
        event.preventDefault();
        if (visible[active]) commit(visible[active]);
        break;
      case "Tab": setOpen(false); break;
      default:
        if (!showSearch && event.key.length === 1) {
          const now = event.timeStamp;
          const t = typeahead.current;
          t.text = now - t.at < 600 ? t.text + event.key.toLowerCase() : event.key.toLowerCase();
          t.at = now;
          const hit = visible.findIndex((o) => !o.disabled && textOf(o).toLowerCase().startsWith(t.text));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  return (
    <div className={cn(styles.root, className)} data-slot="dropdown">
      <PopoverPrimitive.Root open={open} onOpenChange={(o) => (o ? openList() : setOpen(false))}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-required={required || undefined}
            data-size={size}
            data-placeholder={selected ? undefined : ""}
            className={cn(styles.trigger, triggerClassName)}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); openList(); }
            }}
            {...ariaProps}
          >
            <span className={styles.value}>{renderValue ? renderValue(selected) : selected ? selected.label : placeholder}</span>
            <Icon name="chev-d" className={styles.chevron} aria-hidden />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className={cn(styles.content, contentClassName)}
            onKeyDown={onListKey}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (showSearch ? listRef.current?.parentElement?.querySelector("input") : listRef.current)?.focus();
            }}
          >
            {showSearch && (
              <div className={styles.search}>
                <Icon name="search" aria-hidden />
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  aria-controls={listId}
                  aria-activedescendant={active >= 0 ? `${listId}o${active}` : undefined}
                />
              </div>
            )}
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              className={styles.list}
              aria-activedescendant={active >= 0 ? `${listId}o${active}` : undefined}
            >
              {visible.length === 0 && <div className={styles.empty}>{emptyMessage}</div>}
              {visible.map((option, index) => {
                const isSelected = option.value === current;
                const header = headers[index];
                return (
                  <React.Fragment key={`${option.group ?? ""}:${option.value}`}>
                    {header && <div className={styles.group} role="presentation">{header}</div>}
                    <div
                      id={`${listId}o${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      data-active={index === active || undefined}
                      className={styles.option}
                      onPointerMove={() => !option.disabled && setActive(index)}
                      onClick={() => commit(option)}
                    >
                      {renderOption ? renderOption(option, { selected: isSelected, active: index === active }) : (
                        <span className={styles.optionText}>
                          <span>{option.label}</span>
                          {option.description && <span className={styles.description}>{option.description}</span>}
                        </span>
                      )}
                      {isSelected && <Icon name="check" className={styles.check} aria-hidden />}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      {/* Form participation + legacy onChange. Visually hidden, not display:none, so `required` still validates. */}
      <select
        ref={(el) => {
          selectRef.current = el;
          if (typeof callerRef === "function") callerRef(el);
          else if (callerRef) callerRef.current = el;
        }}
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        value={current}
        onChange={onChange ?? (() => {})}
        tabIndex={-1}
        aria-hidden
        className={styles.native}
        onFocus={() => document.getElementById(id ?? "")?.focus()}
        {...selectProps}
      >
        {!options.some((o) => o.value === current) && <option value={current} />}
        {options.map((o) => (
          <option key={`${o.group ?? ""}:${o.value}`} value={o.value} disabled={o.disabled}>{textOf(o)}</option>
        ))}
      </select>
    </div>
  );
}
