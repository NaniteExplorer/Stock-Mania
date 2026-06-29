import { liabilityRepository } from "./liability.repository";
import type { Liability, CreateLiabilityInput, UpdateLiabilityInput } from "./liability.types";

export const liabilityService = {
  list(userId: string): Promise<Liability[]> {
    return liabilityRepository.listByUser(userId);
  },
  create(userId: string, input: CreateLiabilityInput): Promise<Liability> {
    return liabilityRepository.create(userId, input);
  },
  update(id: string, userId: string, input: UpdateLiabilityInput): Promise<void> {
    return liabilityRepository.update(id, userId, input);
  },
  remove(id: string, userId: string): Promise<void> {
    return liabilityRepository.remove(id, userId);
  },
  async total(userId: string): Promise<number> {
    const items = await liabilityRepository.listByUser(userId);
    return items.reduce((sum, l) => sum + (l.outstanding || 0), 0);
  },
};
