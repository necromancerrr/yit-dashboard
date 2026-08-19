"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Undo2 } from "lucide-react";

interface ToastOptions {
  message: string;
  actionLabel?: string;
  duration?: number;
  onAction?: () => void;
}

interface ToastItem extends Required<Pick<ToastOptions, "message" | "actionLabel" | "duration">> {
  id: number;
  onAction?: () => void;
}

interface ToastContextValue {
  notify: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (opts: ToastOptions) => {
      const id = nextId.current++;
      const duration = opts.duration ?? 5000;
      setToasts((prev) => [
        ...prev,
        { id, message: opts.message, actionLabel: opts.actionLabel ?? "Undo", duration, onAction: opts.onAction },
      ]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="card-raised animate-toast-in flex items-center gap-3 pl-4 pr-2 py-2 shadow-2xl"
            style={{ minWidth: 240 }}
          >
            <span className="text-sm">{t.message}</span>
            {t.onAction && (
              <button
                onClick={() => {
                  t.onAction?.();
                  dismiss(t.id);
                }}
                className="btn btn-ghost py-1 px-2 text-xs flex items-center gap-1 shrink-0"
              >
                <Undo2 size={12} />
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
