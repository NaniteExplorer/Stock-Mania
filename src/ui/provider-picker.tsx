"use client";

import * as React from "react";
import { FINANCIAL_PROVIDERS, findFinancialProvider, type FinancialProvider, type ProviderKind } from "./providers";

/**
 * The institution field: a searchable list of banks, brokers and wallets with
 * their logos, over a plain text input.
 *
 * The registry and the logo proxy came across from v1 (`src/ui/providers.ts`
 * says so in its own header) but nothing consumed them, so every institution
 * field in v2 was a bare textbox — the same bank arriving as "HDFC", "hdfc bank"
 * and "HDFC Bank Ltd" in three places, with no logo anywhere.
 *
 * Deliberately still a **text input**, not a `<select>`. `institution` is stored
 * as a string and always has been; a select would force every bank not on the
 * list into an "Other" that loses the name. So the list narrows as you type and
 * picking one fills the name in, while typing your own co-operative bank works
 * exactly as before. No schema, action or domain change — this is a UI affordance
 * over a field that already existed.
 */
export function ProviderPicker({
  name,
  defaultValue = "",
  kinds,
  placeholder,
  id,
  ...aria
}: {
  name: string;
  defaultValue?: string;
  /** Which slice of the registry to offer. Omitted, all of it. */
  kinds?: readonly ProviderKind[];
  placeholder?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const box = React.useRef<HTMLDivElement>(null);
  const listId = `${id ?? name}-provider-list`;

  const catalogue = React.useMemo(
    () => (kinds ? FINANCIAL_PROVIDERS.filter((provider) => kinds.includes(provider.kind)) : FINANCIAL_PROVIDERS),
    [kinds],
  );

  /*
   * Matching is on name, short name and alias — so "uti" finds Axis and "kite"
   * finds Zerodha. The same three fields `findFinancialProvider` uses, because a
   * picker that finds a bank the resolver then cannot resolve is worse than no
   * picker.
   */
  const matches = React.useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (!needle) return catalogue;
    return catalogue.filter(
      (provider) =>
        provider.name.toLowerCase().includes(needle) ||
        provider.shortName.toLowerCase().includes(needle) ||
        provider.aliases.some((alias) => alias.includes(needle)),
    );
  }, [catalogue, value]);

  // What the typed text currently resolves to, for the badge inside the input.
  const resolved = React.useMemo(() => findFinancialProvider(value), [value]);

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  const choose = (provider: FinancialProvider) => {
    setValue(provider.name);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) => {
        const next = current + step;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
      return;
    }
    // Enter picks the highlighted row, but only with the list open — otherwise it
    // must submit the form, which is what Enter in a text field means.
    if (event.key === "Enter" && open && matches[highlighted]) {
      event.preventDefault();
      choose(matches[highlighted]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <div className="relative">
        {resolved && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
            <ProviderMark provider={resolved} size={20} />
          </span>
        )}
        <input
          {...aria}
          id={id}
          name={name}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`form-input ${resolved ? "!pl-10" : ""}`}
          placeholder={placeholder ?? "Search or type a name"}
          autoComplete="off"
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          aria-autocomplete="list"
        />
      </div>

      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl"
        >
          {matches.map((provider, index) => (
            <li key={provider.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(provider)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                  index === highlighted ? "bg-gray-800 text-gray-50" : "text-gray-300"
                }`}
              >
                <ProviderMark provider={provider} size={22} />
                <span className="flex-1 truncate">{provider.name}</span>
                <span className="text-xs text-gray-500">{provider.shortName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A provider's logo, or our own badge when there isn't one.
 *
 * The proxy returns 404 rather than a guess when it has no real logo, so the
 * fallback here is the branded initials on the provider's own colours — never
 * some other bank's mark, and never a broken image.
 */
export function ProviderMark({ provider, size = 24 }: { provider: FinancialProvider; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  const box = { width: size, height: size };

  if (failed || (!provider.logo && !provider.domain)) {
    return (
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-white"
        style={{
          ...box,
          background: `linear-gradient(135deg, ${provider.colors[0]}, ${provider.colors[1]})`,
        }}
      >
        {provider.shortName.slice(0, 4)}
      </span>
    );
  }

  return (
    // Plain <img>: the source is our own cached proxy route, which already
    // normalises to 128px and caches for a week, so next/image's optimiser would
    // be a second cache in front of a cache — and it cannot help here anyway,
    // because it has no build-time knowledge of a 24px runtime badge.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/logo/${provider.id}`}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md bg-white/5 object-contain"
      style={box}
    />
  );
}

/**
 * A logo for a stored institution *name*, for lists and detail headers.
 *
 * Takes the string the account actually holds, because that is what we store —
 * resolution happens here rather than at write time, so an account saved before
 * this picker existed ("hdfc bank ltd") still gets its logo, and a name that
 * resolves to nothing renders nothing rather than a placeholder pretending to be
 * a bank.
 */
export function InstitutionMark({
  institution,
  size = 24,
}: {
  institution?: string | null;
  size?: number;
}) {
  const provider = findFinancialProvider(institution);
  if (!provider) return null;
  return <ProviderMark provider={provider} size={size} />;
}
