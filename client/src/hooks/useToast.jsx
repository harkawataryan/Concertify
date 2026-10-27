import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback(({ message, error = false, action = null, ttl = 5000 }) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, error, action }]);
    if (ttl) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' is-error' : ''}`}>
            <span>{t.message}</span>
            <span className="spacer" />
            {t.action && (
              <button type="button" className="btn btn-ghost" onClick={() => { t.action.onClick(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
