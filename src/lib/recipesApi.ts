import { authApiCall } from "./authApi";
import { API_PATHS } from "./api/openapi";
import i18next from 'i18next'

export type RecipeIngredient = {
  amount: number | null;
  unit: string | null;
  name: string;
  count: number | null;
};

export type RecipeItem = {
  recipe_id: number;
  name: string | null;
  base_time: number;
  default_portions: number;
  tags: string[];
  emoji: string | null;
  ingredients: RecipeIngredient[];
  steps: string[];
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
      name: typeof ingredient.name === "string" ? ingredient.name : i18next.t('unknown', 'Unknown'),
      count: toNullableNumber(ingredient.count),
    }));
};

const normalizeSteps = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((step): step is string => typeof step === "string");
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
      name: toNullableString(recipe.name),
      base_time: toNumber(recipe.base_time),
      default_portions: toNumber(recipe.default_portions),
      tags: normalizeTags(recipe.tags),
      emoji: toNullableString(recipe.emoji),
      ingredients: normalizeIngredients(recipe.ingredients),
      steps: normalizeSteps(recipe.steps),
    }));

  return {
    recipes,
    recipe_count: toNumber(value.recipe_count, recipes.length),
  };
};

export async function fetchRecipes(
  onUnauthorized?: () => void,
): Promise<RecipesResponse> {
  const response = await authApiCall<unknown>(API_PATHS.recipes, undefined, {
    retries: 2,
    retryDelayMs: 250,
    onUnauthorized,
  });

  return normalizeRecipesResponse(response);
}

export async function getRecipeById(
  recipeId: number,
  onUnauthorized?: () => void,
): Promise<RecipeItem | null> {
  const response = await authApiCall<unknown>(API_PATHS.recipeById(recipeId), undefined, {
    retries: 2,
    retryDelayMs: 250,
    onUnauthorized,
  });

  if (!isRecord(response)) {
    return null;
  }

  return {
    recipe_id: toNumber(response.recipe_id),
    name: toNullableString(response.name),
    base_time: toNumber(response.base_time),
    default_portions: toNumber(response.default_portions),
    tags: normalizeTags(response.tags),
    emoji: toNullableString(response.emoji),
    ingredients: normalizeIngredients(response.ingredients),
    steps: normalizeSteps(response.steps),
  };
}

export async function deleteRecipeById(
  recipeId: number,
  onUnauthorized?: () => void,
): Promise<void> {
  await authApiCall<unknown>(
    API_PATHS.recipeById(recipeId),
    { method: "DELETE" },
    {
      retries: 2,
      retryDelayMs: 250,
      onUnauthorized,
    },
  );
}
