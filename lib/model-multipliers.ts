import { CATEGORIES, modelsForCategory, type Category } from './categories';
import {
  listModelMultiplierSettings,
  saveModelMultiplierSettings,
  type ModelMultiplierSetting,
} from './db';
import { getNewApiModelRatios, updateNewApiModelRatios } from './newapi';

export type StoredModelMultiplier = ModelMultiplierSetting;

const SURGE_CATEGORIES = ['deepseek', 'gpt', 'claude'] as const satisfies readonly Category[];
const MIN_MULTIPLIER = 0.1;
const MAX_MULTIPLIER = 10;
const RATIO_PRECISION = 1_000_000;

export interface ModelMultiplierRow {
  model: string;
  category: Category;
  categoryLabel: string;
  supported: boolean;
  baseRatio: number | null;
  multiplier: number;
  effectiveRatio: number | null;
  currentRatio: number | null;
  drifted: boolean;
  updatedAt: number | null;
}

export interface ModelMultiplierGroup {
  category: Category;
  label: string;
  models: ModelMultiplierRow[];
}

function roundRatio(value: number): number {
  return Math.round(value * RATIO_PRECISION) / RATIO_PRECISION;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1 / RATIO_PRECISION;
}

export function normalizeSurgeMultiplier(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_MULTIPLIER || parsed > MAX_MULTIPLIER) {
    throw new Error(`加价倍数必须在 ${MIN_MULTIPLIER}～${MAX_MULTIPLIER} 之间`);
  }
  return Math.round(parsed * 100) / 100;
}

function modelCategory(model: string): Category | null {
  for (const category of SURGE_CATEGORIES) {
    if (modelsForCategory(category).includes(model)) return category;
  }
  return null;
}

export function allowedSurgeModels(): string[] {
  return SURGE_CATEGORIES.flatMap((category) => modelsForCategory(category));
}

export function buildModelMultiplierChanges(args: {
  currentRatios: Record<string, number>;
  stored: StoredModelMultiplier[];
  models: string[];
  multiplier: unknown;
  now?: number;
}): { nextRatios: Record<string, number>; settings: StoredModelMultiplier[] } {
  const multiplier = normalizeSurgeMultiplier(args.multiplier);
  const models = [...new Set(args.models.map((model) => model.trim()).filter(Boolean))];
  if (models.length === 0) throw new Error('至少选择一个模型');
  const storedByModel = new Map(args.stored.map((row) => [row.model, row]));
  const nextRatios = { ...args.currentRatios };
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const settings: StoredModelMultiplier[] = [];

  for (const model of models) {
    const category = modelCategory(model);
    if (!category) throw new Error(`模型 ${model} 不允许在卡密后台调整`);
    const currentRatio = args.currentRatios[model];
    if (!Number.isFinite(currentRatio)) {
      throw new Error(`模型 ${model} 不支持倍率计费（可能是固定价格模型）`);
    }

    const saved = storedByModel.get(model);
    let baseRatio = currentRatio;
    if (saved) {
      baseRatio = nearlyEqual(currentRatio, saved.effective_ratio)
        ? saved.base_ratio
        : roundRatio(currentRatio / Math.max(saved.multiplier, MIN_MULTIPLIER));
    }
    const effectiveRatio = roundRatio(baseRatio * multiplier);
    nextRatios[model] = effectiveRatio;
    settings.push({
      model,
      category,
      base_ratio: baseRatio,
      multiplier,
      effective_ratio: effectiveRatio,
      updated_at: now,
    });
  }

  return { nextRatios, settings };
}

export async function getModelMultiplierGroups(): Promise<ModelMultiplierGroup[]> {
  const [currentRatios, stored] = await Promise.all([
    getNewApiModelRatios(),
    Promise.resolve(listModelMultiplierSettings()),
  ]);
  const storedByModel = new Map(stored.map((row) => [row.model, row]));

  return SURGE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORIES[category].label,
    models: modelsForCategory(category).map((model) => {
      const currentRatio = currentRatios[model];
      const saved = storedByModel.get(model);
      const supported = Number.isFinite(currentRatio);
      const baseRatio = saved?.base_ratio ?? (supported ? currentRatio : null);
      const effectiveRatio = saved?.effective_ratio ?? (supported ? currentRatio : null);
      return {
        model,
        category,
        categoryLabel: CATEGORIES[category].label,
        supported,
        baseRatio,
        multiplier: saved?.multiplier ?? 1,
        effectiveRatio,
        currentRatio: supported ? currentRatio : null,
        drifted: !!saved && supported && !nearlyEqual(currentRatio, saved.effective_ratio),
        updatedAt: saved?.updated_at ?? null,
      };
    }),
  }));
}

export async function setModelMultipliers(models: string[], multiplier: unknown): Promise<void> {
  const currentRatios = await getNewApiModelRatios();
  const stored = listModelMultiplierSettings();
  const changes = buildModelMultiplierChanges({ currentRatios, stored, models, multiplier });

  await updateNewApiModelRatios(changes.nextRatios);
  try {
    saveModelMultiplierSettings(changes.settings);
  } catch (error) {
    try {
      await updateNewApiModelRatios(currentRatios);
    } catch (rollbackError) {
      console.error('[model-multipliers] NewAPI rollback failed:', rollbackError);
    }
    throw error;
  }
}
