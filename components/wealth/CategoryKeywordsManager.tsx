"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tags, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveCategoryRules } from "@/features/transactions/transaction.actions";
import { TRANSACTION_CATEGORIES, categoryLabel } from "@/features/transactions/transaction.categories";

interface Rule {
  keyword: string;
  category: string;
}

export default function CategoryKeywordsManager({ initialRules }: { initialRules: Rule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules.length ? initialRules : []);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string>(TRANSACTION_CATEGORIES[1] ?? "MISCELLANEOUS");
  const [pending, startTransition] = useTransition();

  const addRule = () => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    // Replace an existing rule for the same keyword rather than duplicating it.
    setRules((current) => [
      ...current.filter((rule) => rule.keyword.toLowerCase() !== trimmed.toLowerCase()),
      { keyword: trimmed, category },
    ]);
    setKeyword("");
  };

  const removeRule = (target: Rule) =>
    setRules((current) => current.filter((rule) => rule !== target));

  const save = () =>
    startTransition(async () => {
      const result = await saveCategoryRules(rules);
      if (!result.success) {
        toast.error("Could not save keywords", { description: result.error });
        return;
      }
      toast.success("Keywords saved", {
        description: `${result.recategorized ?? 0} transaction(s) re-categorized.`,
      });
      router.refresh();
    });

  return (
    <section className="panel flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="icon-chip"><Tags className="h-5 w-5" /></span>
        <div>
          <h2 className="text-base font-semibold text-gray-100">Category keywords</h2>
          <p className="text-xs text-gray-500">
            When a transaction&apos;s narration contains a keyword, it&apos;s filed under that category.
            Your keywords win over the built-in merchant defaults. Saving re-categorizes every non-manual transaction.
          </p>
        </div>
      </div>

      {/* Add a new rule */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-40">
          <label className="form-label">Keyword</label>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRule(); } }}
            placeholder="e.g. dipika, gas bi, swiggy"
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
            suppressHydrationWarning
          />
        </div>
        <div className="min-w-44">
          <label className="form-label">Category</label>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="select-trigger w-full">
            {TRANSACTION_CATEGORIES.map((cat) => <option key={cat} value={cat}>{categoryLabel(cat)}</option>)}
          </select>
        </div>
        <button type="button" onClick={addRule} disabled={!keyword.trim()} className="btn-brand h-10 px-4 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      {/* Existing rules */}
      {rules.length ? (
        <ul className="flex flex-col divide-y divide-gray-700 rounded-lg border border-gray-700">
          {rules.map((rule) => (
            <li key={rule.keyword} className="flex items-center gap-3 px-3 py-2">
              <span className="truncate font-mono text-sm text-gray-200">{rule.keyword}</span>
              <span className="ml-auto rounded-md bg-gray-800 px-2 py-0.5 text-xs text-gray-300">{categoryLabel(rule.category)}</span>
              <button type="button" onClick={() => removeRule(rule)} className="text-gray-500 transition-colors hover:text-red-400" aria-label={`Remove ${rule.keyword}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-xs text-gray-500">
          No keyword rules yet. Add one above — e.g. a payee name or purpose note that appears in your statements.
        </p>
      )}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-md border border-brand-600 bg-brand-500/10 py-2.5 text-sm font-semibold text-brand-400 transition-colors hover:bg-brand-500/20 disabled:opacity-50"
        suppressHydrationWarning
      >
        {pending ? "Saving & re-categorizing…" : "Save keywords & re-categorize"}
      </button>
    </section>
  );
}
