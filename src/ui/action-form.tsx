"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ActionState } from "./action-state";

export type ServerAction = (
  previous: ActionState | null,
  formData: FormData,
) => Promise<ActionState>;

export interface ConfirmSpec {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  tone?: "danger" | "normal";
}

interface ActionFormProps {
  action: ServerAction;
  /** Hidden inputs written into the form — the usual `{ accountId }` case. */
  fields?: Record<string, string | undefined>;
  /**
   * Rendered inside the form.
   *
   * Plain nodes, never a render prop. This component is a Client Component and
   * most of its callers are Server Components: a function child cannot cross
   * that boundary — only server actions can be serialised — and React rejects it
   * with "Functions are not valid as a child of Client Components". The pending
   * state a render prop would have supplied is read by {@link SubmitButton} from
   * `useFormStatus` instead, which is what that hook is for.
   */
  children: React.ReactNode;
  /** When set, submission is gated behind a modal the user has to accept. */
  confirm?: ConfirmSpec;
  className?: string;
  /** Suppress the success toast — for forms that show their result inline. */
  quiet?: boolean;
  onResult?: (state: ActionState) => void;
}

/**
 * A `<form>` bound to a server action, with pending state, a toast for the
 * result and an optional confirmation modal.
 *
 * The confirmation is deliberately part of *this* component rather than a
 * wrapper around the button: gating a `<button type="submit">` from outside the
 * form leaves a keyboard user able to submit with Enter and skip the dialog
 * entirely. Here the form's own `onSubmit` is what the dialog intercepts, so
 * every path into the action passes through it.
 */
export function ActionForm({
  action,
  fields,
  children,
  confirm,
  className,
  quiet = false,
  onResult,
}: ActionFormProps) {
  const [state, formAction] = React.useActionState<ActionState | null, FormData>(
    (previous, formData) => action(previous, formData),
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);
  const [asking, setAsking] = React.useState(false);
  const accepted = React.useRef(false);
  const reported = React.useRef<ActionState | null>(null);
  // Which button was pressed. `requestSubmit()` with no argument submits as if
  // no button had been used, which drops that button's own name/value — so a
  // confirmed `<button name="decision" value="CONFIRM">` would arrive at the
  // server with no decision at all.
  const submitter = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    // useActionState keeps the last result forever; without this guard the
    // toast re-fires on every unrelated re-render of the parent table.
    if (!state || reported.current === state) return;
    reported.current = state;
    if (state.ok) {
      if (!quiet) toast.success(state.message);
    } else {
      toast.error(state.message);
    }
    onResult?.(state);
  }, [state, quiet, onResult]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!confirm || accepted.current) {
      accepted.current = false;
      return;
    }
    const pressed = (event.nativeEvent as SubmitEvent).submitter;
    submitter.current = pressed instanceof HTMLElement ? pressed : null;
    event.preventDefault();
    setAsking(true);
  }

  function accept() {
    accepted.current = true;
    setAsking(false);
    const button = submitter.current;
    formRef.current?.requestSubmit(
      button instanceof HTMLButtonElement || button instanceof HTMLInputElement
        ? button
        : undefined,
    );
  }

  return (
    <>
      <form ref={formRef} action={formAction} onSubmit={handleSubmit} className={className}>
        {Object.entries(fields ?? {}).map(([name, value]) =>
          value === undefined ? null : (
            <input key={name} type="hidden" name={name} value={value} />
          ),
        )}
        {children}
      </form>

      {confirm && (
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent className="border-gray-600 bg-gray-800 text-gray-100">
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription className="text-gray-400">{confirm.body}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                className="ghost-btn h-10 px-4 text-xs"
                onClick={() => setAsking(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={accept}
                className={cn(
                  "ghost-btn h-10 px-4 text-xs",
                  confirm.tone === "danger" && "border-red-500/40 text-red-300 hover:border-red-500/70",
                )}
              >
                {confirm.confirmLabel}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * A submit button that shows its own form's pending state.
 *
 * `useFormStatus` reports on the nearest enclosing `<form>`, which is why this
 * has to be a separate component rather than a branch inside {@link ActionForm}:
 * the hook returns `pending: false` when called by the component that renders
 * the form, and only sees the submission from inside it.
 */
export function SubmitButton({
  children,
  icon,
  className,
  disabled,
  tone = "ghost",
  ...rest
}: {
  children: React.ReactNode;
  /**
   * A rendered element — `icon={<Save aria-hidden />}` — never the component
   * itself.
   *
   * `icon={Save}` would pass a `forwardRef` object across the RSC boundary from
   * every Server Component that uses this button, and a component reference is
   * not serialisable: React rejects it with "Only plain objects can be passed to
   * Client Components". An *element* is fine, because it has already been
   * rendered by the time it is serialised. Sizing is applied by the button, so
   * call sites do not repeat it.
   */
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  tone?: "ghost" | "primary" | "danger";
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "disabled" | "children">) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={cn(
        tone === "primary" ? "btn-glow" : "ghost-btn",
        tone === "danger" && "text-red-300",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Sizes whichever icon lands inside, the spinner included, so no call
        // site has to restate it.
        "[&>svg]:h-3.5 [&>svg]:w-3.5",
        className,
      )}
      {...rest}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
