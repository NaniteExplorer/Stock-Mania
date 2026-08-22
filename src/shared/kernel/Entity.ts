import type { UniqueId } from "./UniqueId";

/**
 * Base class for entities: objects with a lifecycle and a stable identity.
 *
 * Two entities are the same entity when their ids match, regardless of whether
 * their other fields currently agree — that is what distinguishes an entity from
 * a {@link ValueObject}.
 */
export abstract class Entity<TId extends UniqueId> {
  protected constructor(readonly id: TId) {}

  equals(other: Entity<TId> | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (other.constructor !== this.constructor) return false;
    return this.id.equals(other.id);
  }
}

/**
 * An aggregate root is the single entry point to a cluster of objects that must
 * stay consistent together — a `JournalEntry` and its `Posting`s, for instance.
 *
 * Two rules follow from that, and they are why the ledger cannot drift:
 *   1. Outside code may only hold a reference to the root, never to a child.
 *   2. The root enforces the invariants of the whole cluster in its constructor,
 *      so an invalid aggregate cannot be brought into existence.
 *
 * Repositories load and save whole aggregates, never fragments of one.
 */
export abstract class AggregateRoot<TId extends UniqueId> extends Entity<TId> {}
