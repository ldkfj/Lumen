import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Root from './Root';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

it('keeps landing and docs static without loading the wallet workspace', () => {
  window.history.replaceState({}, '', '/');
  const landing = render(<Root />);
  expect(screen.getByRole('heading', { name: /make ai benchmark claims prove their scope/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open verification app/i })).toHaveAttribute('href', '/app');
  expect(screen.queryByRole('button', { name: /connect wallet/i })).not.toBeInTheDocument();
  landing.unmount();

  window.history.replaceState({}, '', '/docs');
  render(<Root />);
  expect(screen.getByRole('heading', { name: /verify the claim, not the sales pitch/i })).toBeInTheDocument();
  expect(screen.getByText(/read-only exploration needs no wallet/i)).toBeInTheDocument();
});
