# Possibility Atlas

A private, local Next.js experiment that turns current Google News headlines into bounded, cited possibility graphs.

## Local development

```bash
npm install
npm run db:init
npm run dev
```

Open `http://127.0.0.1:3100`.

The headline feed works without an API key. To enable live analysis, copy `.env.example` to `.env.local`, add your own `OPENAI_API_KEY`, and set `POSSIBILITY_ATLAS_OPENAI_ENABLED=1`. Never commit `.env.local`.

For deterministic UI work without paid API calls, start the app with `POSSIBILITY_ATLAS_FIXTURE_MODE=1 npm run dev`. Fixture mode is labeled in the interface.

## World in Motion

World in Motion is an additive, explicitly refreshed catalog above the original
headline picker. It groups related reporting into persistent candidate events,
keeps standalone headlines available in the unchanged picker, and stores only
headline metadata, generated event descriptions, verified snapshots, and
validated ripple relationships in `data/possibility-atlas.db`.

The catalog uses only `POSSIBILITY_ATLAS_DATABASE_URL` and defaults to the
gitignored local file shown in `.env.example`; it never reads FlowPath's
database. `npm run db:init` is safe to repeat. Fixture mode builds four labeled
events without fetching news or making a paid model call. Live `Refresh world
view` first fetches the fixed U.S. Google News RSS feed; an unchanged feed
fingerprint reuses the existing catalog without invoking the model.

The world classifier uses one tool-free `gpt-5.6-terra` Structured Outputs call
per changed feed. Invalid, incomplete, or refused classifications are not
repaired or partially saved.

Google News RSS is used only for this personal, non-commercial local prototype. Possibilities are speculative scenarios, not predictions or professional advice.
