"use client";

import * as React from "react";
import { InstitutionMark } from "@/ui/provider-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { stageStatementAction, type ImportActionState } from "./actions";

export interface AccountOption {
  id: string;
  label: string;
  /** The stored institution name, for the mark beside the chosen account (never inside an <option>). */
  institution?: string | null;
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
  const fileInput = React.useRef<HTMLInputElement>(null);
  const errors = state?.fieldErrors ?? {};
  const [accountId, setAccountId] = React.useState("");
  const target = accounts.find((account) => account.id === accountId);

  const tooBig = chosen !== null && chosen.size > MAX_BYTES;
  // The server only reports a hash clash after the whole file has been read, so
  // the retry affordance appears once that has actually happened.
  const wasDuplicate = state?.ok === false && state.message.includes("already been imported");
  const locked = state?.needsPassword;
  const unreconciled = state?.needsOverride === true;

  /*
   * Put the chosen file back after a submit that asked for more information.
   *
   * React resets an uncontrolled form once its action resolves, which is right
   * for a form that succeeded and wrong for every one of ours that comes back
   * asking for a password or a re-import tick: the user answers the question,
   * presses the button, and is told to choose a file — the one still named on
   * screen. `chosen` already holds it, so the input can simply be refilled.
   *
   * Guarded on the input being empty, so if React ever stops resetting, this
   * quietly does nothing rather than fighting it.
   */
  React.useEffect(() => {
    const input = fileInput.current;
    if (!input || !chosen || input.files?.length) return;
    const transfer = new DataTransfer();
    transfer.items.add(chosen);
    input.files = transfer.files;
  }, [state, chosen]);

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field name="accountId" label="Account" required error={errors.accountId?.[0]}>
        {(props) => (
          <NativeSelect
            {...props}
            name="accountId"
            required
            defaultValue=""
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      {target?.institution && (
        <p className="md:col-span-2 -mt-2 flex items-center gap-2 text-xs text-(--fg-secondary)" data-testid="import-account-institution">
          <InstitutionMark institution={target.institution} size={20} />
          {target.institution}
        </p>
      )}

      <Field
        name="file"
        label="Statement file"
        hint="CSV, TSV, XLSX, XLS, PDF, OFX or QFX. A password-protected PDF is fine — you will be asked for the password. Amounts are read as exact decimals."
        required
        error={tooBig ? "That file is over 3 MB. Split it, or export a shorter date range." : errors.file?.[0]}
      >
        {(props) => (
          <Input
            {...props}
            ref={fileInput}
            name="file"
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.ofx,.qfx"
            required
            onChange={(event) => setChosen(event.target.files?.[0] ?? null)}
          />
        )}
      </Field>

      {chosen && !tooBig && (
        <p className="text-xs text-(--fg-muted) md:col-span-2">
          {chosen.name} · {(chosen.size / 1024).toFixed(0)} KB
        </p>
      )}

      {locked && (
        <Field
          name="pdfPassword"
          label="PDF password"
          hint="Used once to open the file. It is not saved, and never leaves this import."
          error={locked === "retry" ? "That password did not open the file." : undefined}
        >
          {(props) => (
            <Input
              {...props}
              name="pdfPassword"
              type="password"
              autoComplete="off"
              placeholder="The password the bank sent with the statement"
              required
              autoFocus
            />
          )}
        </Field>
      )}

      {unreconciled && (
        <div className="md:col-span-2 rounded-xl border border-(--loss)/30 bg-(--loss)/5 p-3">
          <Checkbox name="importAnyway" label={
            <span>
              <span className="font-medium text-(--fg)">Import it anyway.</span> The rows were
              read, but they do not add up to the balance the bank printed. Every row after the
              break is suspect. Tick this only if you know why the statement disagrees with itself
              &mdash; a reversal the bank printed oddly, or a genuine error on their side.
            </span>
          } />
          <Input
            name="overrideReason"
            type="text"
            className="mt-2"
            placeholder="Why is this statement safe to import?"
            maxLength={200}
          />
          <p className="mt-1.5 text-xs text-(--fg-muted)">
            The reason is stored with the import, so this batch stays explicable later.
          </p>
        </div>
      )}

      {wasDuplicate && (
        <div className="md:col-span-2">
          <Checkbox name="allowReimport" label={<span>
            <span className="font-medium text-(--fg)">Import it anyway.</span> These exact bytes
            were staged before. Tick this only if you meant to import the same statement a second
            time — the row-level duplicate checks still run, so anything already in your ledger will
            still be flagged.
          </span>} />
        </div>
      )}

      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          loading={pending}
          disabled={pending || tooBig || accounts.length === 0}
        >
          Stage for review
        </Button>
        <p className="text-xs text-(--fg-muted)">
          Nothing is added to the ledger until you confirm it on the next screen.
        </p>
        {state && !state.ok && (
          <p className="text-sm text-(--loss)" role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** A library Label over its control, with the hint or error the control is described by. */
function Field({
  name,
  label,
  hint,
  error,
  required = false,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => React.ReactNode;
}) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-(--loss)" aria-hidden>*</span>}
      </Label>
      {children({ id: name, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-(--loss)">{error}</p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-xs text-(--fg-muted)">{hint}</p>
      ) : null}
    </div>
  );
}
