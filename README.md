# FlowPath

FlowPath is a private personal AI prioritization dashboard. It helps answer:

> What should I do today?

Production domain: `https://flowpathapp.com`.

The current MVP also includes **Find My Next Move**, an AI-guided intake flow for
figuring out the highest-leverage next action when a situation feels stuck,
chaotic, or overwhelming.

It is intentionally simple: no auth, no calendar integrations, no Notion integrations, no background jobs, and no complex agents.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- SQLite locally through `@libsql/client`
- OpenAI Node SDK
- OpenAI Responses API with structured JSON output
- Vercel-ready

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file:

```bash
cp .env.example .env.local
```

3. Add your Clerk and OpenAI settings to `.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
FLOWPATH_OWNER_EMAIL=you@example.com
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.5
OPENAI_WEB_SEARCH_ENABLED=true
```

`OPENAI_MODEL` is optional. If omitted, FlowPath defaults to `gpt-5.5`.
`OPENAI_WEB_SEARCH_ENABLED` is optional and defaults to `true`.
Optional role-specific model overrides are available for the cognitive
operating layer: `OPENAI_CLASSIFIER_MODEL`, `OPENAI_MEMORY_MODEL`,
`OPENAI_GENERATOR_MODEL`, `OPENAI_ESCALATION_MODEL`, `OPENAI_EVALUATOR_MODEL`,
and `OPENAI_EXTRACTION_MODEL`.

4. Initialize the database:

```bash
npm run db:init
```

5. Seed the starter profile, life areas, and projects:

```bash
npm run db:seed
```

You can run both database steps together with:

```bash
npm run db:setup
```

6. Run locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Useful Commands

```bash
npm run lint
npm run build
npm run db:init
npm run db:seed
```

`npm run db:init` applies all SQL files in `migrations/`. The migration runner
tracks applied files in `schema_migrations`, so new migrations are only applied
once. After pulling schema changes, run:

```bash
npm run db:init
```

## Environment Variables

Required for AI generation:

```bash
OPENAI_API_KEY=
```

Required for web auth:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
FLOWPATH_OWNER_EMAIL=
```

Required for paid billing:

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CORE_MONTHLY_PRICE_ID=
APP_URL=
```

Optional:

```bash
OPENAI_MODEL=gpt-5.5
OPENAI_CLASSIFIER_MODEL=
OPENAI_MEMORY_MODEL=
OPENAI_GENERATOR_MODEL=
OPENAI_ESCALATION_MODEL=
OPENAI_EVALUATOR_MODEL=
OPENAI_EXTRACTION_MODEL=
OPENAI_MODEL_PRICING_JSON=
OPENAI_WEB_SEARCH_ENABLED=true
OPENAI_WEB_SEARCH_CONTEXT_SIZE=medium
NEXT_PUBLIC_FLOWPATH_COGNITIVE_DEBUG=false
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
DATABASE_URL=file:./data/flowpath.db
TURSO_AUTH_TOKEN=
APP_TIMEZONE=America/New_York
INTERNAL_UNLIMITED_EMAILS=
STRIPE_SUCCESS_URL=
STRIPE_CANCEL_URL=
```

If `OPENAI_API_KEY` is missing, the app still works for profile, areas, projects, tasks, check-ins, and history. The Today screen will show a setup warning and AI generation will return a friendly error.

## Database Notes

Local development defaults to:

```bash
DATABASE_URL=file:./data/flowpath.db
```

Plain SQLite files generally do not persist correctly on Vercel serverless because serverless filesystems are ephemeral and instances are not guaranteed to share the same disk. For deployed persistence, use Turso/libSQL:

```bash
DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your_turso_token
```

The app already uses `@libsql/client`, so swapping local SQLite for Turso is mostly an environment-variable change plus running the migration/seed commands against the Turso database.

## Next Move Flow

The main product flow is **Find My Next Move**:

1. Create or choose a Situation.
2. Answer one AI-guided intake question at a time.
3. Generate a Next Move Plan when ready, or at any point.
4. Turn the plan into tasks from:
   - `first_30_minutes`
   - `next_24_hours`
   - `next_7_days`

The cognitive operating layer now runs around this flow. It detects the user's
state, chooses an intervention style, selects compact relevant memory, gates web
search, evaluates the generated plan once, stores outcome records, and records
stage-level telemetry. In development, QA mode, or when
`NEXT_PUBLIC_FLOWPATH_COGNITIVE_DEBUG=true`, plan cards can show a compact "Why
this response?" panel with operational metadata. See
[docs/cognitive-operating-layer.md](docs/cognitive-operating-layer.md).

When enabled, FlowPath gives the OpenAI Responses API web search tool to AI plan
generation across the app. The prompts instruct the model to use search only when
a plan depends on current, time-sensitive, or location-specific facts not already
covered by FlowPath context. For local advice, store city, region/state/province,
and country in Memory/Profile or the Situation intake. If local specificity
matters and location is missing, FlowPath should ask for it instead of inventing
local resources. Set `OPENAI_WEB_SEARCH_ENABLED=false` to disable it. Set
`OPENAI_WEB_SEARCH_CONTEXT_SIZE` to `low`, `medium`, or `high` to tune how much
search context the model may use.

FlowPath stores profile data, life areas, projects, tasks, check-ins, situations,
intake sessions, transcript messages, generated plans, and generated task links
in SQLite/libSQL. Web access uses Clerk authentication, while app data is scoped
by FlowPath's local `users.id`. Existing single-user data is migrated to local
owner user `1`; set `FLOWPATH_OWNER_EMAIL` so the first matching Clerk login can
claim that owner account. Invite-only beta access is managed in the Clerk
Dashboard.

FlowPath is not a substitute for legal, medical, financial, or emergency help. For
high-stakes situations, the AI should stay practical and encourage appropriate
human or professional support.

## Billing

FlowPath supports Free, Core, and Internal Unlimited tiers. Free users get a
small monthly AI allowance; Core is the early paid subscription tier at
`$12/month`; Internal Unlimited is reserved for configured test users.

See [docs/billing.md](docs/billing.md) for Stripe setup, webhook testing, usage
limits, and internal unlimited assignment.

## Vercel Deployment

1. Create a GitHub repository if this project is not already in one.
2. Commit the code.
3. Push the repo to GitHub.
4. In Vercel, choose **Add New Project** and import the repo.
5. Add environment variables in Vercel:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` if you want to override the default
   - `OPENAI_WEB_SEARCH_ENABLED` if you want to override the default
   - `OPENAI_WEB_SEARCH_CONTEXT_SIZE` if you want something other than `medium`
   - `DATABASE_URL`
   - `TURSO_AUTH_TOKEN` if using Turso
   - `APP_TIMEZONE` if you want something other than `America/New_York`
6. Deploy.
7. Confirm production database persistence by creating a task or check-in, waiting a moment, refreshing, and checking that it remains.

## Manual Steps Codex Cannot Do For You

1. Create an OpenAI API key.
2. Add `OPENAI_API_KEY` to `.env.local`.
3. Install dependencies with `npm install`.
4. Run the database migration/init command with `npm run db:init`.
5. Run locally with `npm run dev`.
6. Create a GitHub repo if needed.
7. Deploy to Vercel.
8. Add environment variables in Vercel.
9. If using deployed persistence, create a Turso database and add connection vars.
10. Confirm production database persistence.

## MVP Limitations

- No auth. Treat the deployed URL as private for v1.
- No calendar, Notion, email, or background job integrations.
- No production-grade audit trail or multi-user separation.
- Local SQLite is great for development, but Turso/libSQL is recommended for deployed persistence.
- With web search disabled, the AI only knows what is stored in FlowPath: Memory/Profile, life areas, projects, tasks, check-ins, situations, and previous plans.
