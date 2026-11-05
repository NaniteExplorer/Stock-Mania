"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmRemoval, type ConfirmRemovalState } from "@/components/ui/confirm-removal";
import { filterFields, parseFilter, phraseMatches, removalPhrase, withExclusions } from "./bulk-scope";
import { removeMatchingTransactionsAction, undoBulkRemovalAction, type BulkRemovalState } from "./actions";

/**
 * The register's bulk bar: "Remove all matching" (DESIGN §7.1), the Undo toast and
 * the session-persistent banner over the emptied table (§7 item 5). The filter
 * travels to the server, never the ids.
 */
const BANNER_KEY = "sm-bulk-removal-banner";

interface Banner {
  requestId: string;
  message: string;
}

const BANNER_EVENT = "sm-bulk-removal-banner-change";

function readBannerRaw(): string | null {
  try {
    return window.sessionStorage.getItem(BANNER_KEY);
  } catch {
    return null;
  }
}

function parseBanner(raw: string | null): Banner | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Banner;
  } catch {
    return null;
  }
}

function subscribeBanner(onChange: () => void) {
  window.addEventListener(BANNER_EVENT, onChange);
  return () => window.removeEventListener(BANNER_EVENT, onChange);
}

export function writeBanner(banner: Banner | null) {
  try {
    if (banner) window.sessionStorage.setItem(BANNER_KEY, JSON.stringify(banner));
    else window.sessionStorage.removeItem(BANNER_KEY);
  } catch {
    /* storage unavailable: the banner just won't survive reload */
  }
  window.dispatchEvent(new Event(BANNER_EVENT));
}

function undoDeadline(): string {
  const until = new Date(Date.now() + 30 * 86_400_000);
  return until.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * The undoable removal this session holds (§7 item 5) and its Undo, through the
 * existing `undoBulkRemovalAction`. Shared by the banner and the register's `Ctrl+Z`
 * (DESIGN §6.1), so both undo the same thing the same way.
 */
export function useRemovalUndo() {
  const router = useRouter();
  const bannerRaw = React.useSyncExternalStore(subscribeBanner, readBannerRaw, () => null);
  const banner = React.useMemo(() => parseBanner(bannerRaw), [bannerRaw]);
  const [undoing, startUndo] = React.useTransition();

  const undo = React.useCallback(
    (requestId: string) =>
      startUndo(async () => {
        const data = new FormData();
        data.set("requestId", requestId);
        const result = await undoBulkRemovalAction(null, data);
        if (result.ok) {
          toast.success(result.message);
          writeBanner(null);
          router.refresh();
        } else {
          toast.error(result.message);
        }
      }),
    [router],
  );
  return { banner, undo, undoing };
}

export interface BulkRemoveProps {
  count: number;
  chips: readonly string[];
  fields: Record<string, string>;
  net: string;
  range: string;
  /** Balance-sheet accounts the removal changes (§7.1 effect). */
  accounts?: readonly string[];
  /** A refusal known on the server before the dialog opens (protected rows, a bad field). */
  preflight?: Pick<ConfirmRemovalState, "message" | "refusal" | "blockedIds"> | null;
  /** Label and link for each row a refusal may name (§7.1: "each linked"). */
  blocked?: Readonly<Record<string, { label: string; href: string }>>;
  /** Controlled open state, when the register's `Del` opens the dialog (§7.1 Keyboard). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function BulkRemove(props: BulkRemoveProps) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = props.open ?? ownOpen;
  const { onOpenChange } = props;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOwnOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const { banner, undo, undoing } = useRemovalUndo();
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const onDone = React.useCallback(
    (state: BulkRemovalState) => {
      if (!state.requestId) return;
      const next = { requestId: state.requestId, message: state.message };
      writeBanner(next);
      setOpen(false);
      toast.success(state.message, { action: { label: "Undo", onClick: () => undo(next.requestId) } });
      router.refresh();
    },
    [router, undo, setOpen],
  );

  // *Filter them out* (§7.1): the same filter plus an exclusion chip, then close.
  const onFilterOut = React.useCallback(
    (ids: readonly string[]) => {
      const next = withExclusions(parseFilter(props.fields), ids);
      if (!next) {
        toast.error("Too many rows to filter out one by one. Narrow the filter instead.");
        return;
      }
      setOpen(false);
      router.push(`/transactions?${new URLSearchParams(filterFields(next))}`);
    },
    [props.fields, router, setOpen],
  );

  const grouped = props.count.toLocaleString("en-IN");
  const blocked = props.blocked;

  return (
    <>
      {banner && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-(--border) px-4 py-3">
          <p className="text-xs text-(--fg)">{banner.message}. One undo restores them all.</p>
          <button type="button" className="ghost-btn h-9 px-3 text-xs" disabled={undoing} onClick={() => undo(banner.requestId)}>
            Undo
          </button>
          <button
            type="button"
            className="text-xs text-(--fg-secondary) hover:underline"
            onClick={() => {
              writeBanner(null);
                }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-4 flex justify-end" role="group" aria-label="Bulk actions">
        <button
          ref={triggerRef}
          type="button"
          className="text-xs text-(--loss) hover:underline"
          onClick={() => setOpen(true)}
        >
          Remove all matching…
        </button>
      </div>

      <ConfirmRemoval
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) triggerRef.current?.focus();
        }}
        count={props.count}
        chips={props.chips}
        net={props.net}
        range={props.range}
        accounts={props.accounts}
        preflight={props.preflight}
        undoNote={`One undo restores all ${grouped}, for 30 days (until ${undoDeadline()}).`}
        phrase={removalPhrase(props.count)}
        phraseMatches={(typed) => phraseMatches(typed, props.count)}
        fields={{ ...props.fields, expectedCount: String(props.count) }}
        action={removeMatchingTransactionsAction}
        onDone={onDone}
        onFilterOut={onFilterOut}
        renderBlocked={(id) => {
          const row = blocked?.[id];
          return row ? <Link href={row.href} className="hover:underline">{row.label}</Link> : id;
        }}
        onReview={() => {
          setOpen(false);
          router.refresh();
          setTimeout(() => setOpen(true), 0);
        }}
      />
    </>
  );
}
