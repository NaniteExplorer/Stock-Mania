"use client";

import * as React from "react";
import { toast } from "sonner";
import { Panel } from "../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useTableKeyboard } from "../../../components/ui/use-table-keyboard";
import { CONTROL_ACTIVATION_KEYS, isRowControlTarget, type KeyTarget } from "../../../components/ui/table-keyboard";
import type { ActivityDayView } from "./activity-model";
import { ACTIVITY_KEY_REFUSALS, activityTableRows, redoTarget, undoTarget } from "./activity-keyboard";
import styles from "./activity.module.css";

/** A verb the keyboard asked one row to perform; `nonce` makes a repeat press a new request. */
export interface ActivityCommand {
  readonly requestId: string;
  readonly verb: "undo" | "redo";
  readonly nonce: number;
}

/**
 * How the grid reaches a row's own verbs. `RowActions` reads it: `undo` opens that row's
 * inline confirmation with focus on its Undo button, `redo` submits its Redo form. The
 * keyboard therefore adds no mutation path; it presses the controls already there.
 */
export const ActivityCommandContext = React.createContext<{
  command: ActivityCommand | null;
  returnFocus: () => void;
}>({ command: null, returnFocus: () => {} });

const BINDINGS: readonly (readonly [string, string])[] = [
  ["↑ ↓ · Home End", "Move between changes"],
  ["Enter", "Move to the change's Undo / Redo"],
  ["Ctrl+Z", "Undo the newest undoable change (asks first)"],
  ["Ctrl+Y", "Redo the change this session can redo"],
  ["Esc", "Leave the table"],
];

/**
 * The Activity list as one keyboard grid (DESIGN §9e, §6.1; task 2.8.b): one tab stop,
 * day headings as heading rows, columns Time · What happened · Class · Records ·
 * Undo/Redo, inside a §9b flush panel. `verbs` are the rows' `RowActions`, rendered by
 * the server page and placed here.
 */
export function ActivityGrid({
  days,
  total,
  redoNotice,
  verbs,
}: {
  days: readonly ActivityDayView[];
  total: number;
  redoNotice: string | null;
  verbs: Readonly<Record<string, React.ReactNode>>;
}) {
  const rows = React.useMemo(() => activityTableRows(days), [days]);
  const undo = undoTarget(days);
  const redo = redoTarget(days, redoNotice);
  const [command, setCommand] = React.useState<ActivityCommand | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [help, setHelp] = React.useState(false);
  const gridRef = React.useRef<HTMLTableElement>(null);
  const nonce = React.useRef(0);

  const refuse = React.useCallback((reason: string) => {
    setNotice(reason);
    toast(reason);
  }, []);
  const send = (verb: ActivityCommand["verb"], requestId: string | null) => {
    if (requestId) setCommand({ requestId, verb, nonce: ++nonce.current });
  };

  const keyboard = useTableKeyboard({
    idPrefix: "activity",
    rows,
    filtered: false,
    undo: undo.availability,
    redo: redo.availability,
    onEdit: () => refuse(ACTIVITY_KEY_REFUSALS.edit),
    onRemove: () => refuse(ACTIVITY_KEY_REFUSALS.remove),
    onUndo: () => send("undo", undo.requestId),
    onRedo: () => send("redo", redo.requestId),
    onOpen: (id) => {
      const row = document.getElementById(keyboard.rowId(id));
      row?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    },
    onHelp: () => setHelp((open) => !open),
    onRefuse: (_verb, reason) => toast(reason),
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    // Space / Enter on a row control are left to the control by `useTableKeyboard` (Batch 5);
    // the notice survives them, as before.
    if (!(CONTROL_ACTIVATION_KEYS.has(event.key) && isRowControlTarget(event.target as unknown as KeyTarget, event.currentTarget))) setNotice(null);
    keyboard.gridProps.onKeyDown(event);
  };
  const context = React.useMemo(() => ({ command, returnFocus: () => gridRef.current?.focus() }), [command]);

  let index = -1;
  return (
    <ActivityCommandContext.Provider value={context}>
      <span className={styles.srOnly} {...keyboard.liveRegionProps}>{notice ?? keyboard.announcement}</span>
      {help && (
        <section aria-label="Keyboard bindings for Activity" className={styles.help}>
          <dl>
            {BINDINGS.map(([keys, effect]) => (
              <div key={keys}><dt>{keys}</dt><dd>{effect}</dd></div>
            ))}
          </dl>
        </section>
      )}
      <Panel flush title={`${total} ${total === 1 ? "change" : "changes"} in the last 30 days`}>
        <Table
          ref={gridRef}
          {...keyboard.gridProps}
          onKeyDown={onKeyDown}
          aria-label="Activity, newest first. Ctrl+Z undoes, Ctrl+Y redoes, ? lists every key."
          className={styles.grid}
        >
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>What happened</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Records</TableHead>
              <TableHead>Undo / Redo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => {
              const heading = rows[++index];
              return (
                <React.Fragment key={day.heading}>
                  <TableRow {...keyboard.rowProps(heading, index)} className={styles.dayRow}>
                    <TableHead scope="colgroup" colSpan={5}>{day.heading}</TableHead>
                  </TableRow>
                  {day.rows.map((row) => {
                    const at = ++index;
                    return (
                      <TableRow key={row.requestId} {...keyboard.rowProps(rows[at], at)} data-request={row.requestId}
                        data-state={keyboard.selected.includes(row.requestId) ? "selected" : undefined}>
                        <TableCell className={styles.time}>{row.time}</TableCell>
                        <TableCell><div className={styles.what}>{row.what}<span className={styles.note}> · {row.who}</span></div></TableCell>
                        <TableCell><span className={styles.chip}>{row.classLabel}</span></TableCell>
                        <TableCell className={styles.note}>{row.records}</TableCell>
                        <TableCell>{verbs[row.requestId]}</TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Panel>
    </ActivityCommandContext.Provider>
  );
}
