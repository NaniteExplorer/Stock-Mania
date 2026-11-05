import { Page } from "../../../../components/ui/page-shell";
import { Skeleton } from "../../../../components/ui/skeleton";
import styles from "./allocation.module.css";

/** Skeleton hero + 3 rows (DESIGN §9d part 2 states). */
export default function Loading() {
  return <Page>
    <div className={styles.loading} role="status" aria-busy="true">
      <span className={styles.note}>Loading target allocation…</span>
      <Skeleton className={styles.skelHero} />
      <Skeleton className={styles.skelRow} />
      <Skeleton className={styles.skelRow} />
      <Skeleton className={styles.skelRow} />
    </div>
  </Page>;
}
