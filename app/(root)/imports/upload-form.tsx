"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { stageStatementAction, type ImportActionState } from "./actions";

export interface AccountOption {
  id: string;
  label: string;
}

/**
 * Step one of the wizard: choose an account, choose a file.
 *
 * Deliberately does not post anything. Uploading stages rows for review, and the
 * copy says so — a user who expects an upload to have changed their balances
 * would not check the review screen, which is where the duplicate claims are.
 */
export default function UploadForm({ accounts }: { accounts: readonly AccountOption[] }) {
  const [state, action, pending] = React.useActionState<ImportActionState | null, FormData>(
    stageStatementAction,
    null,
  );

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field name="accountId" label="Account" required>
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
      >
        {(props) => (
          <input
            {...props}
            name="file"
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.ofx,.qfx"
            className="form-input py-2.5"
            required
          />
        )}
      </Field>

      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending || accounts.length === 0}>
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
