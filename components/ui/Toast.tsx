"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type ToastContextValue = {
  showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: string) => {
    setMessage(next);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setMessage(null), 5000);
  }, []);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-6 z-[60] flex justify-center sm:inset-x-0"
      >
        {message ? (
          <div className="pointer-events-auto flex max-w-[min(30rem,100%)] items-start gap-3 rounded-[12px] border border-brand bg-brand px-4 py-3 text-surface shadow-[0_10px_30px_-16px_rgba(24,34,29,0.6)]">
            <p className="text-[14px] leading-snug font-semibold">{message}</p>
            <button
              type="button"
              aria-label="Zamknij powiadomienie"
              onClick={() => setMessage(null)}
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-surface/70 transition-colors hover:text-surface"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
