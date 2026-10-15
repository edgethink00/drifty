import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  classifyActivityDetailed,
  type ActivitySegment,
} from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { hasClassifiedDashboardResult } from "../dashboard/hasClassifiedDashboardResult";
import { materializeBuiltInHeuristicClassifications } from "./heuristicClassificationMaterialization";

type ReceiverDtos = {
  full: ActivitySegment;
  compact: ActivitySegment;
  live: ActivitySegment;
  remoteOutboxCount: number;
  ownership: string;
  ruleSnapshotKind: string;
  publicReviewKeys: string[];
};

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const trackerRoot = join(repositoryRoot, "services/tracker-python");

function productionReceiverDtos(ruleKind: "user" | "automatic"): ReceiverDtos {
  const source = String.raw`
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from app.storage.db import TrackerDatabase
from app.storage.live_tail import fetch_live_tail

with TemporaryDirectory() as root:
    origin = TrackerDatabase(Path(root) / "origin.sqlite3", perform_maintenance=False)
    database = TrackerDatabase(Path(root) / "receiver.sqlite3", perform_maintenance=False)
    try:
        origin.set_sync_state({
            "sync_account_id": "synthetic-account",
            "sync_device_id": "11111111-2222-3333-4444-555555555555",
        })
        database.set_sync_state({
            "sync_account_id": "synthetic-account",
            "sync_device_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        })
        origin.insert_segment({
            "started_at": "2026-07-06T09:00:00+00:00",
            "ended_at": "2026-07-06T09:03:00+00:00",
            "duration_seconds": 180,
            "app_name": "Code",
            "bundle_id": "com.microsoft.VSCode",
            "window_title": "Synthetic synced rule",
            "platform": "macos",
            "source": "accessibility",
            "raw_context_json": "{}",
        })
        if ${JSON.stringify(ruleKind)} == "user":
            origin.save_classification_rule({
                "targetKind": "app",
                "targetValue": "Code",
                "category": "entertainment",
                "productivity": "drift",
            })
            assert origin.apply_classification_rules()["appliedCount"] == 1
        else:
            # Automatic deterministic results also use source=rule without
            # a local rule FK. The wire cannot assert user authorship.
            assert origin.save_classifications([{
                "segmentId": origin.timeline()[0]["id"],
                "inputFingerprint": "synthetic:automatic-rule",
                "source": "rule", "category": "entertainment",
                "productivity": "drift", "confidence": 0.9,
            }]) == 1
        outbox = origin.get_sync_outbox(0, hot_grace_seconds=0)
        incoming = [{
            **item,
            "originDeviceId": "11111111-2222-3333-4444-555555555555",
        } for item in outbox["items"]]
        database.apply_synced_segments(incoming)

        with database.connect() as conn:
            segment_id = conn.execute(
                "SELECT id FROM activity_segments WHERE segment_uid = ?",
                (outbox["items"][0]["segmentUid"],),
            ).fetchone()["id"]
        pass_id = database.record_project_pass({
            "rangeStart": "2026-07-06T00:00:00+00:00",
            "rangeEnd": "2026-07-07T00:00:00+00:00",
            "trigger": "manual",
            "correctionsCount": 0,
        })["id"]
        assert database.save_classifications([{
            "segmentId": segment_id,
            "inputFingerprint": "synthetic:local-review",
            "category": "workspace",
            "productivity": "focus",
            "source": "ai_review",
            "confidence": 0.99,
            "reviewPassId": pass_id,
        }]) == 1
        review = database.get_ai_review_events()[0]
        assert database.revert_ai_review_event(review["id"]) == {
            "reverted": True,
            "restored": True,
        }

        start = "2026-07-06T00:00:00+00:00"
        end = "2026-07-07T00:00:00+00:00"
        full = database._serialize_row(database.timeline(start, end)[0])
        compact = database.dashboard_week_timeline(start, end)[0]
        live = fetch_live_tail(database, start, end, None, None)[0]
        with database.connect() as conn:
            side_state = conn.execute(
                "SELECT provenance, rule_snapshot_kind "
                "FROM sync_classification_provenance WHERE segment_id = ?",
                (segment_id,),
            ).fetchone()
        print(json.dumps({
            "full": full,
            "compact": compact,
            "live": live,
            "remoteOutboxCount": len(database.get_sync_outbox(0, hot_grace_seconds=0)["items"]),
            "ownership": side_state["provenance"],
            "ruleSnapshotKind": side_state["rule_snapshot_kind"],
            "publicReviewKeys": sorted(review.keys()),
        }))
    finally:
        database.close()
        origin.close()
`;
  const child = spawnSync(process.env.PYTHON ?? "python3", ["-c", source], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: trackerRoot,
    },
    timeout: 10_000,
  });
  expect(child.error?.message, "production tracker receiver must finish").toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as ReceiverDtos;
}

describe("synced rule review/Revert boundary", () => {
  it.each(["user", "automatic"] as const)("restores %s rule snapshots through real outbox DTOs and UI consumers without inventing authorship", (ruleKind) => {
    const received = productionReceiverDtos(ruleKind);

    for (const dto of [received.full, received.compact, received.live]) {
      expect(dto.classification).toMatchObject({
        category: "entertainment",
        productivity: "drift",
        source: "rule",
        ruleSnapshotKind: "synced-rule",
      });
      expect(dto.classification?.classificationRuleId ?? null).toBeNull();
    }
    expect(received.remoteOutboxCount).toBe(0);
    expect(received.ownership).toBe("local-protected");
    expect(received.ruleSnapshotKind).toBe("synced-rule");
    expect(received.publicReviewKeys).toEqual([
      "confidence", "createdAt", "id", "newCategory", "newProductivity", "passId",
      "prevCategory", "prevProductivity", "prevSource", "reason", "revertedAt", "segmentId",
    ]);
    expect(classifyActivityDetailed(received.full)).toMatchObject({
      category: "entertainment",
      productivity: "drift",
      source: "rule",
    });

    // Category-wide defaults cannot disambiguate origin rule authorship.
    // Preserve the received result, while an explicit receiver rule still wins.
    expect(classifyActivityDetailed(received.full, {
      categoryProductivity: { entertainment: "focus" },
    })).toMatchObject({ category: "entertainment", productivity: "drift", source: "rule" });
    expect(classifyActivityDetailed(received.full, {
      categoryProductivity: { learning: "drift" },
      rules: [{ targetKind: "app", targetValue: "Code", category: "learning", productivity: "focus" }],
    })).toMatchObject({ category: "learning", productivity: "focus", source: "rule" });

    const materialized = materializeBuiltInHeuristicClassifications({
      classifiedAt: "2026-07-06T09:05:00+00:00",
      classificationOptions: { rules: [] },
      segments: [received.full],
    });
    expect(materialized.classifications).toEqual([]);
    expect(materialized.segments[0].classification?.source).toBe("rule");
    expect(hasClassifiedDashboardResult([received.compact], {})).toBe(true);
  });
});
