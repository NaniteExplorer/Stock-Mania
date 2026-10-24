/* Stock-Mania — one mutation model for the whole app.
   Mockup only. No production code. Control Bench tokens lifted unchanged. */

/* ── formatting ───────────────────────────────────────────────── */
const MINUS = "−";
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function rupee(paise, { signed = false } = {}) {
  const neg = paise < 0;
  const s = "₹" + inr.format(Math.abs(paise) / 100);
  if (neg) return MINUS + s;
  return signed ? "+" + s : s;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ── icons ────────────────────────────────────────────────────── */
const I = {
  kebab: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.2" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="12.8" r="1.3"/></svg>',
  pencil: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M11.2 2.3l2.5 2.5L5.4 13.1l-3.1.6.6-3.1z"/></svg>',
  undo: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6.5a3.5 3.5 0 110 7H6"/><path d="M5.6 4.4L3 7l2.6 2.6"/></svg>',
  redo: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7H6.5a3.5 3.5 0 100 7H10"/><path d="M10.4 4.4L13 7l-2.6 2.6"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4.2 4.2l.7 8.3h6.2l.7-8.3"/></svg>',
  broom: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.2l3.3 3.3M9.4 3.3L5.1 7.6l3.3 3.3 4.3-4.3"/><path d="M5.1 7.6L2.4 12.4l4.8-2.7"/></svg>',
  check: '<svg class="ck" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.4 2.4L9.5 3.6"/></svg>',
  dash: '<svg class="ix" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h6"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 2.4L14.4 13.4H1.6z" stroke-linejoin="round"/><path d="M8 6.4v3.1M8 11.6v.1"/></svg>',
  info: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.3v4M8 4.9v.1"/></svg>',
  ok: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.2l2 2 3.6-4.2"/></svg>',
  lock: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="3.2" y="7" width="9.6" height="6.4" rx="1.2"/><path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7"/></svg>',
  clock: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.6"/></svg>',
  arrow: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9.4 4.4L13 8l-3.6 3.6"/></svg>',
  link: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 003.8 0l2.2-2.2a2.7 2.7 0 00-3.8-3.8L7.8 4.4"/><path d="M9.4 6.6a2.6 2.6 0 00-3.8 0L3.4 8.8a2.7 2.7 0 003.8 3.8l1-1"/></svg>',
};
const NEW = '<span class="new">NEW</span>';

/* ── toast / live region ──────────────────────────────────────── */
const toastHost = document.getElementById("toasts");
const liveEl = document.getElementById("live");
function say(msg) { liveEl.textContent = ""; setTimeout(() => (liveEl.textContent = msg), 30); }
function toast({ kind = "ok", title, body, action, actionLabel, timer = true }) {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  const icon = kind === "er" ? I.warn : kind === "wn" ? I.warn : I.ok;
  el.innerHTML = `<span class="ti">${icon}</span><div class="tb"><b>${esc(title)}</b>${
    body ? `<p>${body}</p>` : ""
  }${action ? `<div class="ta"><button class="btn btn-sm act">${I.undo}<span>${esc(actionLabel || "Undo")}</span></button>
    <button class="btn btn-sm btn-ghost dis">Dismiss</button></div>` : ""}${
    timer && action ? `<div class="tmr" aria-hidden="true"><i></i></div>` : ""
  }`;
  toastHost.appendChild(el);
  say(title + (body ? ". " + body.replace(/<[^>]+>/g, "") : ""));
  const close = () => el.remove();
  el.querySelector(".dis")?.addEventListener("click", close);
  el.querySelector(".act")?.addEventListener("click", () => { close(); action(); });
  if (timer) setTimeout(close, action ? 12000 : 5000);
  return close;
}

/* ── modal ────────────────────────────────────────────────────── */
const scrim = document.getElementById("scrim");
let lastFocus = null;
function openModal(html, wire) {
  lastFocus = document.activeElement;
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  scrim.hidden = false;
  const m = scrim.firstElementChild;
  const focusables = () => m.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]');
  setTimeout(() => (m.querySelector("[data-autofocus]") || focusables()[0])?.focus(), 10);
  scrim.onkeydown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeModal(); }
    if (e.key === "Tab") {
      const f = [...focusables()];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  scrim.onclick = (e) => { if (e.target === scrim) closeModal(); };
  wire && wire(m);
}
function closeModal() { scrim.hidden = true; scrim.innerHTML = ""; lastFocus?.focus(); }

/* ── popup menu ───────────────────────────────────────────────── */
let openMenu = null;
function closeMenu() { openMenu?.remove(); openMenu = null; }
document.addEventListener("click", (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { closeMenu(); } });
function popMenu(anchor, items) {
  closeMenu();
  const el = document.createElement("div");
  el.className = "pop mnu";
  el.setAttribute("role", "menu");
  el.style.cssText = "position:absolute;z-index:70";
  el.innerHTML = items.map((it) => {
    if (it.sep) return '<hr class="mnu-sep">';
    if (it.head) return `<div class="mnu-sec">${esc(it.head)}</div>`;
    const dis = it.disabled ? ' aria-disabled="true"' : "";
    return `<button class="mnu-i ${it.danger ? "dgr" : ""}" role="menuitem"${dis} data-k="${it.k || ""}">
      ${it.icon || ""}<span class="t">${esc(it.label)}${it.why ? `<small>${esc(it.why)}</small>` : ""}</span>
      ${it.key ? `<span class="sc">${esc(it.key)}</span>` : ""}</button>`;
  }).join("");
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = r.right - w + window.scrollX;
  left = Math.max(8 + window.scrollX, left);
  let top = r.bottom + 4 + window.scrollY;
  if (r.bottom + h + 8 > window.innerHeight) top = r.top - h - 4 + window.scrollY;
  el.style.left = left + "px"; el.style.top = top + "px";
  el.querySelectorAll(".mnu-i").forEach((b, i) => {
    b.addEventListener("click", () => {
      const it = items.filter((x) => !x.sep && !x.head)[[...el.querySelectorAll(".mnu-i")].indexOf(b)];
      if (it.disabled) { toast({ kind: "wn", title: "Not permitted", body: esc(it.why || "") }); return; }
      closeMenu(); it.run && it.run();
    });
  });
  const btns = [...el.querySelectorAll(".mnu-i")];
  el.addEventListener("keydown", (e) => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  });
  setTimeout(() => btns[0]?.focus(), 10);
  openMenu = el;
}

/* ══════════════════════════════════════════════════════════════ */
/*  SECTION 1 — the model                                          */
/* ══════════════════════════════════════════════════════════════ */
function secModel() {
  return `
  <div class="sec-head">
    <h1>One mutation model, five verbs</h1>
    <p>Edit, Remove one, Remove all, Undo and Redo appear on every table in Stock&#8209;Mania and mean the
    same thing to the user everywhere. What differs is what runs underneath, and that is decided by one
    question only: <b>is this row a ledger entry, or is it reference data?</b></p>
  </div>

  <div class="spec"><div class="spec-h"><h3>The rule the whole model hangs on</h3>
    <span class="sh-note">src/domain/transactions.ts:2577 &middot; src/app/ledger.usecases.ts:466&ndash;477</span></div>
  <div class="spec-b">
    <p class="why"><b>The ledger has no <code>update</code> and no hard delete.</b> A posted transaction is
    corrected by posting its mirror (<code>Transaction.reverse()</code>, transactions.ts:1018) or tombstoned with
    <code>deletedAt</code> (A03). There is deliberately no posting-level write path &mdash; that absence is how
    invariant <b>L10</b> (reconciled postings are immutable) is enforced. Nothing in this design weakens that.</p>
    <p class="why">So the five verbs are a <b>vocabulary</b>, not an implementation. Underneath there are only
    four primitive operations, and the user never has to know which one ran:</p>
    <div class="flow">
      <div class="fnode acc"><b>post</b><span>append a new transaction &mdash; <code>journal.save()</code></span></div>
      <div class="farrow">${I.arrow}</div>
      <div class="fnode acc"><b>reverse</b><span>append the mirror &mdash; <code>reverse()</code>, exists</span></div>
      <div class="farrow">${I.arrow}</div>
      <div class="fnode acc"><b>tombstone</b><span>stamp <code>deletedAt</code> &mdash; <code>softDelete()</code>, exists</span></div>
      <div class="farrow">${I.arrow}</div>
      <div class="fnode dgr"><b>restore</b><span>clear <code>deletedAt</code> ${NEW}<br>the one primitive the repo lacks</span></div>
    </div>
    <div class="alrt s"><span class="ai">${I.info}</span><div class="ab">
      <b>The central finding: undo is tombstone/restore, never reverse&#8209;a&#8209;reversal.</b>
      <p>Reversing a reversal is blocked on purpose (<code>ledger.usecases.ts:492</code>) because it makes the
      current state unreadable. But a reversal is itself a row, and a row can be tombstoned. <b>Undoing a
      correction means tombstoning the reversal and its replacement</b> &mdash; the original comes back into every
      balance, the evidence of the whole episode stays in the table behind a filter, and no new accounting
      concept is invented. The only thing missing from the repository is the inverse of <code>softDelete</code>.</p>
    </div></div>
    <p class="why">Redo then falls out of the same mechanism, because undo is itself a recorded batch:
    redo re&#8209;applies the tombstones undo cleared. Section <b>Redo</b> works through where that stops being true.</p>
  </div></div>

  <div class="spec"><div class="spec-h"><h3>What groups a mutation into one undoable unit</h3>
    <span class="sh-note">schema.ts:1843 auditEvents &middot; schema.ts:1880 ledgerEvents</span></div>
  <div class="spec-b">
    <p class="why">The schema already has the key. <code>audit_events.request_id</code> &mdash; <i>"groups every
    event from one request, so a multi-aggregate change is one story"</i> &mdash; and <code>ledger_events.request_id</code>
    are exactly the batch identity an undo needs. <b>A mutation batch is a request_id.</b> One row edited, fifteen
    rows deleted, a whole import undone: all the same unit, all undoable as one, with no new table required
    for the ledger side.</p>
    <p class="why">What <i>is</i> required: a user-visible <b>Activity</b> surface reading that log, and a
    <code>restore</code> on the repository. Those are the two ${NEW} pieces the entire model rests on.</p>
  </div></div>`;
}

/* ══════════════════════════════════════════════════════════════ */
/*  SECTION 2 — taxonomy                                           */
/* ══════════════════════════════════════════════════════════════ */
const TAX = [
  ["A", "Ledger entries", "transactions + postings", "schema.ts:425, 486",
    "Append-only. Reverse to correct, tombstone to erase.",
    "Edit = reverse + repost. Remove one = tombstone. Remove all = tombstone batch. Undo = restore. Redo = re-tombstone.",
    "Reverse ✓ · softDelete ✓ · restore ✕"],
  ["A", "Trades", "trades + lots + lot_matches", "schema.ts:872, 928, 969",
    "Ledger entry plus a mutable lot book that must be unwound in step.",
    "Same five verbs, but Edit/Remove refuse when a later sale, corporate action or basis-moving event depends on the trade.",
    "VoidTrade ✓ · CorrectTrade ✓ · restore ✕"],
  ["A", "Corporate actions", "corporate_actions", "schema.ts:2062",
    "Replayable ledger transactions, never in-place lot edits (00-INDEX §7).",
    "Edit = void the action and re-apply. Remove all is not offered at all.",
    "Apply ✓ · void ≈ · restore ✕"],
  ["A", "Import batches", "import_batches + import_rows", "schema.ts:1771, 2107",
    "A batch is one pre-made undo unit; UndoImport tombstones and sets status UNDONE.",
    "Remove all = Undo import, already scoped and already atomic. Undo of that undo = re-import, not restore.",
    "UndoImport ✓ · redo ✕"],
  ["A", "Gold leases", "gold_leases", "schema.ts:1109",
    "Posts ledger entries for lease income; the lease itself is a contract record.",
    "Header is class B; the postings it generated are class A.",
    "mixed ≈"],
  ["A", "Deposit contributions", "deposit_contributions", "schema.ts:1597",
    "Each contribution is money that moved.",
    "Reverse + tombstone, same as a bank transaction.",
    "≈"],
  ["A", "Instrument income", "instrument_incomes", "schema.ts:1252",
    "Dividends and interest the user logs; they post to the ledger.",
    "Reverse + tombstone.",
    "≈"],
  ["B", "Categories &amp; keyword rules", "category_rules", "schema.ts:1315",
    "Ordinary mutable reference data. Editing a rule does not change money that already moved.",
    "Edit = UPDATE in place. Remove = tombstone (A03 still applies). Undo and Redo both work from the audit before/after image.",
    "CRUD ≈ · audit before/after ✓"],
  ["B", "Budgets", "budgets", "schema.ts:1358",
    "A target, not a fact. Mutable.",
    "Full CRUD. Remove all scoped to a period.",
    "≈"],
  ["B", "Instruments (user's own)", "instruments", "schema.ts:646",
    "Metadata. Mutable until a trade references it.",
    "Edit freely; Remove refused once trades exist — close the holding instead.",
    "instrument-admin ✓"],
  ["B", "Terms records", "deposit_terms · loan_terms · credit_card_terms · nps_holdings", "schema.ts:1532, 1693, 1410, 1661",
    "Contract parameters. Mutable; a change is effective-dated, not retroactive.",
    "Full CRUD + Undo + Redo.",
    "≈"],
  ["B", "Institutions &amp; counterparties", "institutions · counterparties", "schema.ts:1920, 1967",
    "Naming data.",
    "Full CRUD. Remove refused while referenced.",
    "≈"],
  ["B", "Tax settings", "tax_settings", "schema.ts:1480",
    "User preference. Mutable, effective-dated.",
    "Full CRUD + Undo.",
    "≈"],
  ["B", "Documents", "documents", "schema.ts:2138",
    "Attachments.",
    "Edit metadata; Remove = tombstone + blob retained until the batch undo window closes.",
    "≈"],
  ["B", "Saved views", "— not in schema", "user decision, 2026-10-20",
    "Named filter + sort + columns + density. Pure UI state.",
    "Full CRUD, no audit needed, Undo via the generic reference-data path.",
    "table missing ✕ " + NEW],
  ["B", "Planned: insurance · subscriptions · income streams", "— not in schema", "roadmap",
    "Recurring contract records, not money movements. The payments they generate are class A.",
    "Full CRUD + Undo + Redo on the record; the posted payments follow class A rules.",
    "✕ " + NEW],
  ["C", "Prices, FX, index closes", "price_quotes · fx_rates · price_bars", "schema.ts:1011, 2005, 1209",
    "Bitemporal observations. Not the user's to edit; a wrong price is superseded, not corrected.",
    "No verbs. Offer <i>Refetch</i> and <i>Override for this date</i> — an override is an append, like a reversal.",
    "append-only ✓"],
  ["C", "Audit &amp; ledger events", "audit_events · ledger_events", "schema.ts:1843, 1880",
    "The log the verbs are recorded in. A tombstone on an immutable log is a contradiction (70-UPGRADE-PLAN:748).",
    "No verbs at all. Read-only, forever. This is the durable path behind every toast.",
    "immutable ✓"],
  ["C", "Reference tables", "tax_rules · charge_rates · cost_inflation_index · market_holidays · txn_type_legality", "schema.ts:2310, 2362, 2345, 2403, 2284",
    "System data shipped with the app.",
    "No user verbs. Settings may let the user add an override row.",
    "read-only ✓"],
  ["C", "Derived caches", "net_worth_snapshots · projection_cache · price_divergences", "schema.ts:1809, 2175, 2249",
    "Rebuildable. Deleting one is not a mutation of anything.",
    "Only verb is <i>Rebuild</i>. Never shows the five.",
    "rebuildable ✓"],
];
function secTaxonomy() {
  const cls = { A: ["Class A — ledger", "sub-acc"], B: ["Class B — reference", "sub-info"], C: ["Class C — system", "out-n"] };
  const rows = TAX.map((t) => `<tr>
    <td><span class="bdg sm ${cls[t[0]][1]}">${t[0]}</span></td>
    <td><div class="nm"><b>${t[1]}</b><span class="mono">${esc(t[2])}</span></div></td>
    <td class="src">${esc(t[3])}</td>
    <td>${t[4]}</td>
    <td>${t[5]}</td>
    <td><span class="mono" style="font-size:10.5px">${t[6]}</span></td></tr>`).join("");
  return `
  <div class="sec-head">
    <h1>Data-class taxonomy</h1>
    <p>Every table in the schema, sorted into three classes. Class A is append-only-with-reversal. Class B is
    ordinary mutable reference data. Class C never shows the five verbs at all &mdash; naming it is as important as
    naming the other two, because it is where a careless "add CRUD everywhere" would do real damage.</p>
  </div>
  <div class="spec"><div class="spec-h"><h3>Three classes, 47 tables</h3>
  <span class="sh-note">Enumerated from <code>src/infra/db/schema.ts</code>. ✓ exists · ≈ partial · ✕ missing.</span></div>
  <div class="spec-b" style="padding:0">
    <div class="tscroll" style="border:0;border-radius:0">
    <table class="tax"><thead><tr>
      <th>Class</th><th>Entity</th><th>Source</th><th>Why this class</th><th>What the five verbs do</th><th>Repo today</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
  </div></div>
  <div class="spec"><div class="spec-h"><h3>The boundary case worth naming</h3></div><div class="spec-b">
    <p class="why"><b>Some entities straddle.</b> A gold lease, a deposit term and a loan term are class&nbsp;B
    headers that <i>generate</i> class&nbsp;A postings. The rule: <b>the record is B, its postings are A.</b> Editing a
    loan's interest rate is an in-place update with an effective date; it does not retroactively rewrite the
    EMIs already posted. If the user wants those changed too, that is a second, explicit action with its own
    confirmation &mdash; never a silent consequence of editing the header.</p>
    <div class="alrt w"><span class="ai">${I.warn}</span><div class="ab"><b>Decision for the user</b>
      <p>When a class&nbsp;B header changes, do we offer "and restate the N postings already made from it"?
      Recommendation: yes, as a separate confirmed step that produces one reversal batch &mdash; never automatically.</p></div></div>
  </div></div>`;
}

/* ══════════════════════════════════════════════════════════════ */
/*  SECTION 3 — verbs, interactive ledger                          */
/* ══════════════════════════════════════════════════════════════ */
let nextId = 100;
const uid = () => "t" + ++nextId;

function seedRows() {
  return [
    { id: "t01", date: "2026-10-18", desc: "Zomato Ltd — dinner", cat: "Food & dining", amt: -94200, state: "live", recon: false },
    { id: "t02", date: "2026-10-17", desc: "HDFC Bank — salary credit", cat: "Salary", amt: 18750000, state: "live", recon: true },
    { id: "t03", date: "2026-10-16", desc: "Indian Oil — fuel", cat: "Transport", amt: -325000, state: "live", recon: false },
    { id: "t04", date: "2026-10-15", desc: "Amazon Pay — electronics", cat: "Shopping", amt: -1289900, state: "live", recon: false },
    { id: "t05", date: "2026-10-14", desc: "Tata Power — electricity", cat: "Utilities", amt: -248650, state: "live", recon: false },
    { id: "t06", date: "2026-10-13", desc: "SIP — Parag Parikh Flexi Cap", cat: "Investments", amt: -2500000, state: "live", recon: false },
    { id: "t07", date: "2026-10-12", desc: "Swiggy Instamart — groceries", cat: "Groceries", amt: -187450, state: "live", recon: false },
  ];
}
let rows = seedRows();
let selected = new Set();
let kbIndex = 0;
let batches = [];          // mutation batches, newest first
let redoStack = [];        // batches undone, available to redo
let showTrail = false;

function liveRows() {
  return rows.filter((r) => {
    const isTrail = r.kind === "reversal" || r.kind === "original";
    if (isTrail || r.state === "void") return showTrail;
    return true;
  });
}

function rowStatus(r) {
  if (r.state === "void") return `<span class="bdg sm out-n">removed</span>`;
  if (r.kind === "reversal") return `<span class="bdg sm sub-warn">reversal</span>`;
  if (r.corrected) return `<span class="bdg sm sub-info" title="Corrected — the original and its reversal are in this ledger; turn on the trail toggle to see them">corrected</span>`;
  if (r.recon) return `<span class="bdg sm out-n" title="Reconciled — postings are immutable (L10)">${I.lock} reconciled</span>`;
  return "";
}

function renderLedger() {
  const host = document.getElementById("ledger");
  if (!host) return;
  const visible = liveRows();
  const selCount = [...selected].filter((id) => rows.find((r) => r.id === id)).length;
  const selRows = rows.filter((r) => selected.has(r.id));
  const blocked = selRows.filter((r) => r.recon || r.state === "void" || r.kind === "reversal");
  const total = visible.filter((r) => r.state !== "void").reduce((a, r) => a + r.amt, 0);

  const allSel = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const someSel = selCount > 0 && !allSel;

  host.innerHTML = `
  <div class="tbar">
    <span class="fchip"><em>Account</em> HDFC Savings &middot;&middot;4421 <button aria-label="Remove filter">&times;</button></span>
    <span class="fchip"><em>Period</em> Oct 2026 <button aria-label="Remove filter">&times;</button></span>
    <span class="fchip"><em>Type</em> All <button aria-label="Remove filter">&times;</button></span>
    <span style="flex:1"></span>
    <label class="ctl" style="align-items:center"><input type="checkbox" id="trailToggle" ${showTrail ? "checked" : ""}>
      <span class="bx">${I.check}${I.dash}</span><span style="font-size:12px">Show corrections &amp; removals</span></label>
    <button class="btn btn-sm" id="historyBtn">${I.clock}<span>Activity</span>${NEW}</button>
  </div>
  ${selCount ? `
  <div class="selbar" role="region" aria-label="Selection actions">
    <span class="ct">${selCount} selected</span>
    ${blocked.length ? `<span class="mix">${blocked.length} of them cannot be changed &mdash;
      <button class="btn-link" id="whyBlocked" type="button">why</button></span>` : ""}
    <span class="sp"></span>
    <button class="btn btn-sm" id="bulkEdit" ${selCount - blocked.length === 0 ? "disabled" : ""}>${I.pencil}<span>Recategorise</span></button>
    <button class="btn btn-sm btn-danger-quiet" id="bulkRemove" ${selCount - blocked.length === 0 ? "disabled" : ""}>${I.trash}<span>Remove ${selCount - blocked.length}</span></button>
    <button class="btn btn-sm btn-ghost" id="clearSel">Clear</button>
  </div>` : ""}
  <div class="tscroll">
  <table class="dt" id="ledgerTable">
    <thead><tr>
      <th style="width:1%"><label class="ctl"><input type="checkbox" id="selAll" aria-label="Select all rows in the current filter"
        ${allSel ? "checked" : ""}><span class="bx">${I.check}${I.dash}</span></label></th>
      <th style="width:1%">Date</th>
      <th>Description</th>
      <th>Category</th>
      <th class="num">Amount</th>
      <th style="width:1%">Status</th>
      <th class="actcell">Actions</th>
    </tr></thead>
    <tbody>${visible.map((r, i) => {
      const cls = [r.state === "void" ? "void" : "", selected.has(r.id) ? "sel" : "",
        r.kind === "reversal" || r.kind === "replacement" ? "trail" : "",
        r.corrected ? "corrected" : "", i === kbIndex ? "kb" : ""].filter(Boolean).join(" ");
      return `<tr class="${cls}" data-id="${r.id}" tabindex="-1">
        <td><label class="ctl"><input type="checkbox" class="rowsel" data-id="${r.id}" ${selected.has(r.id) ? "checked" : ""}
          aria-label="Select ${esc(r.desc)}"><span class="bx">${I.check}</span></label></td>
        <td class="mono" style="font-size:11.5px;white-space:nowrap">${r.date}</td>
        <td><div class="nm"><b>${esc(r.desc)}${r.wasDesc ? ` <span class="was">${esc(r.wasDesc)}</span>` : ""}</b>
          ${r.note ? `<span>${r.note}</span>` : ""}</div></td>
        <td>${esc(r.cat)}${r.wasCat ? ` <span class="was">${esc(r.wasCat)}</span>` : ""}</td>
        <td class="num amt ${r.amt < 0 ? "" : "gain"}">${rupee(r.amt)}${
          r.wasAmt !== undefined ? `<br><span class="was">${rupee(r.wasAmt)}</span>` : ""}</td>
        <td>${rowStatus(r)}</td>
        <td class="actcell"><span class="rowacts">
          <button class="btn btn-sm btn-ghost only rowmenu" data-id="${r.id}" aria-label="Actions for ${esc(r.desc)}"
            aria-haspopup="menu">${I.kebab}</button></span></td>
      </tr>`;
    }).join("")}</tbody>
    <tfoot><tr><td colspan="4">${visible.filter((r) => r.state !== "void").length} rows in this filter</td>
      <td class="num amt ${total < 0 ? "loss" : "gain"}">${rupee(total, { signed: true })}</td><td colspan="2"></td></tr></tfoot>
  </table></div>
  <div class="row" style="margin-top:10px">
    <button class="btn btn-sm" id="undoBtn" ${batches.length === 0 ? "disabled" : ""}>${I.undo}<span>Undo</span>
      <kbd style="margin-left:2px">Ctrl Z</kbd></button>
    <button class="btn btn-sm" id="redoBtn" ${redoStack.length === 0 ? "disabled" : ""}>${I.redo}<span>Redo</span>
      <kbd style="margin-left:2px">Ctrl Y</kbd></button>
    <span style="flex:1"></span>
    <button class="btn btn-sm btn-danger-quiet" id="removeAll">${I.broom}<span>Remove all in this filter&hellip;</span></button>
  </div>
  <p class="hint" style="margin-top:4px">The last button is never <code>btn-danger</code> and never sits beside a primary
  action. It is the quiet danger style, at the far end of the toolbar, and it cannot fire without the typed confirmation.</p>`;

  wireLedger();
}

function wireLedger() {
  const $ = (s) => document.querySelector(s);
  $("#trailToggle").onchange = (e) => { showTrail = e.target.checked; renderLedger(); };
  const selAll = $("#selAll");
  const visible = liveRows();
  selAll.indeterminate = selected.size > 0 && !visible.every((r) => selected.has(r.id));
  selAll.onchange = (e) => {
    if (e.target.checked) visible.forEach((r) => selected.add(r.id)); else selected.clear();
    renderLedger();
  };
  document.querySelectorAll(".rowsel").forEach((cb) => {
    cb.onchange = () => { cb.checked ? selected.add(cb.dataset.id) : selected.delete(cb.dataset.id); renderLedger(); };
  });
  document.querySelectorAll(".rowmenu").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); rowMenu(b, rows.find((r) => r.id === b.dataset.id)); };
  });
  $("#clearSel") && ($("#clearSel").onclick = () => { selected.clear(); renderLedger(); });
  $("#bulkRemove") && ($("#bulkRemove").onclick = () => confirmBulkRemove());
  $("#bulkEdit") && ($("#bulkEdit").onclick = () => bulkRecategorise());
  $("#whyBlocked") && ($("#whyBlocked").onclick = () => explainBlocked());
  $("#removeAll").onclick = () => confirmRemoveAll();
  $("#undoBtn").onclick = () => undoLast();
  $("#redoBtn").onclick = () => redoLast();
  $("#historyBtn").onclick = () => openHistory();
}

/* ── row menu, with the not-permitted reasons spelled out ─────── */
function rowMenu(anchor, r) {
  const items = [{ head: "This transaction" }];
  if (r.state === "void") {
    items.push({ icon: I.undo, label: "Restore", key: "", run: () => restoreRow(r) },
      { sep: true },
      { icon: I.info, label: "View in Activity", run: () => openHistory() });
  } else if (r.recon) {
    items.push(
      { icon: I.pencil, label: "Edit", disabled: true, why: "Reconciled. Postings are immutable (L10). Unreconcile the statement first." },
      { icon: I.trash, label: "Remove", danger: true, disabled: true, why: "Reconciled. Remove the reconciliation, then this." },
      { sep: true },
      { icon: I.info, label: "Why is this locked?", run: () => explainL10() });
  } else if (r.kind === "reversal") {
    items.push(
      { icon: I.pencil, label: "Edit", disabled: true, why: "This is a reversal. Edit the original instead." },
      { icon: I.undo, label: "Reverse", disabled: true, why: "Reversing a reversal would make the current state unreadable (ledger.usecases.ts:492)." },
      { sep: true },
      { icon: I.undo, label: "Undo this correction", run: () => undoCorrection(r) });
  } else {
    items.push(
      { icon: I.pencil, label: "Edit…", key: "E", run: () => openEdit(r) },
      { icon: I.undo, label: "Reverse", why: "", run: () => reverseOnly(r) },
      { sep: true },
      { icon: I.trash, label: "Remove", danger: true, key: "Del", run: () => confirmRemoveOne(r) });
  }
  popMenu(anchor, items);
}

function explainL10() {
  openModal(`<div class="modal-h"><span style="color:var(--fg-muted);margin-top:2px">${I.lock}</span>
    <div><h4>This transaction is reconciled</h4>
    <p>Invariant L10 &mdash; reconciled postings are immutable.</p></div></div>
  <div class="modal-b">
    <p>You matched this row against a printed statement, so the ledger and the bank now agree on it. Changing it
    here would break that agreement silently.</p>
    <p class="hint">Enforced structurally: the repository has no posting-level write path at all
    (<code>src/domain/transactions.ts:2570</code>), which is why this is a greyed control with a reason rather than
    a button that fails after the click.</p>
    <div class="alrt i"><span class="ai">${I.info}</span><div class="ab"><b>To change it anyway</b>
      <p>Open the reconciliation for this statement period and remove the match, then edit. Both steps are audited.</p></div></div>
  </div>
  <div class="modal-f"><span class="sp"></span>
    <button class="btn" data-close>Close</button>
    <button class="btn btn-primary" data-close data-autofocus>Open reconciliation ${NEW}</button></div>`,
    (m) => m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal)));
}

/* ── Edit = reverse + repost, linked as a triple ─────────────── */
function openEdit(r) {
  openModal(`<div class="modal-h"><div><h4>Edit transaction</h4>
    <p>The ledger is append-only, so this does not overwrite anything.</p></div></div>
  <div class="modal-b">
    <div class="fld"><label for="eDesc">Description</label>
      <div class="inw"><input id="eDesc" value="${esc(r.desc)}" data-autofocus></div></div>
    <div class="cols2">
      <div class="fld"><label for="eCat">Category</label>
        <select class="sel" id="eCat">${["Food &amp; dining","Transport","Shopping","Utilities","Groceries","Salary","Investments","Uncategorised"]
          .map((c) => `<option ${c.replace("&amp;","&") === r.cat ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="fld"><label for="eAmt">Amount</label>
        <div class="inw num"><span class="afx">₹</span><input id="eAmt" value="${(Math.abs(r.amt) / 100).toFixed(2)}"></div></div>
    </div>
    <div class="fld"><label for="eWhy">Reason for the correction <span class="hint">(goes on the reversal&rsquo;s narration)</span></label>
      <div class="inw"><input id="eWhy" placeholder="e.g. wrong amount keyed from the receipt"></div></div>
    <div class="alrt i"><span class="ai">${I.info}</span><div class="ab">
      <b>Saving this writes three linked rows, not one change</b>
      <p>The original stays. A reversal is posted on <span class="mono">${r.date}</span> so the fix lands in the
      period the mistake was made. The corrected entry is posted beside it. They net to zero everywhere, and the
      triple is one undo.</p></div></div>
  </div>
  <div class="modal-f">
    <span class="hint sp">Original kept &middot; reversal + replacement appended</span>
    <button class="btn" data-close>Cancel</button>
    <button class="btn btn-primary" id="eSave">Post correction</button></div>`,
  (m) => {
    m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    m.querySelector("#eSave").onclick = (ev) => {
      const btn = ev.currentTarget;
      btn.classList.add("loading"); btn.setAttribute("aria-busy", "true");
      const desc = m.querySelector("#eDesc").value.trim() || r.desc;
      const cat = m.querySelector("#eCat").value.replace("&amp;", "&");
      const sign = r.amt < 0 ? -1 : 1;
      const amt = Math.round(parseFloat(m.querySelector("#eAmt").value || "0") * 100) * sign;
      setTimeout(() => { closeModal(); applyEdit(r, { desc, cat, amt }); }, 420);
    };
  });
}

function applyEdit(r, next) {
  const batch = { id: "req_" + uid(), kind: "edit", at: new Date(), label: `Corrected “${r.desc}”` };
  const i = rows.indexOf(r);
  const before = { id: r.id, date: r.date, desc: r.desc, cat: r.cat, amt: r.amt, state: "live", recon: false };
  const repId = uid();
  const rev = { id: uid(), date: r.date, desc: "Reversal of: " + r.desc, cat: r.cat, amt: -r.amt,
    state: "live", kind: "reversal", note: `reverses <span class="mono">${r.id}</span> &middot; posted on the original&rsquo;s date` };
  const orig = { ...before, kind: "original", state: "superseded",
    note: `superseded by <span class="mono">${repId}</span>` };
  // The row the user keeps seeing: the CURRENT values, with the correction discoverable but quiet.
  const shown = { id: repId, date: r.date, desc: next.desc, cat: next.cat, amt: next.amt,
    state: "live", corrected: "just now",
    wasDesc: next.desc !== r.desc ? r.desc : undefined,
    wasCat: next.cat !== r.cat ? r.cat : undefined,
    wasAmt: next.amt !== r.amt ? r.amt : undefined,
    note: `corrected &middot; replaces <span class="mono">${r.id}</span>, which was reversed by <span class="mono">${rev.id}</span>` };
  const doIt = () => { const j = rows.findIndex((x) => x.id === before.id); rows.splice(j, 1, shown, rev, orig); };
  doIt();
  batch.undo = () => {
    // NOT a reversal of the reversal: the reversal and the replacement are tombstoned,
    // and the original comes back live. One batch, one request_id.
    const j = rows.findIndex((x) => x.id === shown.id);
    rows.splice(j, 3, { ...before });
  };
  batch.redo = doIt;
  batches.unshift(batch); redoStack = [];
  selected.clear(); renderLedger();
  toast({ kind: "ok", title: "Correction posted",
    body: `Original kept, reversal and replacement appended. Net effect ${rupee(next.amt - r.amt, { signed: true })}.`,
    action: () => { batch.undo(); batches = batches.filter((b) => b !== batch); redoStack.unshift(batch); renderLedger();
      toast({ kind: "ok", title: "Correction undone", body: "The reversal and the replacement were tombstoned; the original is back in every balance.", timer: true }); },
    actionLabel: "Undo" });
}

/* ── reverse only (no replacement) ────────────────────────────── */
function reverseOnly(r) {
  const batch = { id: "req_" + uid(), kind: "reverse", at: new Date(), label: `Reversed “${r.desc}”` };
  const i = rows.indexOf(r);
  const rev = { id: uid(), date: r.date, desc: "Reversal of: " + r.desc, cat: r.cat, amt: -r.amt,
    state: "live", kind: "reversal", note: `reverses <span class="mono">${r.id}</span>` };
  rows.splice(i + 1, 0, rev);
  r.corrected = "just now";
  batch.undo = () => { rows = rows.filter((x) => x !== rev); delete r.corrected; };
  batch.redo = () => { const j = rows.indexOf(r); rows.splice(j + 1, 0, rev); r.corrected = "just now"; };
  batches.unshift(batch); redoStack = []; renderLedger();
  toast({ kind: "ok", title: "Reversed", body: "Both the original and its mirror stay on the statement.",
    action: () => { batch.undo(); batches = batches.filter((b) => b !== batch); redoStack.unshift(batch); renderLedger(); } });
}

function undoCorrection(rev) {
  const b = batches.find((x) => x.kind === "edit" || x.kind === "reverse");
  if (!b) { toast({ kind: "wn", title: "Nothing to undo here" }); return; }
  b.undo(); batches = batches.filter((x) => x !== b); redoStack.unshift(b); renderLedger();
  toast({ kind: "ok", title: "Correction undone", body: "Tombstoned the reversal &mdash; not reversed it. The original is live again." });
}

/* ── Remove one = reverse + tombstone ─────────────────────────── */
function confirmRemoveOne(r) {
  openModal(`<div class="modal-h"><span style="color:var(--loss);margin-top:2px">${I.warn}</span>
    <div><h4>Remove this transaction?</h4><p>Choose what actually happened &mdash; the two are not the same.</p></div></div>
  <div class="modal-b">
    <div class="tscroll"><table class="dt"><tbody><tr>
      <td class="mono" style="font-size:11.5px">${r.date}</td><td>${esc(r.desc)}</td>
      <td class="num amt">${rupee(r.amt)}</td></tr></tbody></table></div>
    <label class="ctl" style="padding:8px;border:1px solid var(--border);border-radius:var(--r-3)">
      <input type="radio" name="rmode" value="never" checked><span class="bx" style="border-radius:999px">${I.check}</span>
      <span class="t"><b>It never happened</b><span>A duplicate from a re-import, or an entry keyed by mistake.
      Tombstoned (<code>deletedAt</code>, A03) &mdash; it leaves every balance and report, and stays in Activity.</span></span></label>
    <label class="ctl" style="padding:8px;border:1px solid var(--border);border-radius:var(--r-3)">
      <input type="radio" name="rmode" value="wrong"><span class="bx" style="border-radius:999px">${I.check}</span>
      <span class="t"><b>It happened and was recorded wrongly</b><span>A reversal is posted instead. Both rows stay on
      the statement. Use this when the money really did move.</span></span></label>
    <p class="hint">This distinction already exists in the codebase &mdash; <code>app/(root)/accounts/actions.ts</code> and
    <code>src/app/trade-corrections.usecases.ts</code> both draw it. The design keeps it rather than collapsing it
    into one button.</p>
  </div>
  <div class="modal-f"><span class="hint sp">Undoable for 30 days from Activity</span>
    <button class="btn" data-close>Cancel</button>
    <button class="btn btn-danger" id="rmGo" data-autofocus>Remove it</button></div>`,
  (m) => {
    m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    m.querySelector("#rmGo").onclick = () => {
      const mode = m.querySelector('input[name="rmode"]:checked').value;
      closeModal(); mode === "never" ? tombstone([r], "Removed") : reverseOnly(r);
    };
  });
}

function tombstone(list, verb) {
  const batch = { id: "req_" + uid(), kind: "remove", at: new Date(),
    label: `${verb} ${list.length} transaction${list.length > 1 ? "s" : ""}`, n: list.length };
  list.forEach((r) => (r.state = "void"));
  batch.undo = () => list.forEach((r) => (r.state = "live"));
  batch.redo = () => list.forEach((r) => (r.state = "void"));
  batches.unshift(batch); redoStack = []; selected.clear(); renderLedger();
  const total = list.reduce((a, r) => a + r.amt, 0);
  toast({ kind: "ok", title: `${verb} ${list.length} transaction${list.length > 1 ? "s" : ""}`,
    body: `Worth ${rupee(total, { signed: true })}. Tombstoned, not deleted &mdash; the rows stay in Activity.`,
    action: () => { batch.undo(); batches = batches.filter((b) => b !== batch); redoStack.unshift(batch); renderLedger();
      toast({ title: "Restored", body: `${list.length} transaction${list.length > 1 ? "s are" : " is"} back in every balance.` }); },
    actionLabel: "Undo" });
}
function restoreRow(r) {
  r.state = "live"; renderLedger();
  toast({ title: "Restored", body: "Back in every balance." });
}

/* ── bulk ─────────────────────────────────────────────────────── */
function explainBlocked() {
  const blocked = rows.filter((r) => selected.has(r.id) && (r.recon || r.state === "void" || r.kind === "reversal"));
  openModal(`<div class="modal-h"><div><h4>${blocked.length} of your selection cannot be changed</h4>
    <p>The rest will go through. Nothing is silently skipped.</p></div></div>
  <div class="modal-b"><div class="tscroll"><table class="dt"><tbody>${blocked.map((r) => `<tr>
    <td class="mono" style="font-size:11.5px">${r.date}</td><td>${esc(r.desc)}</td>
    <td class="num amt">${rupee(r.amt)}</td>
    <td><span class="bdg sm out-warn">${r.recon ? "reconciled (L10)" : r.kind === "reversal" ? "is a reversal" : "already removed"}</span></td>
  </tr>`).join("")}</tbody></table></div>
  <p class="hint">A mixed selection is not an error. The toolbar counts only what it can act on, the dialog lists
  what it will skip and why, and the skipped rows stay selected afterwards so the user can deal with them.</p></div>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-primary" data-close data-autofocus>Got it</button></div>`,
  (m) => m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal)));
}

function confirmBulkRemove() {
  const list = rows.filter((r) => selected.has(r.id) && !r.recon && r.state !== "void" && r.kind !== "reversal");
  const skipped = rows.filter((r) => selected.has(r.id)).length - list.length;
  const total = list.reduce((a, r) => a + r.amt, 0);
  openModal(`<div class="modal-h"><span style="color:var(--loss);margin-top:2px">${I.warn}</span>
    <div><h4>Remove ${list.length} transactions?</h4><p>One batch. One undo.</p></div></div>
  <div class="modal-b">
    <dl style="display:grid;grid-template-columns:auto 1fr;margin:0;font-size:12.5px">
      <dt style="color:var(--fg-muted);padding:6px 16px 6px 0;border-bottom:1px solid var(--border-subtle)">Rows</dt>
      <dd style="margin:0;padding:6px 0;text-align:right;border-bottom:1px solid var(--border-subtle)" class="amt">${list.length}</dd>
      <dt style="color:var(--fg-muted);padding:6px 16px 6px 0;border-bottom:1px solid var(--border-subtle)">Net amount</dt>
      <dd style="margin:0;padding:6px 0;text-align:right;border-bottom:1px solid var(--border-subtle)" class="amt">${rupee(total, { signed: true })}</dd>
      <dt style="color:var(--fg-muted);padding:6px 16px 6px 0">Skipped</dt>
      <dd style="margin:0;padding:6px 0;text-align:right" class="amt">${skipped}</dd>
    </dl>
    ${skipped ? `<div class="alrt w"><span class="ai">${I.warn}</span><div class="ab"><b>${skipped} rows stay</b>
      <p>Reconciled or already removed. They remain selected afterwards.</p></div></div>` : ""}
    <div class="alrt i"><span class="ai">${I.info}</span><div class="ab"><b>Atomic</b>
      <p>All ${list.length} land or none do. A partial batch is the one outcome a bulk action must never produce,
      because the user cannot tell from the table which half ran.</p></div></div>
  </div>
  <div class="modal-f"><span class="hint sp">Undoable as one batch</span>
    <button class="btn" data-close>Cancel</button>
    <button class="btn btn-danger" id="bGo" data-autofocus>Remove ${list.length}</button></div>`,
  (m) => {
    m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    m.querySelector("#bGo").onclick = (e) => {
      e.currentTarget.classList.add("loading");
      setTimeout(() => { closeModal(); maybePartialFailure(list); }, 500);
    };
  });
}

function maybePartialFailure(list) {
  // demonstrate the partial-failure state on larger batches
  if (list.length >= 4) {
    const ok = list.slice(0, list.length - 1);
    const bad = list[list.length - 1];
    toast({ kind: "er", title: `Nothing was removed`, timer: false,
      body: `${list.length - 1} of ${list.length} would have succeeded, but “${esc(bad.desc)}” was reconciled in
      another tab while this dialog was open. The batch was rolled back so the table still matches what you see.`,
      action: () => { selected = new Set(ok.map((r) => r.id)); renderLedger(); tombstone(ok, "Removed"); },
      actionLabel: `Retry without it (${list.length - 1})` });
    bad.recon = true; renderLedger();
    return;
  }
  tombstone(list, "Removed");
}

function bulkRecategorise() {
  const list = rows.filter((r) => selected.has(r.id) && !r.recon && r.state !== "void" && r.kind !== "reversal");
  openModal(`<div class="modal-h"><div><h4>Recategorise ${list.length} transactions</h4>
    <p>Category is metadata, not money &mdash; this is an in-place update, not a reversal.</p></div></div>
  <div class="modal-b">
    <div class="fld"><label for="bCat">New category</label>
      <select class="sel" id="bCat" data-autofocus>${["Food &amp; dining","Transport","Shopping","Utilities","Groceries","Salary","Investments","Uncategorised"].map((c) => `<option>${c}</option>`).join("")}</select></div>
    <label class="ctl"><input type="checkbox" id="mkRule"><span class="bx">${I.check}</span>
      <span class="t"><b>Also create a keyword rule</b><span>Class B &mdash; future imports get this category automatically.
      Fully editable and undoable later.</span></span></label>
    <div class="alrt s"><span class="ai">${I.info}</span><div class="ab"><b>No postings change</b>
      <p>Amounts, dates and accounts are untouched, so no reversal is posted and no balance moves. This is the
      everyday case, and it should feel lighter than a correction &mdash; because it is one.</p></div></div>
  </div>
  <div class="modal-f"><span class="sp"></span><button class="btn" data-close>Cancel</button>
    <button class="btn btn-primary" id="bcGo">Apply to ${list.length}</button></div>`,
  (m) => {
    m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    m.querySelector("#bcGo").onclick = () => {
      const cat = m.querySelector("#bCat").value.replace("&amp;", "&");
      const before = list.map((r) => ({ r, cat: r.cat }));
      list.forEach((r) => { r.wasCat = r.cat; r.cat = cat; });
      const batch = { id: "req_" + uid(), kind: "update", at: new Date(), label: `Recategorised ${list.length} to “${cat}”`,
        undo: () => before.forEach(({ r, cat }) => { r.cat = cat; delete r.wasCat; }),
        redo: () => list.forEach((r) => { r.wasCat = r.cat; r.cat = cat; }) };
      batches.unshift(batch); redoStack = []; selected.clear(); closeModal(); renderLedger();
      toast({ title: `${list.length} recategorised`, body: `Now “${esc(cat)}”. No balances changed.`,
        action: () => { batch.undo(); batches = batches.filter((b) => b !== batch); redoStack.unshift(batch); renderLedger(); } });
    };
  });
}

/* ── Remove all — scoped, previewed, typed ────────────────────── */
function confirmRemoveAll() {
  const list = liveRows().filter((r) => r.state !== "void" && !r.recon);
  const skipped = liveRows().filter((r) => r.recon).length;
  const total = list.reduce((a, r) => a + r.amt, 0);
  const phrase = `remove ${list.length} rows`;
  openModal(`<div class="modal-h"><span style="color:var(--loss);margin-top:2px">${I.warn}</span>
    <div><h4>Remove every transaction in this filter</h4>
    <p>The most destructive control in the product. It is scoped to what you can see &mdash; never to everything.</p></div></div>
  <div class="modal-b">
    <div class="alrt e"><span class="ai">${I.warn}</span><div class="ab"><b>Scope</b>
      <p>HDFC Savings &middot;&middot;4421 &middot; October 2026 &middot; all types. Exactly the three filter chips above the table.
      Change the filter to change what this removes.</p></div></div>
    <dl style="display:grid;grid-template-columns:auto 1fr;margin:0;font-size:13px">
      <dt style="color:var(--fg-muted);padding:7px 16px 7px 0;border-bottom:1px solid var(--border-subtle)">Transactions</dt>
      <dd style="margin:0;padding:7px 0;text-align:right;border-bottom:1px solid var(--border-subtle);font-weight:600" class="amt">${list.length}</dd>
      <dt style="color:var(--fg-muted);padding:7px 16px 7px 0;border-bottom:1px solid var(--border-subtle)">Net amount leaving the ledger</dt>
      <dd style="margin:0;padding:7px 0;text-align:right;border-bottom:1px solid var(--border-subtle);font-weight:600" class="amt">${rupee(total, { signed: true })}</dd>
      <dt style="color:var(--fg-muted);padding:7px 16px 7px 0;border-bottom:1px solid var(--border-subtle)">Date range touched</dt>
      <dd class="mono" style="margin:0;padding:7px 0;text-align:right;border-bottom:1px solid var(--border-subtle);font-size:12px">${list[list.length-1]?.date} → ${list[0]?.date}</dd>
      <dt style="color:var(--fg-muted);padding:7px 16px 7px 0">Protected, will stay</dt>
      <dd style="margin:0;padding:7px 0;text-align:right" class="amt">${skipped} reconciled</dd>
    </dl>
    <div class="fld"><label for="phrase">Type <code style="color:var(--loss);font-weight:600">${phrase}</code> to enable the button</label>
      <div class="inw"><input id="phrase" autocomplete="off" spellcheck="false" placeholder="${phrase}" data-autofocus></div>
      <span class="hint">The phrase carries the count, so it changes when the filter changes &mdash; a confirmation
      memorised from last time cannot be typed blind on a different scope.</span></div>
  </div>
  <div class="modal-f"><span class="hint sp">One batch &middot; undoable for 30 days</span>
    <button class="btn" data-close>Cancel</button>
    <button class="btn btn-danger" id="raGo" disabled>Remove ${list.length}</button></div>`,
  (m) => {
    m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    const go = m.querySelector("#raGo");
    m.querySelector("#phrase").oninput = (e) => { go.disabled = e.target.value.trim().toLowerCase() !== phrase; };
    go.onclick = () => {
      go.classList.add("loading");
      setTimeout(() => { closeModal(); tombstone(list, "Removed"); }, 600);
    };
  });
}

/* ── undo / redo ──────────────────────────────────────────────── */
function undoLast() {
  const b = batches.shift();
  if (!b) return;
  b.undo(); redoStack.unshift(b); renderLedger();
  toast({ title: "Undone", body: esc(b.label) + ". The reversal of this is itself recorded in Activity." });
}
function redoLast() {
  const b = redoStack.shift();
  if (!b) return;
  b.redo(); batches.unshift(b); renderLedger();
  toast({ title: "Redone", body: esc(b.label) + "." });
}

/* ── Activity: the durable path a toast is not ────────────────── */
function openHistory() {
  const all = [...batches.map((b) => ({ b, undone: false })), ...redoStack.map((b) => ({ b, undone: true }))];
  openModal(`<div class="modal-h"><div><h4>Activity ${NEW}</h4>
    <p>Every mutation, grouped by <code>request_id</code>. This is the durable undo path; the toast is only the fast one.</p></div></div>
  <div class="modal-b">
    ${all.length === 0 ? `<div style="padding:26px 16px;text-align:center">
      <b style="font-size:15px">Nothing changed yet</b>
      <p class="hint" style="margin-top:6px;max-width:46ch;margin-inline:auto">Edit, remove or recategorise a row
      and it appears here. Reads are not recorded; only changes.</p></div>` : `
    <div class="hist">${all.map(({ b, undone }) => `<div class="hist-i ${undone ? "undone" : ""}">
      <span class="hd">${b.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <div class="hb"><b>${esc(b.label)}</b>
        <p><span class="mono">${b.id}</span> &middot; ${b.kind}${undone ? " &middot; undone" : ""}</p></div>
      <span class="ha">${undone
        ? `<span class="bdg sm out-n">undone</span>`
        : `<button class="btn btn-sm" data-undo="${b.id}">${I.undo}<span>Undo</span></button>`}</span>
    </div>`).join("")}</div>`}
    <div class="alrt i"><span class="ai">${I.info}</span><div class="ab"><b>Retention</b>
      <p>Undo stays available for <b>30 days</b> for tombstones (the row is still there with a <code>deletedAt</code>) and
      <b>indefinitely</b> for corrections (undoing one just tombstones the reversal pair). After 30 days a tombstone
      may be purged by a maintenance job and the entry becomes read-only history.</p></div></div>
    <p class="hint">Reading <code>audit_events</code> (schema.ts:1843), which already stores
    <code>beforeJson</code>/<code>afterJson</code>, <code>requestId</code> and <code>entityType</code>. No new table
    is needed for the log &mdash; only the screen, and the <code>restore</code> repository method.</p>
  </div>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-primary" data-close data-autofocus>Close</button></div>`,
  (m) => {
    m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    m.querySelectorAll("[data-undo]").forEach((btn) => btn.onclick = () => {
      const b = batches.find((x) => x.id === btn.dataset.undo);
      if (!b) return;
      b.undo(); batches = batches.filter((x) => x !== b); redoStack.unshift(b);
      closeModal(); renderLedger();
      toast({ title: "Undone from Activity", body: esc(b.label) + "." });
    });
  });
}

function secVerbs() {
  return `
  <div class="sec-head">
    <h1>The five verbs, working</h1>
    <p>A real register. Select rows, open a kebab, correct a transaction and watch the triple appear, undo it,
    try the reconciled row, and try <b>Remove all</b>. Every control below is live.</p>
  </div>
  <div class="spec"><div class="spec-h"><h3>HDFC Savings &middot;&middot;4421 &mdash; October 2026</h3>
    <span class="sh-note">Row 2 is reconciled on purpose. Try to edit it.</span></div>
    <div class="spec-b"><div id="ledger"></div></div></div>

  <div class="spec"><div class="spec-h"><h3>What each verb compiles to</h3></div><div class="spec-b">
    <div class="tscroll" style="border:0"><table class="tax"><thead><tr>
      <th>Verb</th><th>Class A — ledger</th><th>Class B — reference</th><th>Repo today</th></tr></thead><tbody>
      <tr><td><b>Edit</b></td>
        <td><code>reverse()</code> the original on its own date, then post the corrected entry. Three rows, one
        <code>request_id</code>. The table shows the <i>current</i> values with a quiet “corrected” chip; the
        reversal and the original appear only when the trail toggle is on.</td>
        <td>Plain <code>UPDATE</code>. Before/after captured in <code>audit_events</code>.</td>
        <td><span class="mono" style="font-size:10.5px">CorrectTrade ✓ · no ledger equivalent ✕ ${NEW}</span></td></tr>
      <tr><td><b>Remove one</b></td>
        <td>Two honest stories, asked explicitly: <i>never happened</i> &rarr; tombstone; <i>recorded wrongly</i>
        &rarr; reverse. Tombstoning leaves balances and reports but not the audit trail.</td>
        <td>Tombstone. Refused while referenced, with the referencing rows named.</td>
        <td><span class="mono" style="font-size:10.5px">softDelete ✓ · reverse ✓</span></td></tr>
      <tr><td><b>Undo</b></td>
        <td><b>Never reverse-a-reversal.</b> Tombstone the reversal and the replacement; the original returns.
        For a removal, clear <code>deletedAt</code>.</td>
        <td>Write back <code>beforeJson</code>, or clear the tombstone.</td>
        <td><span class="mono" style="font-size:10.5px">restore ✕ ${NEW}</span></td></tr>
      <tr><td><b>Redo</b></td>
        <td>Re-apply the tombstones the undo cleared. Possible, but see the next section &mdash; it is bounded
        hard.</td>
        <td>Write back <code>afterJson</code>. Safe, because the row is mutable by design.</td>
        <td><span class="mono" style="font-size:10.5px">✕ ${NEW}</span></td></tr>
      <tr><td><b>Remove all</b></td>
        <td>The selection is the current filter, resolved server-side at confirm time, not the ids the page
        happened to render. One <code>request_id</code>, one undo.</td>
        <td>Same, with the referential refusals listed up front.</td>
        <td><span class="mono" style="font-size:10.5px">bulkDelete ≈ (page-scoped, 500 cap) · filter-scoped ✕ ${NEW}</span></td></tr>
    </tbody></table></div>
    <p class="why"><b>Why "Remove all" resolves the filter server-side.</b> <code>bulkDeleteTransactionsAction</code>
    today takes a comma-joined id list from the form. That is correct for a visible multi-select and wrong for
    "all in this filter": the user means the 1,240 rows the filter matches, not the 50 the page rendered. The
    filter travels; the ids do not.</p>
  </div></div>`;
}

/* ══════════════════════════════════════════════════════════════ */
/*  SECTION 4 — redo                                               */
/* ══════════════════════════════════════════════════════════════ */
let refRules = [
  { id: "r1", kw: "ZOMATO", cat: "Food & dining", hits: 48 },
  { id: "r2", kw: "IOCL", cat: "Transport", hits: 12 },
  { id: "r3", kw: "TATA POWER", cat: "Utilities", hits: 9 },
];
let refUndo = [], refRedo = [];
function renderRules() {
  const host = document.getElementById("rules");
  if (!host) return;
  host.innerHTML = `
  <div class="tscroll"><table class="dt"><thead><tr>
    <th>Keyword</th><th>Category</th><th class="num">Matches</th><th class="actcell">Actions</th></tr></thead>
  <tbody>${refRules.map((r) => `<tr>
    <td class="mono">${esc(r.kw)}</td><td>${esc(r.cat)}</td><td class="num">${r.hits}</td>
    <td class="actcell"><span class="rowacts pinned">
      <button class="btn btn-sm btn-ghost only" data-edit="${r.id}" aria-label="Edit ${esc(r.kw)} rule">${I.pencil}</button>
      <button class="btn btn-sm btn-ghost only" data-del="${r.id}" aria-label="Remove ${esc(r.kw)} rule">${I.trash}</button>
    </span></td></tr>`).join("")}</tbody></table></div>
  <div class="row" style="margin-top:10px">
    <button class="btn btn-sm" id="rUndo" ${refUndo.length ? "" : "disabled"}>${I.undo}<span>Undo</span></button>
    <button class="btn btn-sm" id="rRedo" ${refRedo.length ? "" : "disabled"}>${I.redo}<span>Redo</span></button>
    <span class="hint" style="margin-left:4px">${refUndo.length} undoable &middot; ${refRedo.length} redoable</span>
  </div>`;
  host.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
    const i = refRules.findIndex((r) => r.id === b.dataset.del);
    const [gone] = refRules.splice(i, 1);
    refUndo.unshift({ label: `Removed rule ${gone.kw}`, undo: () => refRules.splice(i, 0, gone), redo: () => refRules.splice(i, 1) });
    refRedo = []; renderRules();
    toast({ title: `Rule “${esc(gone.kw)}” removed`, body: "Reference data. No posted transaction changed.",
      action: () => { refUndo.shift().undo(); renderRules(); }, actionLabel: "Undo" });
  });
  host.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    const r = refRules.find((x) => x.id === b.dataset.edit);
    const before = r.cat;
    const order = ["Food & dining", "Transport", "Utilities", "Shopping", "Uncategorised"];
    r.cat = order[(order.indexOf(r.cat) + 1) % order.length];
    const after = r.cat;
    refUndo.unshift({ label: `Rule ${r.kw} → ${after}`, undo: () => (r.cat = before), redo: () => (r.cat = after) });
    refRedo = []; renderRules();
    toast({ title: `Rule updated`, body: `${esc(r.kw)} now files to “${esc(after)}”.`,
      action: () => { refUndo.shift().undo(); renderRules(); }, actionLabel: "Undo" });
  });
  host.querySelector("#rUndo").onclick = () => { const c = refUndo.shift(); c.undo(); refRedo.unshift(c); renderRules(); };
  host.querySelector("#rRedo").onclick = () => { const c = refRedo.shift(); c.redo(); refUndo.unshift(c); renderRules(); };
}

function secRedo() {
  return `
  <div class="sec-head"><h1>Redo &mdash; and where it stops</h1>
    <p>Undo is derivable from the ledger. Redo is not derivable from anything, which is the whole problem.
    Here is the reasoning, then the recommendation.</p></div>

  <div class="spec"><div class="spec-h"><h3>The argument</h3></div><div class="spec-b">
    <p class="why"><b>1. Undo needs no memory.</b> Everything it needs is in the rows: a reversal names what it
    reverses, a tombstone carries its <code>deletedAt</code>, and <code>request_id</code> already groups a batch.
    Undo is a <i>query</i> over durable state. It survives a reload, a new device, a week away.</p>
    <p class="why"><b>2. Redo needs memory the schema does not keep &mdash; except it almost does.</b>
    <code>audit_events.beforeJson</code> and <code>afterJson</code> (schema.ts:1843) hold both images already.
    So redo of a class&nbsp;B edit is a replay of <code>afterJson</code>, and redo of a class&nbsp;A removal is
    re-stamping the tombstone the undo cleared. Both are representable today.</p>
    <p class="why"><b>3. What is not representable is redo after anything else happened.</b> If the user undoes a
    correction, then imports a statement, then presses redo, the replay targets rows that other work now depends
    on. In a ledger that is not a stale view &mdash; it is a wrong number in a tax return.</p>
    <div class="alrt s"><span class="ai">${I.info}</span><div class="ab">
      <b>Recommendation: redo exists, but it is a cursor, not a stack.</b>
      <p>Exactly <b>one</b> step deep, session-scoped, user-scoped, and <b>invalidated the moment any newer mutation
      touches an entity in the undone batch</b>. In practice it is the immediate “no wait, I did mean that”
      correction and nothing more. The Redo control disables itself with a reason the moment the cursor is
      invalidated, rather than silently doing something else.</p></div></div>
    <p class="why"><b>Rejected alternative: a true multi-step redo stack for ledger data.</b> It would need a
    command log the app does not have, and every entry in it would be a promise to re-run an operation whose
    preconditions may no longer hold. It would be a second source of truth beside the ledger &mdash; precisely
    what <code>00-INDEX.md</code> decision 9 and 10 exist to prevent. <b>If the user wants only one redo model,
    the honest answer is: redo for class&nbsp;B reference data, and a one-step cursor for class&nbsp;A.</b></p>
    <div class="states">
      <div class="stc"><span class="sl">Class A · redo available</span>
        <button class="btn btn-sm">${I.redo}<span>Redo</span></button>
        <span class="sd">Last action was an undo, nothing has happened since, same session.</span></div>
      <div class="stc"><span class="sl">Class A · invalidated</span>
        <button class="btn btn-sm" aria-disabled="true" disabled>${I.redo}<span>Redo</span></button>
        <span class="sd">“An import posted 34 rows to this account after you undid. Redo would reapply a change
        those rows were not computed against.”</span></div>
      <div class="stc"><span class="sl">Class A · expired</span>
        <button class="btn btn-sm" aria-disabled="true" disabled>${I.redo}<span>Redo</span></button>
        <span class="sd">“Redo is available within this session only. Re-enter the change, or undo the undo from
        Activity.”</span></div>
      <div class="stc"><span class="sl">Class B · unbounded</span>
        <button class="btn btn-sm">${I.redo}<span>Redo</span></button>
        <span class="sd">Reference data is mutable by design, so redo is just another write. Depth 20, per user.</span></div>
    </div>
  </div></div>

  <div class="spec"><div class="spec-h"><h3>Class B redo, working &mdash; keyword rules</h3>
    <span class="sh-note">category_rules · schema.ts:1315 · edit cycles the category</span></div>
    <div class="spec-b">
      <p class="why">Unbounded undo/redo, no reversals, no tombstone archaeology, no confirmation dialog on edit.
      This is what the five verbs feel like when the data is allowed to change. Contrast it directly with the
      ledger table above &mdash; same vocabulary, visibly lighter.</p>
      <div id="rules"></div>
    </div></div>`;
}

/* ══════════════════════════════════════════════════════════════ */
/*  SECTION 5 — affordances                                        */
/* ══════════════════════════════════════════════════════════════ */
function secAffordance() {
  return `
  <div class="sec-head"><h1>Affordance vocabulary</h1>
    <p>Where each verb lives, identically on every table in the app. The rule is <b>one place per verb per
    context</b> &mdash; a verb that appears in two places on the same row is a verb the user has to think about.</p></div>

  <div class="spec"><div class="spec-h"><h3>Placement</h3></div><div class="spec-b">
    <div class="tscroll" style="border:0"><table class="tax"><thead><tr>
      <th>Surface</th><th>Holds</th><th>Never holds</th><th>Why</th></tr></thead><tbody>
      <tr><td><b>Row hover</b></td><td>Nothing but the kebab.</td>
        <td>Edit or delete icons.</td>
        <td>Hover-revealed destructive icons are how a mis-aimed click deletes a transaction. One kebab, always in
        the same column, revealed on hover <i>and</i> on keyboard focus.</td></tr>
      <tr><td><b>Row kebab</b></td><td>Edit, Reverse, Remove, plus the disabled entries with their reasons.</td>
        <td>Remove all.</td>
        <td>A per-row menu must not contain an action whose scope is the whole table.</td></tr>
      <tr><td><b>Selection toolbar</b></td><td>Bulk edit, bulk remove, the mixed-selection explainer, Clear.</td>
        <td>Remove all; single-row verbs.</td>
        <td>It appears only when something is selected, so its scope is unambiguous: the selection.</td></tr>
      <tr><td><b>Table footer bar</b></td><td>Undo, Redo, and Remove all &mdash; in quiet danger styling, at the far end.</td>
        <td>Primary actions.</td>
        <td>Scope is the filter, so it belongs with the filter, not with a row.</td></tr>
      <tr><td><b>Command palette</b> ${NEW}</td><td>Every verb, scoped to the current screen and selection, each
        showing its scope in the item: “Remove all 6 in this filter”.</td>
        <td>Anything that fires without the same confirmation.</td>
        <td><code>cmdk</code> is installed and unwired. A palette that skips the confirm dialog would be the one
        unguarded path to the most destructive action in the product.</td></tr>
      <tr><td><b>Toast</b></td><td>Undo, for 12 seconds.</td><td>Redo, Remove, Edit.</td>
        <td>A toast is a shortcut to Activity, never the only route.</td></tr>
      <tr><td><b>Activity</b> ${NEW}</td><td>Undo of any batch within retention.</td><td>Edit.</td>
        <td>The durable path. Survives navigation, reload and a different device.</td></tr>
    </tbody></table></div>
  </div></div>

  <div class="spec"><div class="spec-h"><h3>Keyboard model</h3>
    <span class="sh-note">Try them on the table in the previous section.</span></div><div class="spec-b">
    <div class="cols2">
      <div class="grp"><span class="lbl">Navigation</span>
        <div class="row"><kbd>&uarr;</kbd><kbd>&darr;</kbd><span class="hint">Move the row cursor</span></div>
        <div class="row"><kbd>Space</kbd><span class="hint">Toggle selection of the cursor row</span></div>
        <div class="row"><kbd>Shift</kbd> <kbd>&uarr;/&darr;</kbd><span class="hint">Extend selection</span></div>
        <div class="row"><kbd>Ctrl</kbd> <kbd>A</kbd><span class="hint">Select all in the filter &mdash; not all in the account</span></div>
        <div class="row"><kbd>Esc</kbd><span class="hint">Clear selection, close menu, close dialog &mdash; in that order</span></div>
      </div>
      <div class="grp"><span class="lbl">Verbs</span>
        <div class="row"><kbd>E</kbd><span class="hint">Edit the cursor row</span></div>
        <div class="row"><kbd>Del</kbd> / <kbd>Backspace</kbd><span class="hint">Remove &mdash; always opens the confirm, never fires directly</span></div>
        <div class="row"><kbd>Ctrl</kbd> <kbd>Z</kbd><span class="hint">Undo the last batch</span></div>
        <div class="row"><kbd>Ctrl</kbd> <kbd>Y</kbd> / <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd><span class="hint">Redo</span></div>
        <div class="row"><kbd>Ctrl</kbd> <kbd>K</kbd><span class="hint">Command palette</span></div>
      </div>
    </div>
    <div class="alrt w"><span class="ai">${I.warn}</span><div class="ab">
      <b>Ctrl/Cmd+Z must not be hijacked when focus is in a text input</b>
      <p>The handler returns immediately when <code>document.activeElement</code> is an <code>input</code>,
      <code>textarea</code>, <code>select</code> or anything <code>contenteditable</code>, or when a dialog is
      open. Inside the edit dialog, Ctrl+Z is the browser's text undo and nothing else &mdash; a user retyping an
      amount and reflexively pressing Ctrl+Z must not reverse a transaction. The same guard applies to
      <kbd>Del</kbd> and the single-letter shortcuts, which is why <kbd>E</kbd> is safe as a bare key.</p></div></div>
    <p class="hint">Single-letter verbs are deliberately rare and non-destructive. Nothing destructive is bound to
    a bare letter, and nothing at all is bound to a bare letter while a text field has focus.</p>
  </div></div>

  <div class="spec"><div class="spec-h"><h3>The row kebab, in every state</h3>
    <span class="sh-note">Disabled entries carry their reason inline — the control is never hidden.</span></div>
    <div class="spec-b"><div class="cols2">
      <div class="grp"><span class="lbl">Ordinary row</span>
        <div class="pop mnu" style="position:static">
          <div class="mnu-sec">This transaction</div>
          <button class="mnu-i">${I.pencil}<span class="t">Edit&hellip;</span><span class="sc">E</span></button>
          <button class="mnu-i">${I.undo}<span class="t">Reverse</span></button>
          <hr class="mnu-sep">
          <button class="mnu-i dgr">${I.trash}<span class="t">Remove</span><span class="sc">Del</span></button>
        </div></div>
      <div class="grp"><span class="lbl">Reconciled row &mdash; L10</span>
        <div class="pop mnu" style="position:static">
          <div class="mnu-sec">This transaction</div>
          <button class="mnu-i" aria-disabled="true">${I.pencil}<span class="t">Edit<small>Reconciled. Postings are immutable (L10).</small></span></button>
          <button class="mnu-i dgr" aria-disabled="true">${I.trash}<span class="t">Remove<small>Remove the reconciliation first.</small></span></button>
          <hr class="mnu-sep">
          <button class="mnu-i">${I.info}<span class="t">Why is this locked?</span></button>
        </div></div>
      <div class="grp"><span class="lbl">A reversal row</span>
        <div class="pop mnu" style="position:static">
          <div class="mnu-sec">This reversal</div>
          <button class="mnu-i" aria-disabled="true">${I.undo}<span class="t">Reverse<small>Reversing a reversal would make the current state unreadable.</small></span></button>
          <hr class="mnu-sep">
          <button class="mnu-i">${I.undo}<span class="t">Undo this correction<small>Tombstones the pair; the original returns.</small></span></button>
        </div></div>
      <div class="grp"><span class="lbl">An UNDONE import batch</span>
        <div class="pop mnu" style="position:static">
          <div class="mnu-sec">Import &middot; HDFC-Oct-2026.pdf</div>
          <button class="mnu-i" aria-disabled="true">${I.undo}<span class="t">Undo import<small>Already undone on 18 Oct. Nothing left to tombstone.</small></span></button>
          <hr class="mnu-sep">
          <button class="mnu-i">${I.arrow}<span class="t">Re-import this file<small>The file hash was freed when the batch was undone (I02).</small></span></button>
        </div></div>
    </div></div></div>`;
}

/* ══════════════════════════════════════════════════════════════ */
/*  SECTION 6 — feedback                                           */
/* ══════════════════════════════════════════════════════════════ */
function secFeedback() {
  return `
  <div class="sec-head"><h1>Feedback, and reversing feedback</h1>
    <p>A toast that disappears is not an audit trail. The toast is the fast path; <b>Activity</b> is the durable
    one, and every toast is a shortcut into it.</p></div>

  <div class="spec"><div class="spec-h"><h3>The three-layer rule</h3></div><div class="spec-b">
    <div class="flow">
      <div class="fnode acc"><b>1 · In place</b><span>The table updates optimistically. The row shows its new
      state before any toast. If the server refuses, the row reverts and the failure is shown <i>on the row</i>,
      not only in a corner.</span></div>
      <div class="farrow">${I.arrow}</div>
      <div class="fnode"><b>2 · Toast, 12s</b><span>Carries the count, the amount, and one Undo. 12 seconds, with
      a visible drain. Hovering or focusing it pauses the timer. Navigating away dismisses it &mdash; and loses
      nothing.</span></div>
      <div class="farrow">${I.arrow}</div>
      <div class="fnode acc"><b>3 · Activity, 30 days</b><span>Reads <code>audit_events</code>. Every batch, undoable
      for as long as its tombstones survive. This is the answer to “I navigated away”.</span></div>
    </div>
    <p class="why"><b>What happens if the user navigates away mid-toast:</b> nothing is lost and nothing is rolled
    back. The action already committed; the toast was only a shortcut. The design must never make the toast
    load-bearing &mdash; no action should be "pending until the toast expires", because that makes a page close
    into a silent commit.</p>
    <div class="row">
      <button class="btn btn-sm" id="demoOk">Show the success toast</button>
      <button class="btn btn-sm" id="demoFail">Show the failure toast</button>
      <button class="btn btn-sm" id="demoPartial">Show the partial-failure toast</button>
    </div>
  </div></div>

  <div class="spec"><div class="spec-h"><h3>Partial failure &mdash; 12 of 15</h3></div><div class="spec-b">
    <p class="why"><b>Decision: a bulk mutation is atomic.</b> All fifteen land or none do, in one database
    transaction, exactly as <code>saveMany</code> already behaves for an import (<i>"an import either lands or does
    not"</i>, transactions.ts:2584). The alternative &mdash; twelve succeed, three fail &mdash; leaves the user looking at a
    table whose state they cannot predict, and an undo whose scope they cannot name.</p>
    <p class="why">So "12 of 15 succeeded" is <b>not</b> a state this design produces. What the user sees instead is
    <b>"Nothing was removed"</b>, the three rows that blocked it, the reason for each, and a <b>Retry without
    them</b> that re-runs the batch at the smaller scope. The retry is a new batch with its own
    <code>request_id</code>, so the undo story stays one-to-one.</p>
    <div class="alrt w"><span class="ai">${I.warn}</span><div class="ab"><b>The cost, stated honestly</b>
      <p>On a 5,000-row removal, one newly reconciled transaction blocks the whole thing. The mitigation is the
      preview: the confirm dialog already counted and named the protected rows, so a surprise at commit time means
      something changed in another tab in the seconds between &mdash; rare, and worth the predictability.</p></div></div>
    <p class="hint">Today <code>bulkDeleteTransactionsAction</code> is deliberately non-atomic and reports what it
    actually tombstoned. That is a reasonable choice for the current page-scoped control and the wrong one for a
    filter-scoped “remove all”. This is a decision the user must confirm.</p>
  </div></div>

  <div class="spec"><div class="spec-h"><h3>Toast specimens</h3></div><div class="spec-b">
    <div class="grp"><div class="row vtop" style="gap:12px">
      <div class="toast ok" style="flex:1 1 320px"><span class="ti">${I.ok}</span><div class="tb">
        <b>6 transactions removed</b><p>Worth −₹1,76,545.00. Tombstoned, not deleted &mdash; the rows stay in Activity.</p>
        <div class="ta"><button class="btn btn-sm">${I.undo}<span>Undo</span></button>
        <button class="btn btn-sm btn-ghost">Dismiss</button></div>
        <div class="tmr"><i style="animation:none;transform:scaleX(.55)"></i></div></div></div>
      <div class="toast er" style="flex:1 1 320px"><span class="ti">${I.warn}</span><div class="tb">
        <b>Nothing was removed</b><p>14 of 15 would have succeeded. &ldquo;Tata Power &mdash; electricity&rdquo; was
        reconciled while this dialog was open, so the batch rolled back.</p>
        <div class="ta"><button class="btn btn-sm">Retry without it (14)</button>
        <button class="btn btn-sm btn-ghost">Show it</button></div></div></div>
    </div></div>
  </div></div>`;
}

/* ══════════════════════════════════════════════════════════════ */
/*  SECTION 7 — states                                             */
/* ══════════════════════════════════════════════════════════════ */
const STATES = [
  ["Edit", [
    ["Pending", "Save button spins, dialog stays open and locked. The row shows a skeleton in the changed cells only.", "ok"],
    ["Success", "Dialog closes, row shows the new values with the old struck through beside them for 8 seconds, then the quiet “corrected” chip remains.", "ok"],
    ["Failure", "Dialog stays open, field-level error under the offending input, nothing lost. “The reversal date is after today, so it was clamped to 21 Oct 2026 — confirm?”", "er"],
    ["Not permitted", "Menu entry greyed with the reason inline: reconciled (L10), or already reversed, or the row is itself a reversal. The control is visible, disabled, and explains itself.", "wn"],
  ]],
  ["Remove one", [
    ["Pending", "Row dims to 55% with a spinner in the status cell; it is not removed from the DOM until the server confirms.", "ok"],
    ["Success", "Row leaves the table, toast with Undo. With the trail toggle on, it stays, struck through, marked “removed”.", "ok"],
    ["Failure", "Row returns to normal, inline error strip below it with Retry. The toast is secondary.", "er"],
    ["Not permitted", "Reconciled; or a buy whose lot has been sold; or a sale with a corporate action after it — trade-corrections.usecases.ts names the blocking rows, because voiding those first is the actual fix.", "wn"],
  ]],
  ["Undo", [
    ["Pending", "Undo button spins in place, in both the toast and Activity. Other verbs on the table are disabled meanwhile.", "ok"],
    ["Success", "Table re-renders, confirmation toast with no further Undo — the undo is itself in Activity, so the loop ends in a surface, not in another toast.", "ok"],
    ["Failure", "“Could not undo: 3 of the 6 rows were reconciled after you removed them.” Names them, offers undo of the rest as a new batch.", "er"],
    ["Not permitted", "Past retention, or the batch is an import that was already UNDONE, or a newer correction depends on the rows. Reason stated, with the next best action.", "wn"],
  ]],
  ["Redo", [
    ["Pending", "Same as undo.", "ok"],
    ["Success", "Table re-renders; redo is now empty.", "ok"],
    ["Failure", "“Redo could not be applied — the account was reconciled since.” Offers to re-enter the change manually.", "er"],
    ["Not permitted", "Cursor invalidated by newer work, new session, or class A beyond one step. Disabled with the reason, never hidden.", "wn"],
  ]],
  ["Remove all", [
    ["Pending", "Modal stays open with a determinate progress bar and a live count; cancel is offered until commit and is honest about what it can still stop.", "ok"],
    ["Success", "Table empties to a designed empty state that names the filter, not a blank slate. Toast + a persistent banner above the table for the session: “6 removed from this filter · Undo”.", "ok"],
    ["Failure", "Nothing removed. The blocking rows are listed with reasons and a Retry at the reduced scope.", "er"],
    ["Not permitted", "Filter matches zero rows → the button is disabled with “nothing in this filter to remove”. Filter matches everything with no filter applied → the button refuses and asks for a filter first.", "wn"],
  ]],
];
function secStates() {
  return `
  <div class="sec-head"><h1>Every verb, every state</h1>
    <p>“Not permitted” is the state that matters most here, and it has one rule: <b>show the control, disable it,
    and say why.</b> Hiding it teaches the user the feature does not exist; letting the click fail teaches them the
    app is unreliable.</p></div>
  ${STATES.map(([verb, list]) => `
  <div class="spec"><div class="spec-h"><h3>${verb}</h3></div><div class="spec-b" style="padding:0">
    <div class="states">${list.map(([n, d, k]) => `<div class="stc">
      <span class="sl" style="color:${k === "er" ? "var(--loss)" : k === "wn" ? "var(--warn)" : "var(--fg-muted)"}">${n}</span>
      <span class="sd">${d}</span></div>`).join("")}</div>
  </div></div>`).join("")}
  <div class="spec"><div class="spec-h"><h3>Decisions the user must make</h3></div><div class="spec-b">
    <ol style="margin:0;padding-left:20px;font-size:13px;line-height:21px;color:var(--fg-secondary)">
      <li><b>Is a filter-scoped bulk mutation atomic?</b> This design says yes. It contradicts today's
        <code>bulkDeleteTransactionsAction</code>, which is deliberately per-row and reports what it managed.</li>
      <li><b>Does redo exist for ledger data at all?</b> Recommended: one step, session-scoped, invalidated by
        newer work. The alternative is class&nbsp;B only.</li>
      <li><b>Tombstone retention.</b> 30 days proposed. After that, undo of a removal is impossible and Activity
        becomes read-only history.</li>
      <li><b>Does editing a class&nbsp;B header offer to restate the postings it already produced?</b> Recommended:
        yes, as a separate confirmed step.</li>
      <li><b>Is the typed-phrase confirmation right for “remove all”,</b> or is a count-match (“type 6”) enough?</li>
      <li><b>Does “remove all” require a filter?</b> Recommended: yes — refuse on an unfiltered table.</li>
      <li><b>Saved views</b> need a storage table that does not exist. Already flagged in the research doc.</li>
      <li><b>Does the command palette get the destructive verbs at all,</b> or only the navigational ones?</li>
    </ol>
  </div></div>`;
}

/* ══════════════════════════════════════════════════════════════ */
const SECTIONS = [
  ["model", "The model", secModel],
  ["taxonomy", "Data classes", secTaxonomy],
  ["verbs", "Five verbs", secVerbs],
  ["redo", "Redo", secRedo],
  ["affordance", "Affordances", secAffordance],
  ["feedback", "Feedback", secFeedback],
  ["states", "States", secStates],
];
let current = "model";
const bench = document.getElementById("bench");
const secnav = document.getElementById("secnav");
secnav.innerHTML = SECTIONS.map(([id, label]) => `<button data-s="${id}">${label}</button>`).join("");
function show(id) {
  current = id;
  secnav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.s === id)));
  bench.innerHTML = SECTIONS.find((s) => s[0] === id)[2]();
  window.scrollTo({ top: 0, behavior: "instant" });
  if (id === "verbs") renderLedger();
  if (id === "redo") renderRules();
  if (id === "feedback") wireFeedbackDemos();
}
secnav.querySelectorAll("button").forEach((b) => (b.onclick = () => show(b.dataset.s)));

function wireFeedbackDemos() {
  document.getElementById("demoOk").onclick = () => toast({ title: "6 transactions removed",
    body: "Worth −₹1,76,545.00. Tombstoned, not deleted.", action: () => toast({ title: "Restored" }), actionLabel: "Undo" });
  document.getElementById("demoFail").onclick = () => toast({ kind: "er", title: "Could not remove",
    body: "“HDFC Bank — salary credit” is reconciled (L10). Remove the reconciliation first.", timer: false,
    action: () => toast({ title: "Opening reconciliation…" }), actionLabel: "Open reconciliation" });
  document.getElementById("demoPartial").onclick = () => toast({ kind: "er", title: "Nothing was removed", timer: false,
    body: "14 of 15 would have succeeded. The batch rolled back so the table still matches what you see.",
    action: () => toast({ title: "Retrying 14…" }), actionLabel: "Retry without it (14)" });
}

/* ── global keyboard, with the text-input guard ──────────────── */
function inText(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
}
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  // HARD GUARD: never hijack undo/redo while typing, or while a dialog is open.
  if (inText(document.activeElement) || !scrim.hidden) return;
  if (current !== "verbs") return;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undoLast(); return; }
  if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) { e.preventDefault(); redoLast(); return; }
  if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); liveRows().forEach((r) => selected.add(r.id)); renderLedger(); return; }
  if (mod) return;
  const vis = liveRows();
  if (e.key === "ArrowDown") { e.preventDefault(); kbIndex = Math.min(kbIndex + 1, vis.length - 1); renderLedger(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); kbIndex = Math.max(kbIndex - 1, 0); renderLedger(); }
  else if (e.key === " ") { e.preventDefault(); const r = vis[kbIndex]; if (r) { selected.has(r.id) ? selected.delete(r.id) : selected.add(r.id); renderLedger(); } }
  else if (e.key === "Escape") { if (selected.size) { selected.clear(); renderLedger(); } }
  else if (e.key.toLowerCase() === "e") { const r = vis[kbIndex]; if (r && !r.recon && r.kind !== "reversal" && r.state !== "void") openEdit(r); else if (r) toast({ kind: "wn", title: "Cannot edit this row", body: r.recon ? "Reconciled — postings are immutable (L10)." : "This row is a reversal or already removed." }); }
  else if (e.key === "Delete" || e.key === "Backspace") { const r = vis[kbIndex]; if (r && !r.recon && r.state !== "void") { e.preventDefault(); confirmRemoveOne(r); } }
});

/* theme */
const themeBtn = document.getElementById("themeBtn");
themeBtn.onclick = () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : cur === "light" ? "dark" :
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", next);
};

show("model");
