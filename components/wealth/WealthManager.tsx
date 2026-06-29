"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ArrowUpDown, Pencil, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import ProviderCombobox from "./ProviderCombobox";

export interface WealthField {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "provider";
  required?: boolean;
  placeholder?: string;
  step?: string;
  prefix?: string;
  options?: { value: string; label: string }[];
  suggestions?: string[];
  half?: boolean;
}

type Values = Record<string, string>;
type Result = { success: boolean; error?: string };

interface Props<T extends { id: string }> {
  items: T[];
  fields: WealthField[];
  addLabel: string;
  dialogTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  toValues: (item: T) => Values;
  renderRow: (item: T) => React.ReactNode;
  onCreate: (values: Values) => Promise<Result>;
  onUpdate: (id: string, values: Values) => Promise<Result>;
  onDelete: (id: string) => Promise<Result>;
}

/**
 * Generic, config-driven CRUD surface shared by all wealth pages (accounts,
 * investments, ESOPs, assets). A thin per-feature wrapper (e.g. AccountsManager)
 * supplies:
 *   - `fields`     — the form schema (text/number/date/select),
 *   - `renderRow`  — how each item looks in the list,
 *   - `toValues`   — item → form values (for editing),
 *   - `onCreate/onUpdate/onDelete` — the feature's "use server" actions.
 *
 * This component owns all the interaction state (dialog open/edit/submit),
 * toasts and `router.refresh()` — so the wrappers stay declarative and tiny.
 */
const emptyValues = (fields: WealthField[]): Values => {
  const v: Values = {};
  for (const f of fields) v[f.name] = f.type === "select" ? f.options?.[0]?.value ?? "" : "";
  return v;
};

export default function WealthManager<T extends { id: string }>({
  items,
  fields,
  addLabel,
  dialogTitle,
  emptyTitle,
  emptyDescription,
  toValues,
  renderRow,
  onCreate,
  onUpdate,
  onDelete,
}: Props<T>) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [values, setValues] = React.useState<Values>(emptyValues(fields));
  const [submitting, setSubmitting] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [ascending, setAscending] = React.useState(true);

  const visibleItems = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => !needle || Object.values(toValues(item)).some((value) => value.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const firstField = fields[0]?.name ?? "";
        const left = toValues(a)[firstField] ?? "";
        const right = toValues(b)[firstField] ?? "";
        return left.localeCompare(right) * (ascending ? 1 : -1);
      });
  }, [ascending, fields, items, query, toValues]);

  const openCreate = () => {
    setEditingId(null);
    setValues(emptyValues(fields));
    setOpen(true);
  };

  const openEdit = (item: T) => {
    setEditingId(item.id);
    setValues({ ...emptyValues(fields), ...toValues(item) });
    setOpen(true);
  };

  const setField = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = editingId ? await onUpdate(editingId, values) : await onCreate(values);
      if (res.success) {
        toast.success(editingId ? "Updated" : "Added");
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Something went wrong", { description: res.error });
      }
    } catch (err) {
      toast.error("Something went wrong", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this record? This action cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await onDelete(id);
      if (res.success) {
        toast.success("Deleted");
        router.refresh();
      } else {
        toast.error("Could not delete", { description: res.error });
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-600 bg-gray-800 p-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records" className="form-input h-10 w-full !pl-10" aria-label="Search records" />
        </div>
        <button type="button" onClick={() => setAscending((value) => !value)} className="ghost-btn h-10 px-3" aria-label="Change sort direction">
          <ArrowUpDown className="h-4 w-4" /> {ascending ? "A–Z" : "Z–A"}
        </button>
        <button
          onClick={openCreate}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-yellow-500 px-4 text-sm font-semibold text-white transition-colors hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> {addLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-base font-semibold text-gray-100">{emptyTitle}</p>
          <p className="max-w-sm text-sm text-gray-500">{emptyDescription}</p>
          <button
            onClick={openCreate}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-yellow-500 px-4 text-sm font-semibold text-white transition-colors hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> {addLabel}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleItems.map((item) => (
            <li key={item.id} className="cockpit-panel flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">{renderRow(item)}</div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => openEdit(item)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-600 bg-gray-700/40 text-gray-400 transition-colors hover:text-yellow-500"
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(item.id)}
                  disabled={deletingId === item.id}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-600 bg-gray-700/40 text-gray-400 transition-colors hover:text-red-500 disabled:opacity-50"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-gray-600 bg-gray-800 text-gray-400">
          <DialogHeader>
            <DialogTitle className="text-gray-100">
              {editingId ? `Edit ${dialogTitle}` : `Add ${dialogTitle}`}
            </DialogTitle>
            <DialogDescription>
            Stored privately and used to compute net worth. Manually entered valuations are treated as estimates.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="mt-1 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.name} className={f.half ? "" : "col-span-full"}>
                <label className="form-label">{f.label}</label>
                {f.type === "provider" ? (
                  <ProviderCombobox
                    value={values[f.name] ?? ""}
                    onChange={(value) => setField(f.name, value)}
                    placeholder={f.placeholder}
                  />
                ) : f.type === "select" ? (
                  <select
                    value={values[f.name] ?? ""}
                    onChange={(e) => setField(f.name, e.target.value)}
                    required={f.required}
                    className="select-trigger mt-1.5"
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="relative mt-1.5">
                    {f.prefix && (
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                        {f.prefix}
                      </span>
                    )}
                    <input
                      type={f.type}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                      step={f.step}
                      value={values[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                      required={f.required}
                      placeholder={f.placeholder}
                      className={`form-input w-full ${f.prefix ? "pl-7" : ""}`}
                      list={f.suggestions ? `${f.name}-suggestions` : undefined}
                    />
                    {f.suggestions && <datalist id={`${f.name}-suggestions`}>{f.suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>}
                  </div>
                )}
              </div>
            ))}

            <div className="col-span-full mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ghost-btn h-11 px-5"
              >
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="yellow-btn px-6">
                {submitting ? "Saving…" : editingId ? "Save changes" : "Add"}
              </button>
            </div>
            <div className="col-span-full flex items-center gap-2 border-t border-gray-600 pt-4 text-xs text-gray-500">
              <ShieldCheck className="h-4 w-4 text-green-500" /> Private to your account · values can be updated anytime
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
