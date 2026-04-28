import React from "react";
import type { RecipeItem } from "@/lib/recipesApi";
import { useTranslation } from "react-i18next";
import i18next from "i18next";

type RecipeCardWebProps = {
  recipes?: RecipeItem[];
  addingRecipeId?: number | null;
  deletingRecipeId?: number | null;
  onAddMissingToWishList?: (recipe: RecipeItem) => void;
  onDeleteRecipe?: (recipe: RecipeItem) => void;
  children?: React.ReactNode;
};

const formatIngredient = (
  name: string,
  amount: number | null,
  unit: string | null,
) => {
  if (amount === null) {
    return name;
  }
  return i18next
    .t("amountvalName", "{{amount}}{{val}} {{name}}", {
      amount,
      val: unit ? ` ${unit}` : "",
      name,
    })
    .trim();
};

const getRecipeTitle = (recipe: RecipeItem) => {
  const label = recipe.name?.trim();
  if (label) {
    return label;
  }
  return `Unnamed Recipe`;
};

export const RecipeCardWeb = ({
  recipes,
  addingRecipeId,
  deletingRecipeId,
  onAddMissingToWishList,
  onDeleteRecipe,
  children,
}: RecipeCardWebProps) => {
  const { t } = useTranslation();
  if (!recipes) {
    return (
      <div data-testid="recipe-card-web">
        {children || t("webRecipeCard", "Web Recipe Card")}
      </div>
    );
  }

  return (
    <div
      data-testid="recipe-card-web"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 14,
      }}
    >
      {recipes.map((recipe) => (
        <article
          key={recipe.recipe_id}
          style={{
            border: "1px solid #2A333C",
            borderRadius: 16,
            background: "#161B22",
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <header style={{ display: "grid", gap: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  color: "#E6EDF3",
                  fontSize: 17,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {recipe.emoji ? `${recipe.emoji} ` : ""}
                {getRecipeTitle(recipe)}
              </h3>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  borderRadius: 999,
                  border: "1px solid #2C363F",
                  color: "#A7B7C7",
                  fontSize: 12,
                  padding: "4px 8px",
                }}
              >
                {t("base_timeMin", "{{base_time}} min", {
                  base_time: recipe.base_time,
                })}
              </span>
              <span
                style={{
                  borderRadius: 999,
                  border: "1px solid #2C363F",
                  color: "#A7B7C7",
                  fontSize: 12,
                  padding: "4px 8px",
                }}
              >
                {t(
                  "default_portionsPortions",
                  "{{default_portions}} portions",
                  { default_portions: recipe.default_portions },
                )}
              </span>
              <span
                style={{
                  borderRadius: 999,
                  border: "1px solid #2C363F",
                  color: "#A7B7C7",
                  fontSize: 12,
                  padding: "4px 8px",
                }}
              >
                {t("lengthIngredients", "{{length}} ingredients", {
                  length: recipe.ingredients.length,
                })}
              </span>
            </div>
          </header>

          <div
            style={{
              color: "#9FB0C0",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {t("ingredientPreview", "Ingredient preview")}
          </div>

          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              color: "#D4E2EF",
              fontSize: 13,
              display: "grid",
              gap: 4,
            }}
          >
            {recipe.ingredients.slice(0, 5).map((ingredient, index) => {
              return (
                <li key={`${ingredient.name}-${index}`}>
                  {formatIngredient(
                    ingredient.name,
                    ingredient.amount,
                    ingredient.unit,
                  )}
                </li>
              );
            })}
          </ul>

          {recipe.ingredients.length > 5 && (
            <div style={{ color: "#8FA2B4", fontSize: 12 }}>
              +{recipe.ingredients.length - 5}{" "}
              {t("moreIngredients", "more ingredients")}
            </div>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            <button
              type="button"
              disabled={
                !onAddMissingToWishList ||
                addingRecipeId === recipe.recipe_id ||
                deletingRecipeId === recipe.recipe_id
              }
              onClick={() => onAddMissingToWishList?.(recipe)}
              style={{
                border: "1px solid #1D9E75",
                borderRadius: 12,
                background:
                  addingRecipeId === recipe.recipe_id ? "#0F2A28" : "#1D9E75",
                color: "#FFFFFF",
                padding: "9px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor:
                  addingRecipeId === recipe.recipe_id ||
                  deletingRecipeId === recipe.recipe_id
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {addingRecipeId === recipe.recipe_id
                ? t("checkingPantry", "Checking pantry...")
                : t("checkPantryAndAddMissing", "Check Pantry and Add Missing")}
            </button>

            <button
              type="button"
              disabled={
                !onDeleteRecipe ||
                deletingRecipeId === recipe.recipe_id ||
                addingRecipeId === recipe.recipe_id
              }
              onClick={() => onDeleteRecipe?.(recipe)}
              style={{
                border: "1px solid #7F1D1D",
                borderRadius: 12,
                background:
                  deletingRecipeId === recipe.recipe_id ? "#2B1111" : "#3A1212",
                color: "#FCA5A5",
                padding: "9px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor:
                  deletingRecipeId === recipe.recipe_id ||
                  addingRecipeId === recipe.recipe_id
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {deletingRecipeId === recipe.recipe_id
                ? "Deleting..."
                : t("deleteRecipe", "Delete Recipe")}
            </button>
          </div>

          {recipe.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {recipe.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    borderRadius: 999,
                    border: "1px solid #1D9E7550",
                    background: "#0F2A28",
                    color: "#5EEAD4",
                    fontSize: 11,
                    padding: "3px 8px",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
};
