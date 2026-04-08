export type OverrideType = 'user' | 'group' | 'region';

export interface Override {
  id: number;
  flagName: string;
  type: OverrideType;
  /** userId, groupId, or region identifier */
  targetId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureFlag {
  id: number;
  /** Unique, immutable identifier for the flag */
  name: string;
  description: string | null;
  globalEnabled: boolean;
  overrides: Override[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFlagInput {
  name: string;
  description?: string;
  globalEnabled?: boolean;
}

export interface UpdateFlagInput {
  globalEnabled?: boolean;
  description?: string;
}

export interface UpsertOverrideInput {
  type: OverrideType;
  targetId: string;
  enabled: boolean;
}

export interface EvaluationContext {
  userId?: string;
  groupId?: string;
  region?: string;
}

export interface EvaluationResult {
  flagName: string;
  enabled: boolean;
  reason: 'user_override' | 'group_override' | 'region_override' | 'global_default';
}
