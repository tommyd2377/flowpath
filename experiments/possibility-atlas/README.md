# Possibility Atlas

A private, local Next.js experiment that turns current Google News headlines into bounded, cited possibility graphs.

## Local development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3100`.

The headline feed works without an API key. To enable live analysis, copy `.env.example` to `.env.local`, add your own `OPENAI_API_KEY`, and set `POSSIBILITY_ATLAS_OPENAI_ENABLED=1`. Never commit `.env.local`.

For deterministic UI work without paid API calls, start the app with `POSSIBILITY_ATLAS_FIXTURE_MODE=1 npm run dev`. Fixture mode is labeled in the interface.

Google News RSS is used only for this personal, non-commercial local prototype. Possibilities are speculative scenarios, not predictions or professional advice.
