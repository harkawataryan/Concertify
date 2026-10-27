import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loading / error / data for one async source, re-run when deps change.
 * A stale response (from an earlier call) is ignored, which matters when
 * filters change faster than the API answers.
 */
export function useFetch(fn, deps, { enabled = true } = {}) {
  const [state, setState] = useState({ loading: enabled, error: null, data: null });
  const seq = useRef(0);

  const reload = useCallback(() => {
    if (!enabled) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => { if (id === seq.current) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (id === seq.current) setState({ loading: false, error: err, data: null }); });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload(); }, [reload]);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload, setData };
}
