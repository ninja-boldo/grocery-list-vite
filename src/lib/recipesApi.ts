import { authApiCall } from "./authApi";

export type RecipeIngredient = {
  amount: number | null;
  unit: string | null;
  name: string;
  count: number | null;
};

export type RecipeItem = {
  recipe_id: number;
  base_time: number;
  default_portions: number;
  tags: string[];
  emoji: string | null;
  ingredients: RecipeIngredient[];
};

export type RecipesResponse = {
  recipes: RecipeItem[];
  recipe_count: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const normalizeIngredients = (value: unknown): RecipeIngredient[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((ingredient) => ({
      amount: toNullableNumber(ingredient.amount),
      unit: toNullableString(ingredient.unit),
      name: typeof ingredient.name === "string" ? ingredient.name : "Unknown",
      count: toNullableNumber(ingredient.count),
    }));
};

const normalizeTags = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === "string");
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
};

export const normalizeRecipesResponse = (value: unknown): RecipesResponse => {
  if (!isRecord(value)) {
    return { recipes: [], recipe_count: 0 };
  }

  const rawRecipes = Array.isArray(value.recipes) ? value.recipes : [];

  const recipes = rawRecipes
    .filter(isRecord)
    .map((recipe) => ({
      recipe_id: toNumber(recipe.recipe_id),
      base_time: toNumber(recipe.base_time),
      default_portions: toNumber(recipe.default_portions),
      tags: normalizeTags(recipe.tags),
      emoji: toNullableString(recipe.emoji),
      ingredients: normalizeIngredients(recipe.ingredients),
    }));

  return {
    recipes,
    recipe_count: toNumber(value.recipe_count, recipes.length),
  };
};

export async function fetchRecipes(
  onUnauthorized?: () => void,
): Promise<RecipesResponse> {
  const response = await authApiCall<unknown>("/api/recipes", undefined, {
    retries: 2,
    retryDelayMs: 250,
    onUnauthorized,
  });

  return normalizeRecipesResponse(response);
}
