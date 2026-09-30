import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

/**
 * Small, non-blocking confirmations.
 *
 * Split out of the provider file so that one exports only components — React
 * Fast Refresh refuses to hot-update a module that also exports a hook, which
 * made every edit to the provider reload the whole app.
 */

export interface ToastContextValue {
  toast: (kind: ToastKind, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  /** Neutral outcomes — a cancelled payment is not a failure to apologise for. */
  info: (title: string, description?: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
