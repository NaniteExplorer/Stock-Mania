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
import { Pencil, Plus, Trash2 } from "lucide-react";

export interface WealthField {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  required?: boolean;
  placeholder?: string;
  step?: string;
  prefix?: string;
  options?: { value: string; label: string }[];
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
      <div className="flex justify-end">
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
          {items.map((item) => (
            <li key={item.id} className="panel flex items-center gap-3 p-4">
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
              Stored privately to your account. Values are used to compute your net worth.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="mt-1 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.name} className={f.half ? "" : "col-span-full"}>
                <label className="form-label">{f.label}</label>
                {f.type === "select" ? (
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
                    />
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
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
