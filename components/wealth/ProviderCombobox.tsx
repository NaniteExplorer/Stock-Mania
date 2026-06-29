"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { FINANCIAL_PROVIDERS, findFinancialProvider } from "@/lib/financial-providers";
import ProviderMark from "./ProviderMark";

/**
 * Searchable bank/institution picker. Search "HDFC" and the bank's name +
 * badge appear; selecting writes the provider name back. Free text is still
 * allowed so unlisted institutions can be entered.
 */
export default function ProviderCombobox({
  value,
  onChange,
  placeholder = "Search HDFC, SBI, ICICI…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = findFinancialProvider(value);

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return FINANCIAL_PROVIDERS;
    return FINANCIAL_PROVIDERS.filter((provider) =>
      [provider.name, provider.shortName, ...provider.aliases].some((token) =>
        token.toLowerCase().includes(needle),
      ),
    );
  }, [query]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="form-input mt-1.5 flex w-full items-center gap-2 text-left">
          {value ? (
            <>
              <ProviderMark providerId={selected?.id} institution={value} className="h-6 w-6" />
              <span className="truncate text-gray-200">{value}</span>
            </>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] border-gray-600 bg-gray-800 p-0" align="start">
        <Command shouldFilter={false} className="bg-gray-800">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search institution…" />
          <CommandList>
            <CommandEmpty>
              {query.trim() ? (
                <button type="button" onClick={() => choose(query.trim())} className="w-full px-2 py-1.5 text-left text-sm text-yellow-400">
                  Use “{query.trim()}”
                </button>
              ) : (
                "No institutions found."
              )}
            </CommandEmpty>
            <CommandGroup>
              {matches.map((provider) => (
                <CommandItem key={provider.id} value={provider.name} onSelect={() => choose(provider.name)} className="gap-2">
                  <ProviderMark providerId={provider.id} className="h-7 w-7" />
                  <span className="flex-1 truncate">{provider.name}</span>
                  <span className="text-xs text-gray-500">{provider.country}</span>
                  {value === provider.name && <Check className="h-4 w-4 text-yellow-500" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
