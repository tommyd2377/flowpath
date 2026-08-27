# Possibility Atlas

Possibility Atlas turns a current headline into a bounded, cited possibility graph. The headline is verified once, then readers can explore up to five levels of clearly labeled speculative consequences.

## Local development

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3100`.

The headline feed works without an API key. Live analysis requires these server-side environment variables:

- `OPENAI_API_KEY`
- `POSSIBILITY_ATLAS_OPENAI_ENABLED=1`
- `NEXT_PUBLIC_SITE_URL=https://flowpathapp.com`

Never commit `.env.local` or production secret values. For deterministic UI work without paid calls, run `POSSIBILITY_ATLAS_FIXTURE_MODE=1 npm run dev`; fixture mode is visibly labeled.

## Verification and operations

```bash
npm run check
curl --fail https://flowpathapp.com/api/health
```

`npm run check` runs lint, typechecking, unit tests, and a production build. Tests and fixture mode do not make OpenAI calls. Vercel serves the production build, and `/api/health` is the uncached deployment health endpoint.

To roll back, redeploy the previous known-good Vercel deployment or revert the production promotion commit and redeploy `main`. Do not rewrite shared Git history.

## News-source limitation

The current Google News RSS integration began as a personal, non-commercial feed-reader prototype. Before broader commercial distribution, replace it with a news provider whose license explicitly permits public product use; the application stores and displays metadata only, not article bodies or publisher HTML.

Possibilities are speculative scenarios, not predictions or professional advice.
