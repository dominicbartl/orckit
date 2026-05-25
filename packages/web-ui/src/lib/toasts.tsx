import { createContext, createSignal, useContext, type JSX } from 'solid-js';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastEntry {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Auto-dismiss after N ms. Default 4000. Set to 0 to keep until dismissed. */
  ttl?: number;
}

interface ToastApi {
  toasts: () => ToastEntry[];
  push: (entry: Omit<ToastEntry, 'id'>) => number;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider(props: { children: JSX.Element }) {
  const [toasts, setToasts] = createSignal<ToastEntry[]>([]);
  let nextId = 1;

  const api: ToastApi = {
    toasts,
    push(entry) {
      const id = nextId++;
      const ttl = entry.ttl ?? 4000;
      setToasts([...toasts(), { ...entry, id }]);
      if (ttl > 0) {
        setTimeout(() => api.dismiss(id), ttl);
      }
      return id;
    },
    dismiss(id) {
      setToasts(toasts().filter((t) => t.id !== id));
    },
  };

  return <Ctx.Provider value={api}>{props.children}</Ctx.Provider>;
}

export function useToasts(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToasts must be called within <ToastProvider>');
  return ctx;
}
