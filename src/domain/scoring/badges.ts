/**
 * Badges — what may be rewarded, and what never may (task 3.10).
 *
 * Product §8. A badge marks **reaching a state that is slow and real**: six months
 * of runway, a loan closed, health cover in force. It never rewards activity:
 * a randomised experiment (OSC/BIT 2024) found points for trading produced 39%
 * more trades, so a badge for *doing more* is a badge for doing harm. No
 * leaderboards, no breakable streaks, no loss framing, no celebration of a gain,
 * and never anything on a tier drop.
 *
 * The rule is enforced twice. In the type: a criterion reads a `StateSnapshot`,
 * which carries **states** and nothing that counts activity. And in the data:
 * `BADGE_CRITERIA` is a table — field read, test, threshold and its provenance —
 * which the spec scans for any reference to a count or a frequency.
 */

import type { Money } from "@/core/money";
import { Months } from "@/core/units";
import { INDICATORS } from "./indicators";
import { threshold, type Threshold } from "./provenance";

/** Facts about where the owner stands. Deliberately nothing that counts actions. */
export interface StateSnapshot {
  readonly runway: Months | null;
  readonly healthCover: "covered" | "declared-absent" | "unknown";
  readonly termCover: "covered" | "declared-absent" | "unknown";
  /** Loans fully repaid, ever — a state reached, not an action repeated. */
  readonly loansClosed: readonly { readonly id: string; readonly name: string }[];
  /** Outstanding card balance carried past a due date, if any. */
  readonly revolvingCardDebt: Money | null;
}

/** The tests a criterion may apply. None counts or times anything. */
export type CriterionTest = "AT_LEAST_MONTHS" | "IS_COVERED" | "ANY_REACHED" | "NONE_CARRIED";

export interface BadgeCriterion {
  readonly badgeId: string;
  readonly title: string;
  /** What reaching it means, in plain words. Shown instead of any celebration. */
  readonly meaning: string;
  /** The single snapshot field the criterion reads. */
  readonly reads: keyof StateSnapshot;
  readonly test: CriterionTest;
  /** The threshold, with its source; null when the test is a presence test. */
  readonly threshold: Threshold<Months> | null;
}

const runway = INDICATORS.find((candidate) => candidate.id === "runway-months")!;
const runwayTarget = runway.benchmark;

export const BADGE_CRITERIA: readonly BadgeCriterion[] = Object.freeze([
  Object.freeze({
    badgeId: "runway-six",
    title: "Six months of runway",
    meaning: "Liquid assets cover six months of your usual outgo.",
    reads: "runway",
    test: "AT_LEAST_MONTHS",
    threshold: threshold(Months("value" in runwayTarget ? runwayTarget.value : Number.NaN), { kind: "CITED", citation: runway.citation }),
  }),
  Object.freeze({
    badgeId: "health-covered",
    title: "Health cover in force",
    meaning: "A health policy is active. This marks presence, not whether the amount is enough.",
    reads: "healthCover",
    test: "IS_COVERED",
    threshold: null,
  }),
  Object.freeze({
    badgeId: "loan-closed",
    title: "A loan closed",
    meaning: "A loan has been repaid in full.",
    reads: "loansClosed",
    test: "ANY_REACHED",
    threshold: null,
  }),
  Object.freeze({
    badgeId: "no-revolving-card",
    title: "No card balance carried",
    meaning: "Every card is paid by its due date, so no card interest is accruing.",
    reads: "revolvingCardDebt",
    test: "NONE_CARRIED",
    threshold: null,
  }),
] satisfies BadgeCriterion[]);

type Evaluator = (state: StateSnapshot, criterion: BadgeCriterion) => boolean;

/** Exhaustive over the tests: a new test without a row does not compile. */
const EVALUATE: Readonly<Record<CriterionTest, Evaluator>> = Object.freeze({
  AT_LEAST_MONTHS: (state, criterion) => {
    const value = state[criterion.reads];
    return typeof value === "number" && criterion.threshold !== null && value >= criterion.threshold.value;
  },
  IS_COVERED: (state, criterion) => state[criterion.reads] === "covered",
  ANY_REACHED: (state, criterion) => {
    const value = state[criterion.reads];
    return Array.isArray(value) && value.length > 0;
  },
  // Unknown (null) earns nothing: unknown is not zero.
  NONE_CARRIED: (state) => state.revolvingCardDebt !== null && !state.revolvingCardDebt.isPositive,
});

export interface Badge {
  readonly id: string;
  readonly title: string;
  readonly meaning: string;
  readonly criterion: BadgeCriterion;
  readonly earned: (state: StateSnapshot) => boolean;
}

export const BADGES: readonly Badge[] = Object.freeze(
  BADGE_CRITERIA.map((criterion) =>
    Object.freeze({
      id: criterion.badgeId,
      title: criterion.title,
      meaning: criterion.meaning,
      criterion,
      earned: (state: StateSnapshot) => EVALUATE[criterion.test](state, criterion),
    }),
  ),
);

/**
 * Badges held in `state`. **Badges are not taken away with fanfare:** one that is
 * no longer met simply stops being listed — no "lost" event exists to show.
 * There is no ranking, ordering by others, or leaderboard: the result is the
 * owner's own badges in registry order.
 */
export function badgesHeld(state: StateSnapshot): readonly Badge[] {
  return Object.freeze(BADGES.filter((badge) => badge.earned(state)));
}

/** Kept so a test can assert the refusal list stays part of the contract. */
export const NEVER_REWARDED = Object.freeze([
  "transaction, trade or login counts or frequency",
  "leaderboards or comparison with other people",
  "streaks that can be broken, or loss-framed progress",
  "a market gain, or beating an index",
  "a tier drop, in any form",
] as const);
