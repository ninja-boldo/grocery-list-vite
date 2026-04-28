import React from "react";
import type { RecipeItem } from "@/lib/recipesApi";
import { useTranslation } from "react-i18next";
import i18next from "i18next";

type RecipeCardMobileProps = {
  recipe?: RecipeItem;
  isAddingToWishList?: boolean;
  isDeleting?: boolean;
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

export const RecipeCardMobile = ({
  recipe,
  isAddingToWishList,
  isDeleting,
  onAddMissingToWishList,
  onDeleteRecipe,
  children,
}: RecipeCardMobileProps) => {
  const { t } = useTranslation();
  if (!recipe) {
    return (
      <article data-testid="recipe-card-mobile">
        {children || t("mobileRecipeCard", "Mobile Recipe Card")}
      </article>
    );
  }

  const visibleIngredients = recipe.ingredients.slice(0, 5);
  const remainingIngredients = Math.max(
    0,
    recipe.ingredients.length - visibleIngredients.length,
  );

  return (
    <article
      data-testid="recipe-card-mobile"
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
            gap: 10,
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
            {t("default_portionsPortions", "{{default_portions}} portions", {
              default_portions: recipe.default_portions,
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
            {t("lengthIngredients", "{{length}} ingredients", {
              length: recipe.ingredients.length,
            })}
          </span>
        </div>
      </header>

      <div style={{ display: "grid", gap: 6 }}>
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
          {visibleIngredients.map((ingredient, index) => (
            <li key={`${ingredient.name}-${index}`}>
              {formatIngredient(
                ingredient.name,
                ingredient.amount,
                ingredient.unit,
              )}
            </li>
          ))}
        </ul>
        {remainingIngredients > 0 && (
          <div style={{ color: "#8FA2B4", fontSize: 12 }}>
            {t(
              "remainingingredientsMoreIngredients",
              "+{{remainingIngredients}} more ingredients",
              { remainingIngredients },
            )}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <button
          type="button"
          disabled={!onAddMissingToWishList || isAddingToWishList || isDeleting}
          onClick={() => onAddMissingToWishList?.(recipe)}
          style={{
            border: "1px solid #1D9E75",
            borderRadius: 12,
            background: isAddingToWishList ? "#0F2A28" : "#1D9E75",
            color: "#FFFFFF",
            padding: "9px 12px",
            fontSize: 13,
            fontWeight: 700,
            cursor:
              isAddingToWishList || isDeleting ? "not-allowed" : "pointer",
          }}
        >
          {isAddingToWishList
            ? t("checkingPantry", "Checking pantry...")
            : t("checkPantryAndAddMissing", "Check Pantry and Add Missing")}
        </button>

        <button
          type="button"
          disabled={!onDeleteRecipe || isDeleting || isAddingToWishList}
          onClick={() => onDeleteRecipe?.(recipe)}
          style={{
            border: "1px solid #7F1D1D",
            borderRadius: 12,
            background: isDeleting ? "#2B1111" : "#3A1212",
            color: "#FCA5A5",
            padding: "9px 12px",
            fontSize: 13,
            fontWeight: 700,
            cursor:
              isDeleting || isAddingToWishList ? "not-allowed" : "pointer",
          }}
        >
          {isDeleting ? "Deleting..." : t("deleteRecipe", "Delete Recipe")}
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
  );
};
