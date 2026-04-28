import React from "react";
import type { RecipeItem } from "@/lib/recipesApi";
import { RecipeCardWeb } from "./RecipeCardWeb";
import { useTranslation } from "react-i18next";

type RecipeBookWebProps = {
  recipes?: RecipeItem[];
  addingRecipeId?: number | null;
  deletingRecipeId?: number | null;
  onAddMissingToWishList?: (recipe: RecipeItem) => void;
  onDeleteRecipe?: (recipe: RecipeItem) => void;
};

export const RecipeBookWeb = ({
  recipes,
  addingRecipeId,
  deletingRecipeId,
  onAddMissingToWishList,
  onDeleteRecipe,
}: RecipeBookWebProps) => {
  const { t } = useTranslation();
  if (!recipes) {
    return (
      <div data-testid="recipe-book-web">
        {t("webRecipebookComponent", "Web RecipeBook Component")}
      </div>
    );
  }

  return (
    <div data-testid="recipe-book-web">
      <RecipeCardWeb
        recipes={recipes}
        addingRecipeId={addingRecipeId}
        deletingRecipeId={deletingRecipeId}
        onAddMissingToWishList={onAddMissingToWishList}
        onDeleteRecipe={onDeleteRecipe}
      />
    </div>
  );
};
