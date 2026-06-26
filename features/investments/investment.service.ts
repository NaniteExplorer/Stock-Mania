import { investmentRepository } from "./investment.repository";
import type {
  Investment,
  CreateInvestmentInput,
  UpdateInvestmentInput,
} from "./investment.types";

export const investmentService = {
  list(userId: string): Promise<Investment[]> {
    return investmentRepository.listByUser(userId);
  },
  create(userId: string, input: CreateInvestmentInput): Promise<Investment> {
    return investmentRepository.create(userId, input);
  },
  update(id: string, userId: string, input: UpdateInvestmentInput): Promise<void> {
    return investmentRepository.update(id, userId, input);
  },
  remove(id: string, userId: string): Promise<void> {
    return investmentRepository.remove(id, userId);
  },
  async totalValue(userId: string): Promise<number> {
    const items = await investmentRepository.listByUser(userId);
    return items.reduce((sum, i) => sum + i.currentValue, 0);
  },
};
