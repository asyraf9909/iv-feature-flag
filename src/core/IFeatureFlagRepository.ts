import { FeatureFlag, Override, CreateFlagInput, OverrideType } from './types';

export interface IFeatureFlagRepository {
  create(data: CreateFlagInput): Promise<FeatureFlag>;
  findByName(name: string): Promise<FeatureFlag | null>;
  findAll(): Promise<FeatureFlag[]>;
  update(
    name: string,
    data: Partial<Pick<FeatureFlag, 'globalEnabled' | 'description'>>
  ): Promise<FeatureFlag>;
  delete(name: string): Promise<void>;
  upsertOverride(
    flagName: string,
    type: OverrideType,
    targetId: string,
    enabled: boolean
  ): Promise<Override>;
  deleteOverride(flagName: string, type: OverrideType, targetId: string): Promise<void>;
}
