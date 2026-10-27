import React from 'react';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';

const CALLOUTS = [
  { icon: 'sparkle', title: 'Ranked, not listed', body: 'Every nearby show gets a score from how much you play the artist, how close the genres are, distance and date. You can see the breakdown.' },
  { icon: 'users', title: 'Plan with friends', body: 'Share a link; everyone logs in once and the ranking merges all of your tastes, flagging shows the whole group would go to.' },
  { icon: 'bell', title: 'Never miss an announcement', body: 'Save artists to a watchlist and get alerted when they book a show within your radius.' }
];

export function Landing() {
  return (
    <main className="landing">
      <section className="landing-hero">
        <h1>Shows near you, ranked by what you actually listen to.</h1>
        <p>
          Concertify reads your top artists from Spotify across the last month, six months and all time, then scores every upcoming concert
          within your radius against that profile. Artists you play get the biggest boost; genre overlap, distance and how soon the show is
          fill in the rest. Nothing is written to your Spotify account.
        </p>
        <div className="row">
          <a className="btn btn-primary btn-lg" href={api.loginUrl()}>Continue with Spotify</a>
          <span className="faint small">Read-only access to your top artists.</span>
        </div>
      </section>
      <section className="callouts">
        {CALLOUTS.map((c) => (
          <div key={c.title} className="callout">
            <Icon name={c.icon} size={20} />
            <b>{c.title}</b>
            <p>{c.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
