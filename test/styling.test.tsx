/**
 * RecipeCard smoke tests for the current minimal components.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RecipeCardMobile } from '../src/comp/recipe/RecipeCardMobile';
import { RecipeCardWeb } from '../src/comp/recipe/RecipeCardWeb';

describe('RecipeCard component smoke tests', () => {
  it('renders mobile card as an article with default content', () => {
    render(<RecipeCardMobile />);

    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-testid', 'recipe-card-mobile');
    expect(card).toHaveTextContent('Mobile Recipe Card');
  });

  it('renders mobile card children when provided', () => {
    render(
      <RecipeCardMobile>
        <span>Custom Mobile Content</span>
      </RecipeCardMobile>
    );

    expect(screen.getByText('Custom Mobile Content')).toBeInTheDocument();
  });

  it('renders web card container with default content', () => {
    render(<RecipeCardWeb />);

    const webCard = screen.getByTestId('recipe-card-web');
    expect(webCard).toHaveTextContent('Web Recipe Card');
  });

  it('renders web card children when provided', () => {
    render(
      <RecipeCardWeb>
        <span>Custom Web Content</span>
      </RecipeCardWeb>
    );

    expect(screen.getByText('Custom Web Content')).toBeInTheDocument();
  });

  it('still renders mobile card across common breakpoints', () => {
    const widths = [360, 640, 768, 1024, 1280, 1536];

    widths.forEach((width) => {
      global.innerWidth = width;
      global.dispatchEvent(new Event('resize'));

      const { unmount } = render(<RecipeCardMobile />);
      expect(screen.getByTestId('recipe-card-mobile')).toBeInTheDocument();
      unmount();
    });
  });
});