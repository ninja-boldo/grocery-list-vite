import React from 'react';
import type { RecipeItem } from '@/lib/recipesApi';
import { RecipeCardWeb } from './RecipeCardWeb';

type RecipeBookWebProps = {
  recipes?: RecipeItem[];
};

export const RecipeBookWeb = ({ recipes }: RecipeBookWebProps) => {
  if (!recipes) {
    return <div data-testid="recipe-book-web">Web RecipeBook Component</div>;
  }

  return (
    <div data-testid="recipe-book-web">
      <RecipeCardWeb recipes={recipes} />
    </div>
  );
};