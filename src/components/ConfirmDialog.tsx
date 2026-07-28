import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import './ConfirmDialog.css';

// Lichen's own confirm (founder 2026-07-28: no more Chrome dialogs wearing
// Chrome's aesthetic). A bone card in the app's voice, promise-based so any
// handler can `if (!(await confirm({...}))) return;` exactly like the native
// one it replaces.

interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions confirm in rust. */
  danger?: boolean;
}

const ConfirmContext = createContext<(opts: ConfirmOpts) => Promise<boolean>>(
  () => Promise.resolve(false),
);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);
  const settle = (v: boolean) => { setOpts(null); resolver.current?.(v); };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="cdlg" role="alertdialog" aria-modal="true" aria-label={opts.title ?? 'Confirm'}>
          <div className="cdlg__scrim" onClick={() => settle(false)} />
          <div className="cdlg__card">
            {opts.title && <p className="cdlg__title">{opts.title}</p>}
            <p className="cdlg__msg">{opts.message}</p>
            <div className="cdlg__row">
              <button className="btn cdlg__btn" onClick={() => settle(false)} autoFocus>
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={'btn btn-primary cdlg__btn' + (opts.danger ? ' cdlg__btn--danger' : '')}
                onClick={() => settle(true)}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
