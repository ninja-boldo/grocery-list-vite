import React from 'react';
import type { RecipeItem } from '@/lib/recipesApi';

type RecipeCardMobileProps = {
  recipe?: RecipeItem;
  children?: React.ReactNode;
};

const formatIngredient = (name: string, amount: number | null, unit: string | null) => {
  if (amount === null) {
    return name;
  }

  return `${amount}${unit ? ` ${unit}` : ''} ${name}`.trim();
};

export const RecipeCardMobile = ({ recipe, children }: RecipeCardMobileProps) => {
  if (!recipe) {
    return <article data-testid="recipe-card-mobile">{children || 'Mobile Recipe Card'}</article>;
  }

  return (
    <article
      data-testid="recipe-card-mobile"
      style={{
        border: '1px solid #21262D',
        borderRadius: 14,
        background: '#161B22',
        padding: 14,
        display: 'grid',
        gap: 10,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: '#E6EDF3', fontSize: 16, fontWeight: 700 }}>
          {recipe.emoji ? `${recipe.emoji} ` : ''}Recipe #{recipe.recipe_id}
        </h3>
        <span style={{ color: '#6E7681', fontSize: 12 }}>
          {recipe.base_time} min
        </span>
      </header>

      <div style={{ color: '#9FB0C0', fontSize: 13 }}>
        Portions: {recipe.default_portions}
      </div>

      <ul style={{ margin: 0, paddingLeft: 18, color: '#D4E2EF', fontSize: 13, display: 'grid', gap: 4 }}>
        {recipe.ingredients.map((ingredient, index) => (
          <li key={`${ingredient.name}-${index}`}>
            {formatIngredient(ingredient.name, ingredient.amount, ingredient.unit)}
          </li>
        ))}
      </ul>

      {recipe.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {recipe.tags.map((tag) => (
            <span
              key={tag}
              style={{
                borderRadius: 999,
                border: '1px solid #1D9E7550',
                background: '#0F2A28',
                color: '#5EEAD4',
                fontSize: 11,
                padding: '3px 8px',
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