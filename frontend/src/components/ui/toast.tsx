"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";
interface Toast { id: number; type: ToastType; message: string; }

interface ToastCtx {
  show: (type: ToastType, message: string) => void;
}
const Ctx = React.createContext<ToastCtx | null>(null);

// Success toasts auto-dismiss after 3s; error toasts are persistent (must be manually dismissed).
const AUTO_DISMISS_MS: Record<ToastType, number | null> = {
  success: 3000,
  info: 5000,
  error: null, // never auto-dismiss — operator must acknowledge
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((s) => s.filter((t) => t.id !== id));
  }, []);

  const show = React.useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current;
    setToasts((s) => [...s, { id, type, message }]);
    const delay = AUTO_DISMISS_MS[type];
    if (delay !== null) {
      setTimeout(() => dismiss(id), delay);
    }
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-full max-w-md">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            aria-live={t.type === "error" ? "assertive" : "polite"}
            className={cn(
              "flex items-start justify-between gap-3 rounded-md border px-4 py-3 shadow-md text-sm",
              t.type === "success" && "bg-green-50 border-green-200 text-green-900",
              t.type === "error" && "bg-red-50 border-red-200 text-red-900",
              t.type === "info" && "bg-blue-50 border-blue-200 text-blue-900"
            )}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className={cn(
                "shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-opacity",
                t.type === "success" && "focus-visible:ring-green-600",
                t.type === "error" && "focus-visible:ring-red-600",
                t.type === "info" && "focus-visible:ring-blue-600"
              )}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
