import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { ToastContext, type ToastContextValue, type ToastKind } from './toast-context';

/**
 * Small, non-blocking confirmations. Used for "Saved", "Copied", "Published"
 * and for failures that do not warrant taking over the page — replacing the
 * `window.alert()` calls the profile editor used to fire.
 */

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}



const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  info: <Info size={18} />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, kind, title, description }]);
      // Errors stay longer — they usually carry something to act on.
      window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast('success', title, description),
      error: (title, description) => toast('error', title, description),
      info: (title, description) => toast('info', title, description),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div key={item.id} className="toast" role={item.kind === 'error' ? 'alert' : 'status'}>
            <span className={`toast-${item.kind}`}>{ICONS[item.kind]}</span>
            <div style={{ minWidth: 0 }}>
              <strong>{item.title}</strong>
              {item.description && <p>{item.description}</p>}
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
