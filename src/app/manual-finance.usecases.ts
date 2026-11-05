import { AppError, Err, Ok, ValidationError, newUuid, type Result, type UseCase, type UserId } from "@/core/kernel";
import { Commitment, type CommitmentFields, type CommitmentWriter } from "@/domain/commitments";
import { IncomeStream, type IncomeStreamFields, type IncomeWriter } from "@/domain/income";
import { InsurancePolicy, type InsurancePolicyFields, type InsuranceWriter } from "@/domain/insurance";

export interface CreateInsurancePolicyInput {
  readonly userId: UserId;
  readonly fields: Omit<InsurancePolicyFields, "id">;
}

export interface CreateIncomeStreamInput {
  readonly userId: UserId;
  readonly fields: Omit<IncomeStreamFields, "id">;
}

export interface CreateCommitmentInput {
  readonly userId: UserId;
  readonly fields: Omit<CommitmentFields, "id">;
}

/** Expected validation failures are values; unexpected persistence failures remain observable. */
async function createRecord<T extends { readonly id: string }>(
  construct: () => T,
  persist: (record: T) => Promise<void>,
): Promise<Result<{ id: string }>> {
  try {
    const record = construct();
    await persist(record);
    return Ok({ id: record.id });
  } catch (error) {
    if (error instanceof AppError) return Err(error);
    if (error instanceof RangeError) return Err(new ValidationError(error.message));
    throw error;
  }
}

export class CreateInsurancePolicy implements UseCase<CreateInsurancePolicyInput, { id: string }> {
  constructor(private readonly writer: InsuranceWriter) {}

  execute(input: CreateInsurancePolicyInput): Promise<Result<{ id: string }>> {
    return createRecord(
      () => new InsurancePolicy({ ...input.fields, id: newUuid() }),
      (policy) => this.writer.create(input.userId, policy),
    );
  }
}

export class CreateIncomeStream implements UseCase<CreateIncomeStreamInput, { id: string }> {
  constructor(private readonly writer: IncomeWriter) {}

  execute(input: CreateIncomeStreamInput): Promise<Result<{ id: string }>> {
    return createRecord(
      () => new IncomeStream({ ...input.fields, id: newUuid() }),
      (stream) => this.writer.create(input.userId, stream),
    );
  }
}

export class CreateCommitment implements UseCase<CreateCommitmentInput, { id: string }> {
  constructor(private readonly writer: CommitmentWriter) {}

  execute(input: CreateCommitmentInput): Promise<Result<{ id: string }>> {
    return createRecord(
      () => new Commitment({ ...input.fields, id: newUuid() }),
      (commitment) => this.writer.create(input.userId, commitment),
    );
  }
}
