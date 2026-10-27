import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation as useRoute, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { AppContext } from './hooks/useApp.js';
import { useLocation } from './hooks/useLocation.js';
import { ToastProvider, useToast } from './hooks/useToast.jsx';
import { TopBar } from './components/TopBar.jsx';
import { Landing } from './pages/Landing.jsx';
import { ForYou } from './pages/ForYou.jsx';
import { MapPage } from './pages/MapPage.jsx';
import { Watchlist } from './pages/Watchlist.jsx';
import { Plans } from './pages/Plans.jsx';
import { PlanDetail } from './pages/PlanDetail.jsx';
import { Taste } from './pages/Taste.jsx';

function Shell() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [feedback, setFeedback] = useState({ artists: {}, genres: {} });
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const loc = useLocation(user?.location || null);
  const toast = useToast();
  const route = useRoute();
  const navigate = useNavigate();

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
      setUnreadAlerts(me.unreadAlerts || 0);
      return me;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe().then((me) => {
      if (!me) return;
      api.feedback().then(setFeedback).catch(() => {});
      api.watchlist().then((w) => setSavedIds(new Set(w.artists.map((a) => a.id)))).catch(() => {});
    });
  }, [refreshMe]);

  // Spotify sends ?auth_error= back on a declined login.
  useEffect(() => {
    const params = new URLSearchParams(route.search);
    const err = params.get('auth_error');
    if (err) {
      toast({ message: `Spotify login failed: ${err}`, error: true });
      navigate(route.pathname, { replace: true });
    }
  }, [route.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const onAuthError = useCallback(() => setUser(null), []);

  const sendFeedback = useCallback(async (type, id, signal) => {
    try {
      setFeedback(await api.sendFeedback(type, id, signal));
    } catch (err) {
      toast({ message: err.message, error: true });
      if (err.status === 401) onAuthError();
    }
  }, [toast, onAuthError]);

  const toggleSave = useCallback(async (artist, save) => {
    setSavedIds((s) => { const n = new Set(s); if (save) n.add(artist.id); else n.delete(artist.id); return n; });
    try {
      const w = save ? await api.addToWatchlist(artist) : await api.removeFromWatchlist(artist.id);
      setSavedIds(new Set(w.artists.map((a) => a.id)));
      toast({ message: save ? `${artist.name} added to your watchlist` : `${artist.name} removed`, ttl: 2500 });
    } catch (err) {
      setSavedIds((s) => { const n = new Set(s); if (save) n.delete(artist.id); else n.add(artist.id); return n; });
      toast({ message: err.message, error: true });
      if (err.status === 401) onAuthError();
    }
  }, [toast, onAuthError]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
    navigate('/');
  }, [navigate]);

  const value = useMemo(() => ({
    user, loc, feedback, sendFeedback, savedIds, toggleSave, unreadAlerts, setUnreadAlerts, refreshMe, onAuthError, toast
  }), [user, loc, feedback, sendFeedback, savedIds, toggleSave, unreadAlerts, refreshMe, onAuthError, toast]);

  if (user === undefined) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <AppContext.Provider value={value}>
      <TopBar user={user} loc={loc} unreadAlerts={unreadAlerts} onLogout={logout} />
      {user ? (
        <Routes>
          <Route path="/" element={<ForYou />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plan/:code" element={<PlanDetail />} />
          <Route path="/taste" element={<Taste />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/plan/:code" element={<RedirectToLogin />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      )}
    </AppContext.Provider>
  );
}

/** A shared plan link opened while logged out: log in, then come back here. */
function RedirectToLogin() {
  const route = useRoute();
  useEffect(() => { window.location.assign(api.loginUrl(route.pathname)); }, [route.pathname]);
  return <div className="page"><p className="muted">Redirecting to Spotify…</p></div>;
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
