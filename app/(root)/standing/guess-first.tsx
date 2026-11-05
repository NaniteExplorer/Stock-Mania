"use client";

import { useState, type ReactNode } from "react";
import { Radio } from "../../../components/ui/radio";
import { Button } from "../../../components/ui/button";
import type { Tier } from "@/domain/scoring/tiers";
import { revealSentence } from "./standing-model";
import styles from "./standing.module.css";

/**
 * Guess first (DESIGN §9f.1, owner decision 2026-11-03): it covers **both** the
 * tier and percentile placement. The tier, the score and everything that would
 * reveal them stay hidden until the owner commits to a tier; percentile placement
 * (3.8) renders inside the same gate when it lands, never beside it.
 */
export function GuessFirst({ options, actual, children }: {
  options: readonly { tier: Tier; label: string }[];
  actual: Tier;
  children: ReactNode;
}) {
  const [choice, setChoice] = useState<Tier | null>(null);
  const [guess, setGuess] = useState<Tier | null>(null);
  if (guess !== null) {
    return <div className={styles.stack}>
      <p className={styles.line} role="status">{revealSentence(guess, actual)}</p>
      {children}
    </div>;
  }
  return <form className={styles.guess} onSubmit={(event) => { event.preventDefault(); if (choice) setGuess(choice); }}>
    <fieldset className={styles.guess}>
      <legend className={styles.legend}>Before you see the score: which tier do you think you are in?</legend>
      <div className={styles.choices}>
        {options.map((option) => <Radio key={option.tier} name="tier-guess" value={option.tier} label={option.label}
          checked={choice === option.tier} onChange={() => setChoice(option.tier)} />)}
      </div>
    </fieldset>
    <div><Button type="submit" disabled={choice === null}>Show my score</Button></div>
    <p className={styles.note}>Tier names are placeholders until they are settled.</p>
  </form>;
}
