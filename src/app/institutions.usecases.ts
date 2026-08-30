/**
 * Platform use cases: register one, correct it, archive it, list them.
 *
 * These are deliberately thin. A platform has no money in it, so there is no
 * posting to get right and no invariant to defend beyond "two spellings are not
 * two platforms" — which is enforced by matching on the normalised name before
 * every insert, in {@link RegisterInstitution}, so a seed re-run and a
 * hand-typed "tanishq" both land on the row that already exists.
 *
 * Archive rather than delete is the whole policy for the lifecycle. A broker you
 * have closed still owns every trade you ever placed there; removing it would
 * orphan the history or, worse, silently re-bucket it. So archiving hides the
 * platform from pickers and changes nothing about what it holds, and
 * {@link DeleteInstitution} exists only for the genuine mistake — a platform
 * that never held anything.
 */

import {
  AppError,
  Err,
  NotFoundError,
  Ok,
  Result,
  UseCase,
  UserId,
  ValidationError,
  newUuid,
} from "@/core/kernel";
import { Percentage } from "@/core/numeric";
import {
  Institution,
  InstitutionId,
  InstitutionKind,
  InstitutionRepository,
} from "@/domain/institutions";
import { InstrumentRepository } from "@/domain/instruments";

/* ═══ Register ════════════════════════════════════════════════════════ */

export interface RegisterInstitutionInput {
  userId: UserId;
  name: string;
  kind: InstitutionKind;
  /** An id from the shipped catalogue, for the logo. Null for one of your own. */
  providerId?: string | null;
  country?: string;
  notes?: string | null;
}

export interface RegisterInstitutionOutput {
  readonly institutionId: InstitutionId;
  /** True when the platform already existed and this call changed nothing. */
  readonly alreadyExisted: boolean;
}

export class RegisterInstitution
  implements UseCase<RegisterInstitutionInput, RegisterInstitutionOutput>
{
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute(
    input: RegisterInstitutionInput,
  ): Promise<Result<RegisterInstitutionOutput, AppError>> {
    const name = input.name.trim();
    if (name === "") {
      return Err(new ValidationError("Give the platform a name.", { name: ["Required"] }));
    }

    /*
     * Idempotent on the normalised name rather than failing. Registering a
     * platform is something a form does on the way to something else — adding a
     * holding — and refusing there would strand the user on a screen asking them
     * to go and find the row that already exists.
     */
    const existing = await this.institutions.findByName(input.userId, name);
    if (existing) {
      return Ok({ institutionId: existing.id, alreadyExisted: true });
    }

    let institution: Institution;
    try {
      institution = new Institution({
        id: InstitutionId.from(newUuid()),
        userId: input.userId,
        name,
        kind: input.kind,
        providerId: input.providerId ?? null,
        country: input.country ?? "IN",
        notes: input.notes ?? null,
      });
    } catch (error) {
      return Err(new ValidationError((error as Error).message, { name: ["Invalid"] }));
    }

    await this.institutions.save(institution);
    return Ok({ institutionId: institution.id, alreadyExisted: false });
  }
}

/* ═══ Update ══════════════════════════════════════════════════════════ */

export interface UpdateInstitutionInput {
  userId: UserId;
  institutionId: InstitutionId;
  name?: string;
  kind?: InstitutionKind;
  providerId?: string | null;
  country?: string;
  /**
   * How far under the benchmark this platform buys back.
   *
   * Editable after the fact because it is a commercial term the platform can
   * change and the user can mistype, and nothing is derived from it that a
   * correction would invalidate: it is applied at read time to today's price,
   * never stored into a lot or a posting.
   */
  sellSpread?: Percentage;
  notes?: string | null;
}

export class UpdateInstitution implements UseCase<UpdateInstitutionInput, { ok: true }> {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute(input: UpdateInstitutionInput): Promise<Result<{ ok: true }, AppError>> {
    const existing = await this.institutions.findById(input.userId, input.institutionId);
    if (!existing) return Err(new NotFoundError("Platform", input.institutionId.value));

    if (input.name !== undefined && input.name.trim() !== existing.name) {
      /*
       * A rename that collides with another platform is refused rather than
       * merged. Merging two platforms means re-pointing every instrument, lease
       * and account at one of them and is a migration, not a rename — and doing
       * it silently behind a text field is how a portfolio ends up attributed to
       * the wrong broker.
       */
      const clash = await this.institutions.findByName(input.userId, input.name);
      if (clash && !clash.id.equals(existing.id)) {
        return Err(
          new ValidationError(
            `"${clash.name}" already exists. Rename that one first, or point these holdings at it — ` +
              `merging two platforms is not something a rename can do safely.`,
            { name: ["Already exists"] },
          ),
        );
      }
    }

    try {
      await this.institutions.save(
        existing.with({
          name: input.name ?? existing.name,
          kind: input.kind ?? existing.kind,
          providerId: input.providerId === undefined ? existing.props.providerId : input.providerId,
          country: input.country ?? existing.props.country,
          sellSpread: input.sellSpread ?? existing.sellSpread,
          notes: input.notes === undefined ? existing.props.notes : input.notes,
        }),
      );
    } catch (error) {
      return Err(new ValidationError((error as Error).message, { name: ["Invalid"] }));
    }
    return Ok({ ok: true });
  }
}

/* ═══ Archive and restore ═════════════════════════════════════════════ */

export interface ArchiveInstitutionInput {
  userId: UserId;
  institutionId: InstitutionId;
  restore?: boolean;
}

export class ArchiveInstitution implements UseCase<ArchiveInstitutionInput, { ok: true }> {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute(input: ArchiveInstitutionInput): Promise<Result<{ ok: true }, AppError>> {
    const existing = await this.institutions.findById(input.userId, input.institutionId);
    if (!existing) return Err(new NotFoundError("Platform", input.institutionId.value));
    await this.institutions.save(input.restore ? existing.restore() : existing.archive());
    return Ok({ ok: true });
  }
}

/* ═══ Delete ══════════════════════════════════════════════════════════ */

export interface DeleteInstitutionInput {
  userId: UserId;
  institutionId: InstitutionId;
}

/**
 * Removes a platform that never held anything.
 *
 * Refused the moment an instrument points at it, and the message says to archive
 * instead. The distinction is the same one the ledger draws between a reversal
 * and a delete: archive says "this is over", delete says "this never was", and
 * only the second is true of a platform added by a mis-click.
 */
export class DeleteInstitution implements UseCase<DeleteInstitutionInput, { ok: true }> {
  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly instruments: InstrumentRepository,
  ) {}

  async execute(input: DeleteInstitutionInput): Promise<Result<{ ok: true }, AppError>> {
    const existing = await this.institutions.findById(input.userId, input.institutionId);
    if (!existing) return Err(new NotFoundError("Platform", input.institutionId.value));

    const held = await this.instruments.list(input.userId, { includeClosed: true });
    const attached = held.filter(
      (instrument) => instrument.institutionId?.value === input.institutionId.value,
    );
    if (attached.length > 0) {
      const names = attached
        .slice(0, 4)
        .map((instrument) => instrument.symbol)
        .join(", ");
      return Err(
        new ValidationError(
          `${existing.name} holds ${attached.length} instrument(s) — ${names}` +
            `${attached.length > 4 ? ", …" : ""}. Archive it instead; that hides it from every ` +
            `picker and keeps the history attributed to it.`,
          { institutionId: ["Still in use"] },
        ),
      );
    }

    await this.institutions.softDelete(input.userId, input.institutionId);
    return Ok({ ok: true });
  }
}

/* ═══ List ════════════════════════════════════════════════════════════ */

export interface ListInstitutionsInput {
  userId: UserId;
  includeArchived?: boolean;
  /** Narrows to the kinds a form should offer, e.g. bullion vaults for grams. */
  kinds?: readonly InstitutionKind[];
}

export class ListInstitutions
  implements UseCase<ListInstitutionsInput, { institutions: readonly Institution[] }>
{
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute(
    input: ListInstitutionsInput,
  ): Promise<Result<{ institutions: readonly Institution[] }, AppError>> {
    const all = await this.institutions.list(input.userId, {
      includeArchived: input.includeArchived,
    });
    const wanted = input.kinds;
    return Ok({
      institutions: wanted ? all.filter((one) => wanted.includes(one.kind)) : all,
    });
  }
}
