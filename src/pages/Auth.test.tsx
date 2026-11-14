import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Auth from './Auth';
import { LEGAL } from '../data/legal';

/**
 * Sign-up's two confirmations (V01 T-13): "I am 18 or older." and the Terms
 * and Privacy Policy, separate, never pre-ticked, both required, and recorded
 * with the account. The auth server is replaced at the client.
 */

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth } }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../components/ThemeToggle', () => ({ default: () => null }));

beforeEach(() => {
  auth.signUp.mockReset().mockResolvedValue({ data: { session: null, user: { id: 'u-1' } }, error: null });
});
afterEach(cleanup);

function openSignUp() {
  render(
    <MemoryRouter initialEntries={['/shygontap/auth']}>
      <Auth />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Asha Rao' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'asha@example.test' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'a-long-pass-1' } });
}
const ageBox = () => screen.getByRole('checkbox', { name: 'I am 18 or older.' });
const termsBox = () => screen.getByRole('checkbox', { name: /I agree to the Terms and Conditions/ });
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

describe('signing up: adults only', () => {
  it('two separate confirmations, neither ticked to begin with, both required', () => {
    openSignUp();
    expect(ageBox()).toHaveProperty('checked', false);
    expect(termsBox()).toHaveProperty('checked', false);
    expect(ageBox()).toHaveProperty('required', true);
    expect(termsBox()).toHaveProperty('required', true);
  });

  /** A submit that skips the browser's own check of required boxes, as a script or an old browser could. */
  const forceSubmit = () => fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);

  it('without the age confirmation nothing is sent: the browser stops it, and the page says why if it does not', async () => {
    openSignUp();
    fireEvent.click(termsBox());
    create();
    expect((ageBox() as HTMLInputElement).validity.valueMissing).toBe(true);
    expect(auth.signUp).not.toHaveBeenCalled();
    forceSubmit();
    expect((await screen.findByRole('alert')).textContent).toBe('Please confirm you are 18 or older. SHYGON Tap is for adults only.');
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('without the Terms nothing is sent either', async () => {
    openSignUp();
    fireEvent.click(ageBox());
    create();
    expect((termsBox() as HTMLInputElement).validity.valueMissing).toBe(true);
    forceSubmit();
    expect((await screen.findByRole('alert')).textContent).toBe('Please agree to the Terms and Conditions and the Privacy Policy.');
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('with both, the account records the age confirmation and the consent, at one moment and against this policy version', async () => {
    openSignUp();
    fireEvent.click(ageBox());
    fireEvent.click(termsBox());
    create();
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    const [{ email, options }] = auth.signUp.mock.calls[0]! as [{ email: string; options: { data: Record<string, unknown> } }];
    expect(email).toBe('asha@example.test');
    expect(options.data).toMatchObject({ full_name: 'Asha Rao', adult_confirmed: true, policies_version: LEGAL.lastUpdated });
    expect(options.data.adult_confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(options.data.adult_confirmed_at).toBe(options.data.terms_accepted_at);
  });
});
