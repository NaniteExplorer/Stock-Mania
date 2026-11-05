import * as React from "react";
import { cn } from "../../lib/utils";
import { Dropdown, type DropdownOption } from "./dropdown";
import styles from "./native-select.module.css";

/**
 * Drop-in for a plain <select>: reads its <option>/<optgroup> children and renders
 * the shared custom `Dropdown`. A hidden native select still carries the value,
 * so server-action forms, `required`, and `onChange(event)` keep working.
 * A leading `<option value="" disabled>` becomes the placeholder.
 * New code can use `Dropdown` directly with an `options` array.
 */
type NativeSelectProps = Omit<React.ComponentProps<"select">, "value" | "defaultValue"> & {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
};

type OptionEl = React.ReactElement<{ value?: string | number; disabled?: boolean; children?: React.ReactNode; label?: string }>;

function collect(children: React.ReactNode, group?: string, out: DropdownOption[] = []) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const el = child as OptionEl;
    if (el.type === React.Fragment) collect(el.props.children, group, out);
    else if (el.type === "optgroup") collect(el.props.children, el.props.label, out);
    else if (el.type === "option") {
      const text = React.Children.toArray(el.props.children).join("");
      out.push({ value: String(el.props.value ?? text), label: text, group, disabled: el.props.disabled });
    }
  });
  return out;
}

function NativeSelect({ children, value, defaultValue, className, ...props }: NativeSelectProps) {
  // A multi-select is a different widget; keep the platform control for it.
  if (props.multiple) {
    return <select {...props} value={value} defaultValue={defaultValue} data-slot="native-select" className={cn(styles.select, className)}>{children}</select>;
  }
  const all = collect(children);
  const isPlaceholder = (o: DropdownOption) => o.value === "" && !!o.disabled;
  const placeholder = all.find(isPlaceholder)?.label;
  const options = all.filter((o) => !isPlaceholder(o));
  return (
    <Dropdown
      {...props}
      size={undefined}
      className={className}
      options={options}
      placeholder={placeholder}
      value={value === undefined ? undefined : String(value)}
      defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
    />
  );
}

export { NativeSelect };
