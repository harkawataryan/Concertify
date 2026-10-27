import { createContext, useContext } from 'react';

/**
 * Session-wide state provided by App: the user, location, feedback and
 * watchlist membership, plus the handlers pages share to mutate them.
 */
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
