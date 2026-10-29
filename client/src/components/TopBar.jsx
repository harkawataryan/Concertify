import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { Logo } from './Logo.jsx';
import { PRESET_CITIES, RADII, isAnywhere, radiusLabel } from '../hooks/useLocation.js';
import { initials } from '../lib/format.js';

const NAV = [
  { to: '/', label: 'For you', icon: 'sparkle', end: true },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/watchlist', label: 'Watchlist', icon: 'bookmark' },
  { to: '/plans', label: 'Plans', icon: 'users' },
  { to: '/taste', label: 'Taste', icon: 'list' }
];

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

function LocationMenu({ loc }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));
  const { location, status, setLocation, setRadius, useDeviceLocation } = loc;

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="pill" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Icon name="location" size={14} />
        <span>{!location ? 'Set location' : isAnywhere(location.radius) ? `Anywhere · from ${location.name}` : `${location.name} · ${location.radius} mi`}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" className="menu-item" onClick={() => { useDeviceLocation(); setOpen(false); }} disabled={status === 'locating'}>
            <Icon name="crosshair" size={16} /> {status === 'locating' ? 'Locating…' : 'Use my location'}
          </button>
          {status === 'denied' && <div className="menu-label" style={{ textTransform: 'none', letterSpacing: 0 }}>Location access was blocked; pick a city.</div>}
          <div className="menu-label">Cities</div>
          {PRESET_CITIES.map((c) => (
            <button key={c.name} type="button" className={`menu-item${location?.name === c.name ? ' is-active' : ''}`} onClick={() => { setLocation({ ...c, radius: location?.radius || 50 }); setOpen(false); }}>
              {c.name}
            </button>
          ))}
          <div className="menu-label">Radius</div>
          <div className="segmented" style={{ margin: '0 10px 6px' }}>
            {RADII.map((r) => (
              <button key={r} type="button" className={location?.radius === r ? 'is-active' : ''} onClick={() => setRadius(r)} disabled={!location}>{radiusLabel(r)}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));
  const name = user.displayName || user.id;
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="avatar" onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}>
        {initials(name)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label" style={{ textTransform: 'none', letterSpacing: 0 }}>Signed in as {name}</div>
          <button type="button" className="menu-item" onClick={onLogout}><Icon name="logout" size={16} /> Log out</button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ user, loc, unreadAlerts, onLogout }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark"><Logo /> Concertify</Link>
          {user && (
            <nav className="nav" aria-label="Primary">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'is-active' : '')}>{n.label}</NavLink>
              ))}
            </nav>
          )}
          <div className="topbar-right">
            {user ? (
              <>
                <LocationMenu loc={loc} />
                <Link to="/watchlist" className="btn btn-ghost btn-icon" aria-label={`Alerts${unreadAlerts ? `, ${unreadAlerts} unread` : ''}`} style={{ position: 'relative' }}>
                  <Icon name="bell" />
                  {unreadAlerts > 0 && <span className="badge">{unreadAlerts > 99 ? '99+' : unreadAlerts}</span>}
                </Link>
                <UserMenu user={user} onLogout={onLogout} />
              </>
            ) : null}
          </div>
        </div>
      </header>
      {user && (
        <nav className="mobile-nav" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <Icon name={n.icon} size={20} />{n.label}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}
