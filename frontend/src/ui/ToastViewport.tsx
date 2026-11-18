import { ANCHORS } from "../shared/anchors";
import { useI18n, type TranslationKey } from "../shared/i18n";

export type ToastVariant = "success" | "warning" | "error" | "info";

export interface ToastOptions {
  id?: string;
  loading?: boolean;
  persistent?: boolean;
  titleKey?: TranslationKey;
  titleVars?: Record<string, string | number>;
  messageKey?: TranslationKey;
  messageVars?: Record<string, string | number>;
}

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  loading?: boolean;
  persistent?: boolean;
  titleKey?: TranslationKey;
  titleVars?: Record<string, string | number>;
  messageKey?: TranslationKey;
  messageVars?: Record<string, string | number>;
}

export type PushToastFn = (
  variant: ToastVariant,
  title: string,
  message?: string,
  options?: ToastOptions,
) => string;

interface ToastViewportProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const VARIANT_CLASSES: Record<
  ToastVariant,
  { border: string; dot: string }
> = {
  success: {
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  warning: {
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  error: {
    border: "border-red-200",
    dot: "bg-red-500",
  },
  info: {
    border: "border-gray-200",
    dot: "bg-blue-600",
  },
};

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  const { t } = useI18n();
  if (toasts.length === 0) return null;

  return (
    <div
      id={ANCHORS.toastViewport}
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-3 bottom-16 z-[60] flex max-w-[calc(100vw-1.5rem)] flex-col gap-2 sm:right-5 sm:bottom-5 sm:w-full sm:max-w-sm"
    >
      {toasts.map((toast) => {
        const theme = VARIANT_CLASSES[toast.variant];
        const resolvedTitle = toast.titleKey
          ? t(toast.titleKey, toast.titleVars)
          : toast.title;
        const resolvedMessage = toast.messageKey
          ? t(toast.messageKey, toast.messageVars)
          : toast.message;
        return (
          <div
            key={toast.id}
            data-toast-variant={toast.variant}
            className={`pointer-events-auto flex min-w-0 items-start justify-between gap-2.5 rounded-xl border bg-white p-3 text-xs shadow-lg ${theme.border}`}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              {toast.loading ? (
                <span
                  aria-hidden="true"
                  data-toast-spinner="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${theme.dot}`}
                />
              )}
              <div className="min-w-0">
                <div className="font-semibold text-zinc-950">{resolvedTitle}</div>
                {resolvedMessage && (
                  <div className="mt-0.5 break-words text-[11px] text-zinc-600">
                    {resolvedMessage}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label={t("toast.dismissAria")}
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-zinc-400 transition-colors hover:bg-gray-100 hover:text-zinc-900"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
