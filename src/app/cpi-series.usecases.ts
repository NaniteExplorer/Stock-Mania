/**
 * CPI Urban series use cases (net-worth-age-chart.md § "CPI series").
 *
 * The owner types each published monthly index; nothing is fetched. Invalid
 * input is returned as a `ValidationError`, never written.
 */
import { Err, Ok, ValidationError, type AppError, type Result, type UseCase, type UserId } from "@/core/kernel";
import { cpiPoint, type CpiPoint, type CpiSeriesReader, type CpiSeriesWriter } from "@/domain/cpi-series";

export interface RecordCpiPointInput {
  readonly userId: UserId;
  readonly month: string;
  readonly base: string;
  /** Decimal text as published, e.g. "193.4". */
  readonly index: string;
  readonly source: string;
}

export class RecordCpiPoint implements UseCase<RecordCpiPointInput, CpiPoint> {
  constructor(private readonly writer: CpiSeriesWriter) {}

  async execute(input: RecordCpiPointInput): Promise<Result<CpiPoint, AppError>> {
    let point: CpiPoint;
    try {
      point = cpiPoint(input);
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    await this.writer.record(input.userId, point);
    return Ok(point);
  }
}

export class RemoveCpiPoint implements UseCase<{ readonly userId: UserId; readonly month: string }, void> {
  constructor(private readonly writer: CpiSeriesWriter) {}

  async execute({ userId, month }: { readonly userId: UserId; readonly month: string }): Promise<Result<void, AppError>> {
    try {
      await this.writer.remove(userId, month);
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    return Ok();
  }
}

export class LoadCpiSeries implements UseCase<{ readonly userId: UserId }, readonly CpiPoint[]> {
  constructor(private readonly reader: CpiSeriesReader) {}

  async execute({ userId }: { readonly userId: UserId }): Promise<Result<readonly CpiPoint[], AppError>> {
    return Ok(await this.reader.list(userId));
  }
}
