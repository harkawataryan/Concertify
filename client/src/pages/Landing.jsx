import React from 'react';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { RingsBackdrop } from '../components/Logo.jsx';

// Mirrors WEIGHTS in server/src/services/recommender.js.
const WEIGHTS = [
  { label: 'You listen to the artist', value: 55 },
  { label: 'Genre overlap with your profile', value: 30 },
  { label: 'Distance from you', value: 8 },
  { label: 'How soon the show is', value: 7 }
];

const CALLOUTS = [
  { icon: 'sparkle', title: 'Ranked, not listed', body: 'Every nearby show gets a score, and every score comes with its reasons. Thumbs up or down reshapes your profile.' },
  { icon: 'users', title: 'Plan with friends', body: 'Share a link. Everyone logs in once and the ranking merges all of your tastes, with a penalty for shows someone would hate.' },
  { icon: 'bell', title: 'Never miss an announcement', body: 'Save artists to a watchlist and get an alert when they book a date within your radius.' }
];

export function Landing() {
  return (
    <main className="landing">
      <section className="landing-hero">
        <RingsBackdrop />
        <span className="eyebrow">Concert discovery for Spotify listeners</span>
        <h1>Shows near you, ranked by what you <em>actually</em> listen to.</h1>
        <p>
          Concertify reads your top artists across the last month, six months and all time, then scores every upcoming
          concert within your radius against that profile. Nothing is written to your Spotify account.
        </p>
        <div className="row">
          <a className="btn btn-primary btn-lg" href={api.loginUrl()}>Continue with Spotify</a>
          <span className="faint small">Read-only access to your top artists.</span>
        </div>
      </section>

      <section className="how">
        <div className="how-text">
          <span className="eyebrow">How a show is scored</span>
          <h2>Four signals, weighted.</h2>
          <p className="muted">
            Recent listening counts more than old favorites, and multiple dates of the same artist collapse into one card.
            A final pass trades a little score for variety so the list isn't ten shows from one genre.
          </p>
        </div>
        <div className="weights">
          {WEIGHTS.map((w) => (
            <div key={w.label} className="bar-row">
              <span className="bar-name">{w.label}</span>
              <div className="bar"><div style={{ width: `${w.value}%` }} /></div>
              <span className="bar-value">{w.value}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="callouts">
        {CALLOUTS.map((c, i) => (
          <div key={c.title} className="callout">
            <div className="callout-head">
              <Icon name={c.icon} size={18} />
              <span className="callout-num">0{i + 1}</span>
            </div>
            <b>{c.title}</b>
            <p>{c.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
