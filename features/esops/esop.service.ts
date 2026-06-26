import { esopRepository } from "./esop.repository";
import type { EsopGrant, CreateEsopInput, UpdateEsopInput } from "./esop.types";

export const esopService = {
  list(userId: string): Promise<EsopGrant[]> {
    return esopRepository.listByUser(userId);
  },
  create(userId: string, input: CreateEsopInput): Promise<EsopGrant> {
    return esopRepository.create(userId, input);
  },
  update(id: string, userId: string, input: UpdateEsopInput): Promise<void> {
    return esopRepository.update(id, userId, input);
  },
  remove(id: string, userId: string): Promise<void> {
    return esopRepository.remove(id, userId);
  },
  async vestedValue(userId: string): Promise<number> {
    const grants = await esopRepository.listByUser(userId);
    return grants.reduce((sum, g) => sum + g.vestedValue, 0);
  },
};
