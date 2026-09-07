# The Voice

A voice-guided news exploration app: an interactive waveform, a curated U.S. and global story briefing, and visual analysis that follows a spoken conversation. Keeps the charcoal/ivory interface and Thomas DeVito’s footer in the app palette.

## Run locally

The project now lives at `/Users/thomasdevito/Projects/flowpath`; its app name remains **The Voice**. It retains the existing FlowPath Git history and GitHub remote. The previous FlowPath checkout was moved to `/Users/thomasdevito/Projects/flowpath-before-voice-20260907-134025` for recovery, including its uncommitted work.

Use Node.js 22.13+ (Node 24 recommended).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3210. The local development and start commands bind to the loopback address. The same app is configured for the existing Vercel project `taskdeck-alpha` at `https://flowpathapp.com`. On Vercel, the browser uses a dedicated WebSocket for session setup, actions, screen reports, streamed status, and hangup; WebRTC continues to carry audio directly to OpenAI. Local development retains the existing HTTP transport.

Click a story (or focus it and press Enter/Space) to explore visually without opening your microphone. Tap the waveform when you want to talk, then allow microphone access. You can also begin with the waveform and ask what is in the news, choose a story by name or number, and navigate entirely by speech. The agent researches the story and its background, summarizes the reporting, and offers three to five possible paths. Say a choice, ask about assumptions, compare alternatives, or ask to go back. Branches expand only when selected, up to five levels.

The briefing collects candidates from Google News top, U.S., and world RSS feeds. OpenAI groups related reporting into up to 20 distinct stories and ranks their significance to U.S. and global affairs, using web search for context. Cards show what the development is and why it matters. Fewer stories are returned when the feed does not support 20 useful choices. Uncurated headlines or older cached stories are explicitly labeled when curation is unavailable.

The lower area changes from the briefing to the selected story, reported evidence and source links, possible paths, assumptions, signals, and comparisons. OpenUI renders these validated components; voice tools and clicks share the same server-owned graph and selected path. The agent can add concise visual analysis during a broader discussion. Generated text is escaped data, never executable HTML or unrestricted UI code. Conversational analysis is labeled separately from sourced reporting, and fresh research does not silently replace frozen facts. Use All stories, or ask to return to the briefing, to choose another story.

Dashboard motion uses reusable React surfaces with Motion and stable OpenUI section identities. Story cards expand into their overview, comparisons settle into columns, and path changes move forward or back while the breadcrumb retains context. On desktop, phones, and tablets, a fresh visit opens with the waveform and its four text lines centered in the upper-middle of the viewport. Starting voice fades the copy and glides the same-size, continuously mounted waveform to the top, revealing the wider news dashboard. It stays docked until refresh. The grid remains accessible by scrolling before starting voice, so click-only exploration still works. Phones use a separate compact dock and a single-column story list; tablets retain two columns. The spoken card expands its context and scrolls beneath the dock. Desktop and mobile spacing remain independently adjustable in their media queries. On phones, tablets, and shorter desktop windows, full headlines remain visible while the spoken, hovered, or keyboard-focused card reveals its additional context. Reduced-motion preferences disable spatial transitions. Component composition remains constrained to the registered library; the model never supplies executable animation code.

When voice is active, opening a story sends the cached briefing context before deeper research finishes. The voice can introduce the attributed reporting and discuss its significance while research runs, then incorporate the completed evidence after ongoing speech finishes. The initial card context is provisional reporting, not a newly verified snapshot. Display changes do not create a new audio connection.

The voice agent can also reason through your own scenarios, challenge assumptions, and discuss consequences outside those saved paths. Ask it to search, check a claim, or find the latest reporting to bring fresh evidence into the conversation. Web research also works before choosing a headline. Results are evidence for the discussion, with sources attributed aloud; they do not silently rewrite the saved snapshot or create new map nodes.

Every selected story gets a possibility map from a completed analysis response. Research gathers context rather than issuing a corroboration verdict: sparse sources, pending votes, disputed premises, or unmatched citations do not block the three-to-five conditional paths. Matched citations are retained individually; unmatched claims are not stored as sourced facts. When search adds no cited facts, the attributed headline supplies the starting premise, with explicit assumptions for the possibilities. This context carries through all five levels. Follow-up searches likewise preserve conditional implications even without new cited findings. Actual transport failures, malformed model output and usage limits remain separate operational errors.

Tools run without spoken action announcements. Plain returns to headlines, scrolling, and path backtracking complete without an automatically generated confirmation; combined navigation-and-discussion requests continue directly with content. Returning to headlines reuses the displayed catalog. Story introductions use the card context while research runs and move straight into the subject.

The selected card stays highlighted when you return to the briefing. Click another card to switch stories. Tap the waveform or press Escape to end voice; tap the waveform again while viewing an exploration to resume it. Reloading restores the opening invitation and remembers the selected story without opening the microphone. Choose its card to resume the saved visual path. Starting voice from the news grid launches a brief guided walkthrough, one story at a time. Each card lifts and highlights when its audio begins, and the next introduction waits for playback to finish. Offscreen stories scroll into view without stealing keyboard focus. Speaking, selecting a story, or ending the call stops automatic progression. The walkthrough uses the catalog and never expands a saved map; duplicate startup requests do not repeat it. Voice can also spotlight a catalog story during a requested discussion without selecting it. The waveform reflects microphone input while listening and the assistant’s audio while speaking. You can interrupt naturally.

The page can be previewed without an API key using the uncurated RSS fallback or fixture mode. With live analysis configured, loading the briefing can trigger a paid curation request when its cache expires; clicking an unexplored story can trigger paid research. Page load never opens the microphone or a Realtime session.

## Add the test key yourself

Create `.env.local` in this project folder and set `OPENAI_API_KEY` to your key. Use your editor locally; do not paste your key into a chat or commit it. `.env*` is ignored by Git. No key or environment file is included in this repository. Restart the local server after setting it.

The key stays on the server. The browser sends an SDP offer to `/api/session`; the server uses OpenAI’s unified WebRTC interface and returns only the SDP answer and an opaque local session identifier. Audio travels directly between your browser and OpenAI. A server-side control connection handles voice tools; a separate local event stream carries research status and structured visual state. `/api/stories` serves the briefing, `/api/exploration` restores or navigates without voice, and `/api/session/action` routes clicks through an active conversation.

The voice model is `gpt-realtime-2.1`, voice `marin`, with low reasoning effort and semantic turn detection. Research retains Flowpath’s `gpt-5.6-luna` default. Initial research uses one Responses request with medium search context and up to two web tool calls for the story and background, bounded to 4,000 output tokens and 75 seconds. Descendant expansions inherit the frozen, cited context without repeating searches. The voice agent’s `search_web` tool separately researches follow-up questions through Responses, using the selected story and path when available. Each fresh follow-up request allows one web search with medium context, 2,200 output tokens, a 45-second timeout, and no retries. Factual findings must cite sources actually consulted by that request. There is no automatic model fallback or connection retry. Actual spoken-choice recognition and live provider behavior require a separately authorized live test.

Development reloads refresh the instructions and research implementation for the next voice connection while preserving an active call and its cleanup/rate-limit state. An already open conversation retains its original instructions until you end it and reconnect. Processes started before this reload hook was added require one normal restart.

Before any Codex-driven live test, explicitly authorize the localhost app, the browser if applicable, and a small test budget. The included checks use fake audio and mocked provider calls only.

Curation uses one Responses request with the existing analysis model, up to two web searches, 6,000 output tokens, a 75-second timeout, and no retries. A shared refresh and durable reservation prevent concurrent paid refreshes across reloads or processes. Successful catalogs are cached for 30 minutes; failed attempts have a five-minute cooldown. Up to 96 catalogs are retained so recently displayed stories remain selectable. Curation is a separate, shared request budget from each story's analysis limits and runs on demand, without a background scheduler.

## Session limits and data

- One active conversation per local server process. Hosted conversations use a shared database lease to allow one active conversation across Vercel instances.
- A maximum of three local session starts per minute; hosted starts are spaced at least 20 seconds apart.
- Ten-minute local session limit; hosted calls allow about 4½ minutes within the existing Vercel Hobby function limit. Both are bounded in the browser and server; tap again to resume the saved exploration. The hosted connection closes before its function deadline, leaving time to hang up the provider call.
- Disconnect after 45 seconds of inactivity; assistant playback, active user speech, and pending research do not count as inactivity.
- At most 1,024 output tokens per response. This and the timers limit usage; they are **not a guaranteed dollar cap**.
- Manual stop, errors, navigation away, and timeouts close browser audio resources and request server-side hangup. A failed server hangup blocks new sessions in that process.
- Saved maps are bounded to ten generation calls, 64 nodes, and five levels per graph. Those bounds do not restrict conversational reasoning or follow-up web research. Both graph generation and fresh follow-up searches share the durable limit of 20 research requests per installation per hour. Revisited branches and replayed tool calls reuse results. A natural endpoint ends saved expansion but allows further discussion and backtracking.
- Matching follow-up searches in the same story context reuse a bounded two-minute memory cache. Switching stories or ending the call cancels pending work and clears that visit’s cached questions and results. Follow-up questions and answers are not written to the database.
- New initial analysis always requires three to five branches. Old evidence-failure cache entries are bypassed; old successful maps and saved paths remain reusable. Sparse-context maps use the same call limits and deduplication as other maps.
- Conversations and audio are not saved by this app. Exploration graphs and the selected path are stored server-side; the browser stores an installation identifier and selected-headline metadata in `the-voice.exploration.v1`. A new voice session receives the saved exploration rather than an old transcript. Audio is processed by OpenAI under its API data policies.

The local database defaults to `data/the-voice.db` and is Git-ignored. On Vercel, existing remote storage is reused with separate `the_voice_v1_` tables and indexes; legacy FlowPath tables are neither read nor modified. Local development keeps its original table names and saved data. Server graph records use bounded 90-day retention. Saved facts are frozen snapshots; their age is included in a resumed discussion and shown visually. Conversation insights and follow-up research displays last only for the current visit; the saved map remains available after reload, without a transcript. Google News RSS supplies headline metadata only; this app does not download or store publisher article bodies. If AI curation fails or is cooling down, newer RSS headlines remain available to the grid and voice. The voice receives publisher dates and catalog freshness; saved stories are used when the feeds cannot be refreshed.

Optional non-secret settings: `VOICE_ANALYSIS_ENABLED=0` disables fresh live research; `VOICE_ANALYSIS_MODEL` overrides the research model; `VOICE_DATABASE_URL` accepts a local `file:./data/*.db` path or an authenticated libSQL/HTTPS database. Hosted storage uses `VOICE_DATABASE_URL` / `VOICE_DATABASE_AUTH_TOKEN`, falling back only on Vercel to the existing `POSSIBILITY_ATLAS_DATABASE_URL` / `POSSIBILITY_ATLAS_DATABASE_AUTH_TOKEN` or `DATABASE_URL` / `TURSO_AUTH_TOKEN` configuration. Local database files are rejected on Vercel. No credentials are embedded in client code. Live use can incur charges for a briefing refresh, story research, path expansion, follow-up search, or voice conversation.

Hosted access is limited to HTTPS requests on the existing domain and the current deployment/branch hostnames, with same-origin checks on mutations and WebSocket upgrades. This remains an unauthenticated personal demonstration: visitors can consume the shared capacity and trigger paid research. Session admission and research guards bound concurrency and request frequency, not dollar spend. Provider cleanup is attempted on socket loss, timeouts and manual stop; failed cleanup retains the shared lease until expiry. No architecture can guarantee remote cleanup after a process crash or total network loss.

## Verify without paid calls

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Browser tests use isolated Playwright Chromium, fake microphone/audio objects, mocked local session endpoints, and a blocked OpenAI host. They cover selection, restoration, rapid story switches, research status races, permission denial, startup cancellation, playback, cleanup, cutoffs, keyboard controls, responsive layout, and reduced motion. Backend fixtures exercise the real graph pipeline and its limits without calling a model. Mocked follow-up tests verify source validation, rate limits, deduplication, stale-result rejection, research without a selected story, and continued research after a saved map reaches its limit. They verify transport and data handling, not a live model’s conversational quality.

```sh
npx playwright install chromium
VOICE_FIXTURE_MODE=1 npm run test:e2e
```

If Chromium is already available, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path instead of installing another copy. No personal browser profile is used.

For a visibly labeled preview with simulated headlines:

```sh
VOICE_FIXTURE_MODE=1 npm run dev
```

Fixture mode disables real Realtime connections even if a key is configured, uses `data/the-voice-fixture.db`, and is forbidden in production. Restart with plain `npm run dev` for personal voice testing. Fixture mode does not synthesize speech in the manual preview; browser tests mock the complete audio flow.

## Stack and references

Next.js, React, TypeScript, OpenUI (`@openuidev/react-lang`), Motion, CSS, Canvas, Web Audio, WebRTC, server WebSocket controls, the OpenAI SDK, Zod, fast-xml-parser, and local libSQL. Flowpath’s research contracts, provenance checks, generation cache, and bounded graph registry run independently inside this app.

- [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Realtime server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Motion layout animation](https://motion.dev/docs/react-layout-animations)
- [OpenUI renderer](https://www.openui.com/docs/openui-lang/renderer)
- [GPT-Realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
- [Realtime voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad)
- [Server-side session hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)


Voice navigation supports natural requests such as “show me more articles,” “scroll up,” “next section,” and “back to the top.” The Realtime agent uses `scroll_page` to move the current page or `get_screen` to inspect visible cards and analysis sections. The browser measures its actual viewport below the voice dock and acknowledges the result before the agent describes it. These controls do not refresh headlines, generate research, or change the saved path. During an active call, debounced local screen observations track scrolling, touch focus, and layout changes. The latest validated snapshot is supplied when the user speaks; observations do not trigger model responses or persist screen history. Explicit screen tools still confirm navigation. Screen context contains structured app state rather than screenshots or transcripts. Scrolling respects reduced motion and stops on manual input, a view change, or session shutdown.


The opening briefing gives one sentence per article, with the highlighted card following actual audio playback. Scrolling down to more articles briefs the newly visible set using their original catalog numbers. Spoken focus requests use `spotlight_story` or `spotlight_path`; opening a detail page or generating a deeper branch requires an explicit exploration request. Focused possibility cards reveal the existing reasoning and assumption with the same motion and foreground treatment as headlines. Lightweight interface actions have no spoken preamble. The news section has no extra heading, and ordinary ended-call messages stay visually hidden so the dock remains compact; actionable errors remain visible. The waveform artwork and button dimensions are preserved.

## Vercel deployment

Use Node 24 and Vercel Fluid compute with WebSocket support. The existing Hobby plan caps functions at 300 seconds. The voice route uses that duration with a 270-second voice limit, a 285-second connection ceiling, and cleanup margin; local sessions keep their ten-minute limit. No subscription or billing changes are made by this repository. `GET /api/health` checks database initialization and reports whether voice is configured without contacting OpenAI. Hosted HTTP voice-start requests are rejected; each call must use its owning WebSocket. The browser stops audio when that connection closes and never automatically starts another paid call.

Run `npm run check` and the fixture browser tests before deployment. For a staged production check, use `vercel deploy --prod --skip-domain`; verify `/api/health`, the static page and a readiness-only WebSocket request, then `vercel promote <deployment-url>`. Do not request `/api/stories` or start a conversation during automated production verification unless paid API testing was explicitly approved. `.vercelignore` excludes local environment files, databases and generated output.
