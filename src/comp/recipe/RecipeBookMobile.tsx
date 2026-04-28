import React from "react";
import type { RecipeItem } from "@/lib/recipesApi";
import { RecipeCardMobile } from "./RecipeCardMobile";
import { useTranslation } from "react-i18next";

type RecipeBookMobileProps = {
  recipes?: RecipeItem[];
  addingRecipeId?: number | null;
  deletingRecipeId?: number | null;
  onAddMissingToWishList?: (recipe: RecipeItem) => void;
  onDeleteRecipe?: (recipe: RecipeItem) => void;
};

export const RecipeBookMobile = ({
  recipes,
  addingRecipeId,
  deletingRecipeId,
  onAddMissingToWishList,
  onDeleteRecipe,
}: RecipeBookMobileProps) => {
  const { t } = useTranslation();
  if (!recipes) {
    return (
      <div data-testid="recipe-book-mobile">
        {t("mobileRecipebookComponent", "Mobile RecipeBook Component")}
      </div>
    );
  }

  return (
    <div data-testid="recipe-book-mobile" style={{ display: "grid", gap: 12 }}>
      {recipes.map((recipe) => (
        <RecipeCardMobile
          key={recipe.recipe_id}
          recipe={recipe}
          isAddingToWishList={addingRecipeId === recipe.recipe_id}
          isDeleting={deletingRecipeId === recipe.recipe_id}
          onAddMissingToWishList={onAddMissingToWishList}
          onDeleteRecipe={onDeleteRecipe}
        />
      ))}
    </div>
  );
};
