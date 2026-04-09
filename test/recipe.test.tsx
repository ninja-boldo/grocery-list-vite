import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RecipeBookMobile } from '../src/comp/recipe/RecipeBookMobile';
import { RecipeBookWeb } from '../src/comp/recipe/RecipeBookWeb';

describe('RecipeBook component smoke tests', () => {
  it('renders mobile recipe book placeholder', () => {
    render(<RecipeBookMobile />);

    expect(screen.getByTestId('recipe-book-mobile')).toBeInTheDocument();
    expect(screen.getByText('Mobile RecipeBook Component')).toBeInTheDocument();
  });

  it('renders web recipe book placeholder', () => {
    render(<RecipeBookWeb />);

    expect(screen.getByTestId('recipe-book-web')).toBeInTheDocument();
    expect(screen.getByText('Web RecipeBook Component')).toBeInTheDocument();
  });
});
