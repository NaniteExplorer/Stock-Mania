/**
 * Repository layer — the ONLY place that talks to MongoDB for accounts.
 * It maps raw Mongo rows to clean domain entities (`toEntity`) so the service
 * and UI never see Mongo internals. The `AccountRepository` interface means a
 * different datastore could be swapped in later without touching the service.
 * (This file is the template the other wealth repositories follow.)
 */
import { connectToDatabase } from "@/core/db/connection";
import { Account } from "./account.model";
import type { Account as AccountEntity, CreateAccountInput, UpdateAccountInput } from "./account.types";

type Row = {
  _id: unknown;
  userId: string;
  name: string;
  institution: string;
  providerId?: string | null;
  currency?: string;
  type: AccountEntity["type"];
  balance: number;
  last4: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const toEntity = (row: Row): AccountEntity => ({
  id: String(row._id),
  userId: row.userId,
  name: row.name,
  institution: row.institution,
  providerId: row.providerId ?? null,
  currency: row.currency ?? "INR",
  type: row.type,
  balance: row.balance,
  last4: row.last4 ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export interface AccountRepository {
  listByUser(userId: string): Promise<AccountEntity[]>;
  create(userId: string, input: CreateAccountInput): Promise<AccountEntity>;
  update(id: string, userId: string, input: UpdateAccountInput): Promise<void>;
  remove(id: string, userId: string): Promise<void>;
}

class MongoAccountRepository implements AccountRepository {
  async listByUser(userId: string): Promise<AccountEntity[]> {
    await connectToDatabase();
    const rows = await Account.find({ userId }).sort({ createdAt: -1 }).lean<Row[]>();
    return rows.map(toEntity);
  }

  async create(userId: string, input: CreateAccountInput): Promise<AccountEntity> {
    await connectToDatabase();
    const doc = await Account.create({
      userId,
      name: input.name,
      institution: input.institution ?? "",
      providerId: input.providerId ?? null,
      currency: input.currency ?? "INR",
      type: input.type,
      balance: input.balance,
      last4: input.last4 ?? null,
    });
    return toEntity(doc.toObject() as Row);
  }

  async update(id: string, userId: string, input: UpdateAccountInput): Promise<void> {
    await connectToDatabase();
    await Account.updateOne({ _id: id, userId }, { $set: input });
  }

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Account.deleteOne({ _id: id, userId });
  }
}

export const accountRepository: AccountRepository = new MongoAccountRepository();
