import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "@libsql/client";
import { z } from "zod";

import { EventSnapshotSchema, type HeadlineItem } from "../contracts";
import { createFixtureWorldClassification } from "./world-fixtures";
import { LibsqlWorldRepository } from "./world-libsql-repository";
import {
  createMemoryWorldRepository,
  WORLD_EVENT_INACTIVE_MS,
  WORLD_EVENT_RETENTION_MS,
  type WorldRepository,
  type WorldClassificationCommit,
} from "./world-repository";

const day = 24 * 60 * 60 * 1_000;

function shiftedCommit(
  base: WorldClassificationCommit,
  options: { fingerprint: string; scannedAt: string; groups?: WorldClassificationCommit["groups"] },
): WorldClassificationCommit {
  return {
    ...base,
    scanId:
      options.fingerprint.repeat(8).slice(0, 8) +
      "-0000-4000-8000-000000000001",
    feedFingerprint: options.fingerprint.repeat(64).slice(0, 64),
    scannedAt: options.scannedAt,
    groups: options.groups ?? base.groups,
  };
}

async function assertRevisionMergeAndRetention(repository: WorldRepository) {
  const initial = createFixtureWorldClassification();
  await repository.commitClassification(initial);
  const sourceGroup = initial.groups[0]!;
  const mergedGroup = initial.groups[1]!;
  const initialSource = await repository.getWorldEvent(sourceGroup.eventId);
  assert.ok(initialSource);

  const swapped = {
    ...sourceGroup,
    existingEventId: sourceGroup.eventId,
    headlines: sourceGroup.headlines.map((item, index) => ({
      ...item,
      role: index === 1 ? ("root" as const) : ("supporting" as const),
    })),
  };
  await repository.commitClassification(
    shiftedCommit(initial, {
      fingerprint: "6",
      scannedAt: new Date(Date.parse(initial.scannedAt) + day).toISOString(),
      groups: [
        swapped,
        ...initial.groups.slice(1).map((group) => ({
          ...group,
          existingEventId: group.eventId,
        })),
      ],
    }),
  );
  const roleChanged = await repository.getWorldEvent(sourceGroup.eventId);
  assert.equal(roleChanged?.revision, (initialSource?.revision ?? 0) + 1);
  assert.equal(roleChanged?.leadHeadline.id, sourceGroup.headlines[1]!.headline.id);

  await repository.commitClassification(
    shiftedCommit(initial, {
      fingerprint: "7",
      scannedAt: new Date(Date.parse(initial.scannedAt) + 2 * day).toISOString(),
      groups: [
        {
          ...swapped,
          headlines: [...swapped.headlines, ...mergedGroup.headlines],
        },
        ...initial.groups.slice(2).map((group) => ({
          ...group,
          existingEventId: group.eventId,
        })),
      ],
    }),
  );
  assert.equal(await repository.getWorldEvent(mergedGroup.eventId), null);
  assert.equal(
    (await repository.getWorldEventDetail(sourceGroup.eventId))?.headlines.length,
    4,
  );

  for (let scan = 0; scan < 5; scan += 1) {
    const headlines = Array.from({ length: 30 }, (_, index): HeadlineItem => ({
      id: `retained-${scan}-${String(index).padStart(2, "0")}`,
      title: `Retained reporting ${scan}-${index}`,
      publisher: "Retention Fixture",
      publisherUrl: "https://retention.example/",
      googleNewsUrl: `https://news.google.com/rss/articles/retained-${scan}-${index}`,
      publishedAt: new Date(
        Date.parse(initial.scannedAt) + (scan + 3) * day,
      ).toISOString(),
    }));
    await repository.commitClassification({
      ...initial,
      scanId: `0000000${scan + 1}-0000-4000-8000-100000000001`,
      feedFingerprint: String(scan + 1).repeat(64),
      scannedAt: new Date(
        Date.parse(initial.scannedAt) + (scan + 3) * day,
      ).toISOString(),
      headlineCount: headlines.length,
      groups: [
        {
          ...swapped,
          headlines: headlines.map((headline, index) => ({
            headline,
            role: index === 0 ? ("root" as const) : ("supporting" as const),
          })),
        },
      ],
      standaloneHeadlineIds: [],
    });
  }
  const retained = await repository.getWorldEventDetail(sourceGroup.eventId);
  assert.equal(retained?.event.headlineIds.length, 120);
  assert.equal(retained?.headlines.length, 120);
  assert.ok(
    retained?.event.headlineIds.includes(retained.event.leadHeadline.id),
  );
}

test("memory catalog revises lead changes, merges without orphans, and retains 120 headlines", async () => {
  await assertRevisionMergeAndRetention(createMemoryWorldRepository());
});

test("libSQL catalog revises lead changes, merges without orphans, and retains 120 headlines", async () => {
  const client = createClient({ url: "file::memory:" });
  await assertRevisionMergeAndRetention(new LibsqlWorldRepository(client));
  client.close();
});

test("memory repository preserves event identity, adds supporting updates, inactivates and revives", async () => {
  const repository = createMemoryWorldRepository();
  const initial = createFixtureWorldClassification();
  await repository.commitClassification(initial);
  const event = (await repository.getCatalogSnapshot()).events[0]!;
  const originalRevision = event.revision;
  const originalGroup = initial.groups.find((group) => group.eventId === event.id)!;
  const updateHeadline = {
    ...event.leadHeadline,
    id: "fixture-new-supporting-001",
    title: "A new supporting update arrives",
  };
  const nextAt = new Date(Date.parse(initial.scannedAt) + day).toISOString();
  await repository.commitClassification(
    shiftedCommit(initial, {
      fingerprint: "b",
      scannedAt: nextAt,
      groups: [
        {
          ...originalGroup,
          existingEventId: event.id,
          headlines: [
            ...originalGroup.headlines,
            { headline: updateHeadline, role: "supporting" },
          ],
        },
      ],
    }),
  );
  const updated = await repository.getWorldEvent(event.id);
  assert.equal(updated?.id, event.id);
  assert.equal(updated?.revision, originalRevision + 1);
  assert.ok(updated?.headlineIds.includes(updateHeadline.id));
  assert.ok(
    (await repository.getCatalogSnapshot()).recentlyChanged.some(
      (candidate) => candidate.id === event.id,
    ),
  );

  const inactiveAt = new Date(Date.parse(nextAt) + WORLD_EVENT_INACTIVE_MS + 1).toISOString();
  await repository.commitClassification(
    shiftedCommit(initial, {
      fingerprint: "c",
      scannedAt: inactiveAt,
      groups: [],
    }),
  );
  assert.equal((await repository.getWorldEvent(event.id))?.state, "inactive");

  const revivalAt = new Date(Date.parse(inactiveAt) + day).toISOString();
  await repository.commitClassification(
    shiftedCommit(initial, {
      fingerprint: "d",
      scannedAt: revivalAt,
      groups: [{ ...originalGroup, existingEventId: event.id }],
    }),
  );
  assert.equal((await repository.getWorldEvent(event.id))?.state, "candidate");
});

test("memory repository prunes events after ninety days and filters low-ripple groups", async () => {
  const repository = createMemoryWorldRepository();
  const initial = createFixtureWorldClassification();
  initial.groups[0]!.dimensions = {
    impact: 1,
    branchability: 1,
    connectivity: 1,
    uncertainty: 1,
  };
  await repository.commitClassification(initial);
  const lowEventId = initial.groups[0]!.eventId;
  assert.ok(!(await repository.getCatalogSnapshot()).events.some((event) => event.id === lowEventId));

  const pruneAt = new Date(
    Date.parse(initial.scannedAt) + WORLD_EVENT_RETENTION_MS + 1,
  ).toISOString();
  await repository.commitClassification(
    shiftedCommit(initial, { fingerprint: "e", scannedAt: pruneAt, groups: [] }),
  );
  assert.equal(await repository.getWorldEvent(lowEventId), null);
});

test("global snapshot hides stored edges unless source is verified and both events remain active", async () => {
  const repository = createMemoryWorldRepository();
  const initial = createFixtureWorldClassification();
  await repository.commitClassification(initial);
  const source = (await repository.getWorldEvent(initial.groups[0]!.eventId))!;
  const target = (await repository.getWorldEvent(initial.groups[1]!.eventId))!;
  await repository.markEventVerified(
    source.id,
    EventSnapshotSchema.parse({
      id: "93000000-0000-4000-8000-000000000001",
      headline: source.leadHeadline,
      capturedAt: "2026-08-25T17:00:00.000Z",
      verificationStatus: "corroborated",
      summary: "Verified source event.",
      facts: [{ text: "Verified fixture fact.", sourceIds: ["s01"] }],
      uncertainties: [],
      sources: [
        {
          id: "s01",
          title: "Fixture source",
          url: "https://source.example/report",
          domain: "source.example",
        },
      ],
    }),
  );
  const graphId = "94000000-0000-4000-8000-000000000001";
  const scenarioNodeId = "95000000-0000-4000-8000-000000000001";
  await repository.commitRippleAnalysis({
    graphId,
    scenarioNodeId,
    sourceEventId: source.id,
    catalogVersion: 1,
    analyzedAt: "2026-08-25T18:00:00.000Z",
    edges: [
      {
        id: "96000000-0000-4000-8000-000000000001",
        sourceEventId: source.id,
        sourceScenarioNodeId: scenarioNodeId,
        targetEventId: target.id,
        influence: "raises_likelihood",
        strength: "moderate",
        confidence: "medium",
        mechanism: "The verified source could affect the target through a fixture mechanism.",
        horizon: "Coming weeks",
        watchFor: ["A fixture signal"],
        analyzedAt: "2026-08-25T18:00:00.000Z",
      },
    ],
  });
  assert.equal((await repository.getCatalogSnapshot()).crossCurrents.length, 1);

  await repository.commitClassification(
    shiftedCommit(initial, {
      fingerprint: "8",
      scannedAt: new Date(
        Date.parse(initial.scannedAt) + WORLD_EVENT_INACTIVE_MS + 1,
      ).toISOString(),
      groups: [
        {
          ...initial.groups[0]!,
          existingEventId: source.id,
        },
      ],
    }),
  );
  assert.equal((await repository.getCatalogSnapshot()).crossCurrents.length, 0);
  assert.equal(
    (await repository.getRippleAnalysis({ graphId, scenarioNodeId }))?.length,
    1,
  );
});

test("generation templates validate writes and reads with insert-if-absent semantics", async () => {
  const repository = createMemoryWorldRepository();
  const schema = z.object({ title: z.string() }).strict();
  const first = await repository.putGenerationTemplate(
    {
      key: "start:key",
      kind: "start",
      model: "fixture-model",
      promptVersion: "v1",
      sourceFingerprint: "source-a",
      payload: { title: "first" },
      createdAt: "2026-08-25T16:00:00.000Z",
    },
    schema,
  );
  const second = await repository.putGenerationTemplate(
    {
      key: "start:key",
      kind: "start",
      model: "fixture-model",
      promptVersion: "v1",
      sourceFingerprint: "source-b",
      payload: { title: "second" },
      createdAt: "2026-08-25T17:00:00.000Z",
    },
    schema,
  );
  assert.deepEqual(first, second);
  assert.deepEqual(await repository.getGenerationTemplate("start:key", schema), first);
  assert.equal(
    await repository.getGenerationTemplate(
      "start:key",
      z.object({ count: z.number() }).strict(),
    ),
    null,
  );
});

test("libSQL migration and classification commit are idempotent", async () => {
  const client = createClient({ url: "file::memory:" });
  const repository = new LibsqlWorldRepository(client);
  await Promise.all([repository.initialize(), repository.initialize()]);
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  await repository.commitClassification(commit);
  const snapshot = await repository.getCatalogSnapshot();
  assert.equal(snapshot.catalogVersion, 1);
  assert.equal(snapshot.events.length, 4);

  const event = snapshot.events[0]!;
  const verifiedSnapshot = EventSnapshotSchema.parse({
    id: "90000000-0000-4000-8000-000000000001",
    headline: event.leadHeadline,
    capturedAt: "2026-08-25T17:00:00.000Z",
    verificationStatus: "corroborated",
    summary: "Verified fixture snapshot.",
    facts: [{ text: "Fixture fact.", sourceIds: ["s01"] }],
    uncertainties: [],
    sources: [
      {
        id: "s01",
        title: "Fixture source",
        url: "https://source.example/report",
        domain: "source.example",
      },
    ],
  });
  await repository.markEventVerified(event.id, verifiedSnapshot);
  assert.equal((await repository.getWorldEvent(event.id))?.state, "verified");
  assert.deepEqual(
    (await repository.getWorldEventDetail(event.id))?.verifiedSnapshot,
    verifiedSnapshot,
  );

  const graphId = "91000000-0000-4000-8000-000000000001";
  const scenarioNodeId = "92000000-0000-4000-8000-000000000001";
  assert.deepEqual(
    await repository.commitRippleAnalysis({
      graphId,
      scenarioNodeId,
      sourceEventId: event.id,
      catalogVersion: snapshot.catalogVersion,
      edges: [],
      analyzedAt: "2026-08-25T18:00:00.000Z",
    }),
    [],
  );
  assert.deepEqual(
    await repository.getRippleAnalysis({ graphId, scenarioNodeId }),
    [],
  );
  assert.equal(
    await repository.getRippleAnalysis({
      graphId,
      scenarioNodeId,
      catalogVersion: snapshot.catalogVersion + 1,
    }),
    null,
  );

  const target = snapshot.events.find((candidate) => candidate.id !== event.id)!;
  const replacementGraphId = "99000000-0000-4000-8000-000000000001";
  const replacementScenarioId = "99100000-0000-4000-8000-000000000001";
  const firstEdge = {
    id: "99200000-0000-4000-8000-000000000001",
    sourceEventId: event.id,
    sourceScenarioNodeId: replacementScenarioId,
    targetEventId: target.id,
    influence: "raises_likelihood" as const,
    strength: "moderate" as const,
    confidence: "medium" as const,
    mechanism: "First catalog-version mechanism.",
    horizon: "Coming weeks",
    watchFor: ["First signal"],
    analyzedAt: "2026-08-25T18:10:00.000Z",
  };
  await repository.commitRippleAnalysis({
    graphId: replacementGraphId,
    scenarioNodeId: replacementScenarioId,
    sourceEventId: event.id,
    catalogVersion: 1,
    edges: [firstEdge],
    analyzedAt: firstEdge.analyzedAt,
  });
  const replacementEdge = {
    ...firstEdge,
    id: "99300000-0000-4000-8000-000000000001",
    mechanism: "Replacement catalog-version mechanism.",
    analyzedAt: "2026-08-25T18:15:00.000Z",
  };
  await repository.commitRippleAnalysis({
    graphId: replacementGraphId,
    scenarioNodeId: replacementScenarioId,
    sourceEventId: event.id,
    catalogVersion: 2,
    edges: [replacementEdge],
    analyzedAt: replacementEdge.analyzedAt,
  });
  assert.deepEqual(
    (
      await repository.getRippleAnalysis({
        graphId: replacementGraphId,
        scenarioNodeId: replacementScenarioId,
      })
    )?.map((edge) => edge.id),
    [replacementEdge.id],
  );
  assert.equal(
    await repository.getRippleAnalysis({
      graphId: replacementGraphId,
      scenarioNodeId: replacementScenarioId,
      catalogVersion: 1,
    }),
    null,
  );
  assert.deepEqual(
    (
      await repository.getRippleAnalysis({
        graphId: replacementGraphId,
        scenarioNodeId: replacementScenarioId,
        catalogVersion: 2,
      })
    )?.map((edge) => edge.id),
    [replacementEdge.id],
  );
  assert.deepEqual(
    await repository.commitRippleAnalysis({
      graphId,
      scenarioNodeId,
      sourceEventId: event.id,
      catalogVersion: snapshot.catalogVersion + 1,
      edges: [],
      analyzedAt: "2026-08-25T18:05:00.000Z",
    }),
    [],
  );
  assert.equal(
    await repository.getRippleAnalysis({
      graphId,
      scenarioNodeId,
      catalogVersion: snapshot.catalogVersion,
    }),
    null,
  );

  const templateSchema = z.object({ value: z.string() }).strict();
  await repository.putGenerationTemplate(
    {
      key: "corruptible-template",
      kind: "start",
      model: "fixture-model",
      promptVersion: "v1",
      sourceFingerprint: "fixture-source",
      payload: { value: "valid" },
      createdAt: "2026-08-25T18:00:00.000Z",
    },
    templateSchema,
  );
  await client.execute({
    sql: "UPDATE generation_templates SET payload_json = ? WHERE cache_key = ?",
    args: ["not-json", "corruptible-template"],
  });
  assert.equal(
    await repository.getGenerationTemplate(
      "corruptible-template",
      templateSchema,
    ),
    null,
  );
  assert.deepEqual(
    await repository.putGenerationTemplate(
      {
        key: "corruptible-template",
        kind: "start",
        model: "fixture-model",
        promptVersion: "v1",
        sourceFingerprint: "fixture-source",
        payload: { value: "repaired" },
        createdAt: "2026-08-25T19:00:00.000Z",
      },
      templateSchema,
    ),
    {
      payload: { value: "repaired" },
      createdAt: "2026-08-25T19:00:00.000Z",
    },
  );
  client.close();
});

test("libSQL initialization removes only deterministic legacy fixture catalog rows", async () => {
  const client = createClient({ url: "file::memory:" });
  const legacyRepository = new LibsqlWorldRepository(client);
  await legacyRepository.initialize();
  const fixture = createFixtureWorldClassification();
  await legacyRepository.commitClassification(fixture);
  const liveEventId = "97000000-0000-4000-8000-000000000001";
  const liveHeadline = {
    ...fixture.groups[0]!.headlines[0]!.headline,
    id: "preserved-live-headline-001",
    title: "A non-fixture event that must be preserved",
  };
  await legacyRepository.commitClassification({
    ...fixture,
    scanId: "98000000-0000-4000-8000-000000000001",
    feedFingerprint: "9".repeat(64),
    scannedAt: "2026-08-25T17:00:00.000Z",
    headlineCount: 1,
    groups: [
      {
        ...fixture.groups[0]!,
        eventId: liveEventId,
        existingEventId: null,
        canonicalTitle: "Preserved non-fixture event",
        headlines: [{ headline: liveHeadline, role: "root" }],
      },
    ],
    standaloneHeadlineIds: [],
  });
  assert.equal((await legacyRepository.getCatalogSnapshot()).events.length, 5);

  const liveRepository = new LibsqlWorldRepository(client);
  await liveRepository.initialize();
  const remaining = (await liveRepository.getCatalogSnapshot()).events;
  assert.deepEqual(remaining.map((event) => event.id), [liveEventId]);
  client.close();
});
