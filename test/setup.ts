import { expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock window.matchMedia
global.window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));
global.window.resizeTo = vi.fn();

// Setup global expect for all test files
// @ts-ignore - expect is available globally from vitest
vi.mock('@/lib/api', () => ({
  apiCall: vi.fn().mockResolvedValue({ recipes: [], items: [], success: true }),
}));
