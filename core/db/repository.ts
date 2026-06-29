/**
 * Persistence abstraction.
 *
 * Services depend on these interfaces, never on Mongoose/Mongo directly — so a
 * Postgres (Prisma / Drizzle) implementation can be swapped in next session
 * without touching any domain logic.
 */
export interface ReadRepository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findMany(filter?: Partial<T>): Promise<T[]>;
}

export interface WriteRepository<T> {
  create(data: Partial<T>): Promise<T>;
  deleteOne(filter: Partial<T>): Promise<boolean>;
}

export interface Repository<T, ID = string>
  extends ReadRepository<T, ID>,
    WriteRepository<T> {}
