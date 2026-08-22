/**
 * Base class for value objects.
 *
 * A value object has no identity — it *is* its components. Two of them are equal
 * when their components are equal, and they are immutable, so once constructed a
 * value object is always valid. Validation therefore belongs in the constructor
 * (or a static factory), never in the caller.
 */
export abstract class ValueObject {
  /**
   * The values that define this object's identity, in a stable order.
   * Implementations return primitives or nested value objects.
   */
  protected abstract components(): readonly unknown[];

  equals(other: this | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (other.constructor !== this.constructor) return false;

    const mine = this.components();
    const theirs = other.components();
    if (mine.length !== theirs.length) return false;

    return mine.every((component, index) => {
      const counterpart = theirs[index];
      if (component instanceof ValueObject) {
        return component.equals(counterpart as typeof component);
      }
      return component === counterpart;
    });
  }
}
