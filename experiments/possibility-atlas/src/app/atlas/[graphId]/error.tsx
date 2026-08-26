"use client";

import Link from "next/link";

export default function AtlasError({ reset }: { reset: () => void }) {
  return (
    <main className="atlas-shell">
      <section className="empty-state route-empty">
        <p className="eyebrow">Atlas view interrupted</p>
        <h1>This saved atlas could not be displayed.</h1>
        <p>Your browser-local data has not been deleted.</p>
        <div className="button-row">
          <button type="button" className="primary-button" onClick={reset}>Try again</button>
          <Link className="secondary-button" href="/">Back to headlines</Link>
        </div>
      </section>
    </main>
  );
}
