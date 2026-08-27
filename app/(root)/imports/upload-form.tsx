"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { stageStatementAction, type ImportActionState } from "./actions";

export interface AccountOption {
  id: string;
  label: string;
}

/** Roughly the server action body-size limit, checked before the upload starts. */
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Step one of the wizard: choose an account, choose a file.
 *
 * Deliberately does not post anything. Uploading stages rows for review, and the
 * copy says so — a user who expects an upload to have changed their balances
 * would not check the review screen, which is where the duplicate claims are.
 *
 * The size check is done here rather than left to the server: a 12 MB file that
 * is going to be rejected by the body-size limit should be rejected *before*
 * it is uploaded over a slow connection, not after.
 */
export default function UploadForm({ accounts }: { accounts: readonly AccountOption[] }) {
  const [state, action, pending] = React.useActionState<ImportActionState | null, FormData>(
    stageStatementAction,
    null,
  );
  const [chosen, setChosen] = React.useState<File | null>(null);
  const errors = state?.fieldErrors ?? {};

  const tooBig = chosen !== null && chosen.size > MAX_BYTES;
  // The server only reports a hash clash after the whole file has been read, so
  // the retry affordance appears once that has actually happened.
  const wasDuplicate = state?.ok === false && state.message.includes("already been imported");

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field name="accountId" label="Account" required error={errors.accountId?.[0]}>
        {(props) => (
          <select {...props} name="accountId" className="form-input" required defaultValue="">
            <option value="" disabled>
              Choose an account
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        name="file"
        label="Statement file"
        hint="CSV, TSV, XLSX, XLS, OFX or QFX. Amounts are read as exact decimals."
        required
        error={tooBig ? "That file is over 3 MB. Split it, or export a shorter date range." : errors.file?.[0]}
      >
        {(props) => (
          <input
            {...props}
            name="file"
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.ofx,.qfx"
            className="form-input py-2.5"
            required
            onChange={(event) => setChosen(event.target.files?.[0] ?? null)}
          />
        )}
      </Field>

      {chosen && !tooBig && (
        <p className="text-xs text-gray-500 md:col-span-2">
          {chosen.name} · {(chosen.size / 1024).toFixed(0)} KB
        </p>
      )}

      {wasDuplicate && (
        <label className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-gray-300 md:col-span-2">
          <input type="checkbox" name="allowReimport" className="mt-0.5 h-4 w-4 accent-brand-500" />
          <span>
            <span className="font-medium text-gray-100">Import it anyway.</span> These exact bytes
            were staged before. Tick this only if you meant to import the same statement a second
            time — the row-level duplicate checks still run, so anything already in your ledger will
            still be flagged.
          </span>
        </label>
      )}

      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="btn-glow"
          disabled={pending || tooBig || accounts.length === 0}
        >
          {pending ? "Reading…" : "Stage for review"}
        </button>
        <p className="text-xs text-gray-500">
          Nothing is added to the ledger until you confirm it on the next screen.
        </p>
        {state && !state.ok && (
          <p className="text-sm text-red-500" role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
