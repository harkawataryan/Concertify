import { useCallback, useEffect, useState } from 'react';

export const PRESET_CITIES = [
  { name: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
  { name: 'New York, NY', lat: 40.7128, lng: -74.006 },
  { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  { name: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
  { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  { name: 'Seattle, WA', lat: 47.6062, lng: -122.3321 },
  { name: 'Nashville, TN', lat: 36.1627, lng: -86.7816 },
  { name: 'Boston, MA', lat: 42.3601, lng: -71.0589 },
  { name: 'Denver, CO', lat: 39.7392, lng: -104.9903 },
  { name: 'Atlanta, GA', lat: 33.749, lng: -84.388 }
];

const STORAGE_KEY = 'concertify.location';

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Where to search. Tries the saved choice, then browser geolocation, and
 * always lets the user pick a preset city instead.
 */
export function useLocation() {
  const [location, setLocationState] = useState(readSaved);
  const [status, setStatus] = useState(location ? 'ready' : 'idle');

  const setLocation = useCallback((loc) => {
    setLocationState(loc);
    setStatus('ready');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    } catch {
      // Private mode or blocked storage; the choice just won't persist.
    }
  }, []);

  const useDeviceLocation = useCallback(() => {
    if (!navigator.geolocation) return setStatus('unsupported');
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({ name: 'Near me', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setStatus('denied'),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  }, [setLocation]);

  useEffect(() => {
    if (!location) useDeviceLocation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { location, status, setLocation, useDeviceLocation };
}
