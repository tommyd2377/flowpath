import assert from "node:assert/strict";
import test from "node:test";

import { EventSnapshotSchema } from "../contracts";
import { AtlasApiError } from "./http";
import { createFixtureWorldClassification } from "./world-fixtures";
import { createMemoryWorldRepository } from "./world-repository";
import { persistVerifiedWorldSnapshot } from "./world-verification";

test("a concurrent refresh rejects stale verification and preserves call consumption", async () => {
  const repository = createMemoryWorldRepository();
  const initial = createFixtureWorldClassification();
  await repository.commitClassification(initial);
  const event = (await repository.getWorldEvent(initial.groups[0]!.eventId))!;
  const snapshot = EventSnapshotSchema.parse({
    id: "93000000-0000-4000-8000-000000000001",
    headline: event.leadHeadline,
    capturedAt: "2026-08-25T17:00:00.000Z",
    verificationStatus: "corroborated",
    summary: "A completed verification for the originally opened revision.",
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
  });
  await repository.commitClassification({
    ...initial,
    scanId: "40000000-0000-4000-8000-000000000001",
    feedFingerprint: "c".repeat(64),
    scannedAt: "2026-08-25T18:00:00.000Z",
    groups: initial.groups.map((group) => ({
      ...group,
      existingEventId: group.eventId,
      summary:
        group.eventId === event.id
          ? `${group.summary} A concurrent update arrived.`
          : group.summary,
    })),
  });

  await assert.rejects(
    persistVerifiedWorldSnapshot({
      repository,
      event,
      snapshot,
      callConsumed: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "world_event_changed");
      assert.equal(error.status, 409);
      assert.equal(error.retryable, false);
      assert.equal(error.callConsumed, true);
      return true;
    },
  );

  const detail = await repository.getWorldEventDetail(event.id);
  assert.equal(detail?.event.state, "candidate");
  assert.equal(detail?.verifiedSnapshot, null);
});

test("a storage failure after verification preserves call consumption", async () => {
  const repository = createMemoryWorldRepository();
  const initial = createFixtureWorldClassification();
  await repository.commitClassification(initial);
  const event = (await repository.getWorldEvent(initial.groups[0]!.eventId))!;
  repository.markEventVerified = async () => {
    throw new Error("write failed");
  };
  const snapshot = EventSnapshotSchema.parse({
    id: "93000000-0000-4000-8000-000000000002",
    headline: event.leadHeadline,
    capturedAt: "2026-08-25T17:00:00.000Z",
    verificationStatus: "corroborated",
    summary: "Completed verification.",
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
  });

  await assert.rejects(
    persistVerifiedWorldSnapshot({
      repository,
      event,
      snapshot,
      callConsumed: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "analysis_persistence_failed");
      assert.equal(error.callConsumed, true);
      return true;
    },
  );
});
