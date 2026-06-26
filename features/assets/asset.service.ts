import { assetRepository } from "./asset.repository";
import type { Asset, CreateAssetInput, UpdateAssetInput } from "./asset.types";

export const assetService = {
  list(userId: string): Promise<Asset[]> {
    return assetRepository.listByUser(userId);
  },
  create(userId: string, input: CreateAssetInput): Promise<Asset> {
    return assetRepository.create(userId, input);
  },
  update(id: string, userId: string, input: UpdateAssetInput): Promise<void> {
    return assetRepository.update(id, userId, input);
  },
  remove(id: string, userId: string): Promise<void> {
    return assetRepository.remove(id, userId);
  },
  async total(userId: string): Promise<number> {
    const items = await assetRepository.listByUser(userId);
    return items.reduce((sum, a) => sum + (a.value || 0), 0);
  },
};
