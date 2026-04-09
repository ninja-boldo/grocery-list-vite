import React from 'react';
import type { RecipeItem } from '@/lib/recipesApi';
import { RecipeCardMobile } from './RecipeCardMobile';

type RecipeBookMobileProps = {
  recipes?: RecipeItem[];
};

export const RecipeBookMobile = ({ recipes }: RecipeBookMobileProps) => {
  if (!recipes) {
    return <div data-testid="recipe-book-mobile">Mobile RecipeBook Component</div>;
  }

  return (
    <div data-testid="recipe-book-mobile" style={{ display: 'grid', gap: 12 }}>
      {recipes.map((recipe) => (
        <RecipeCardMobile key={recipe.recipe_id} recipe={recipe} />
      ))}
    </div>
  );
};