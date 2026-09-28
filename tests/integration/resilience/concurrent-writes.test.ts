// Simultaneous submissions, updates, deletes, connections, and reconnects,
// checked against the persisted database and every connected client.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { RealtimeClient } from "../../../lib/realtime-client.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { startRealtimeHarness, type RealtimeHarness } from "../../helpers/realtime-harness.ts";
import { mapLimit, waitFor } from "../../helpers/wait.ts";

let target: GatewayTarget;
let realtime: RealtimeHarness;
before(async () => { target = await startGatewayTarget(); realtime = await startRealtimeHarness(target); });
after(async () => { await realtime.stop(); await target.stop(); });

const connectMany = async (count: number) => { const since = await target.lastSeq(); return Promise.all(Array.from({ length: count }, () => realtime.connected(since))); };
const closeAll = (clients: RealtimeClient[]) => clients.forEach((client) => client.disconnect());

test("duplicate submissions: two devices submitting the same match at once create exactly one record", async () => {
  const clients = await connectMany(3);
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, device) => target.write("scouting_700_1", { type: "scouting_data", data: { start: { match: 1 }, teleop: { fuelscored: device } } })));
  const winners = attempts.filter((attempt) => attempt.status === 201);
  assert.equal(winners.length, 1, `statuses: ${attempts.map((attempt) => attempt.status).join(",")}`);
  assert.ok(attempts.filter((attempt) => attempt.status !== 201).every((attempt) => attempt.status === 409), "the rest are conflicts");
  const persisted = await target.read("scouting_700_1");
  assert.equal(persisted?._rev, winners[0].rev);
  await waitFor(() => clients.every((client) => client.store.get("scouting_700_1")?.rev === winners[0].rev), "every client has the winning record");
  assert.deepEqual(clients.map((client) => [...client.store.values()].filter((doc) => doc.id === "scouting_700_1").length), [1, 1, 1]);
  closeAll(clients);
});

test("lost updates: concurrent read-modify-write increments with revision checks lose nothing", async () => {
  await target.upsert("pit_701", { type: "pit", data: { hopperCapacity: 0 } });
  const client = (await connectMany(1))[0];
  const increment = async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = (await target.read("pit_701"))!;
      const value = (current.data as { hopperCapacity: number }).hopperCapacity;
      const result = await target.write("pit_701", { type: "pit", data: { hopperCapacity: value + 1 } }, String(current._rev));
      if (result.status === 201) return;
      assert.equal(result.status, 409, "a lost race is reported as a conflict, never silently overwritten");
    }
    throw new Error("could not apply increment");
  };
  await Promise.all(Array.from({ length: 8 }, () => Promise.all(Array.from({ length: 5 }, increment))));
  const persisted = (await target.read("pit_701"))!;
  assert.equal((persisted.data as { hopperCapacity: number }).hopperCapacity, 40);
  await waitFor(() => client.store.get("pit_701")?.rev === persisted._rev, "client reaches the final revision");
  assert.equal((client.store.get("pit_701")?.doc?.data as { hopperCapacity: number }).hopperCapacity, 40);
  client.disconnect();
});

test("simultaneous submissions from many devices all persist and reach every client exactly once", async () => {
  const clients = await connectMany(5);
  const notifications = clients.map((client) => { let count = 0; client.subscribe(() => { count += 1; }); return () => count; });
  const ids = Array.from({ length: 60 }, (_, index) => `scouting_702_${index + 1}`);
  const revs = await mapLimit(ids, 24, (id, index) => target.upsert(id, { type: "scouting_data", data: { start: { match: index + 1 } } }));
  for (const [index, id] of ids.entries()) assert.equal((await target.read(id))?._rev, revs[index]);
  await waitFor(() => clients.every((client) => ids.every((id, index) => client.store.get(id)?.rev === revs[index])), "all records on all clients", 15_000);
  assert.deepEqual(notifications.map((count) => count()), [60, 60, 60, 60, 60]);
  closeAll(clients);
});

test("concurrent deletes: exactly one succeeds, and every client sees the record disappear", async () => {
  const rev = await target.upsert("report_703_Q1", { type: "report_card", data: { cardType: "Yellow" } });
  const clients = await connectMany(3);
  const results = await Promise.all(Array.from({ length: 6 }, () => target.remove("report_703_Q1", rev)));
  assert.equal(results.filter((result) => result.status === 200).length, 1, results.map((result) => result.status).join(","));
  assert.equal(await target.read("report_703_Q1"), null);
  await waitFor(() => clients.every((client) => client.store.get("report_703_Q1")?.deleted === true), "deletion everywhere");
  closeAll(clients);
});

test("update racing a delete: the database decides once, and clients agree with it", async () => {
  const rev = await target.upsert("pit_704", { type: "pit", data: { teamName: "Before" } });
  const clients = await connectMany(2);
  const [update, remove] = await Promise.all([target.write("pit_704", { type: "pit", data: { teamName: "After" } }, rev), target.remove("pit_704", rev)]);
  assert.equal([update.status, remove.status].filter((status) => status === 201 || status === 200).length, 1, "exactly one of the racing writes wins");
  const persisted = await target.read("pit_704");
  await waitFor(() => clients.every((client) => {
    const stored = client.store.get("pit_704");
    return persisted ? stored?.rev === persisted._rev && stored?.deleted === false : stored?.deleted === true;
  }), "clients match the database");
  closeAll(clients);
});

test("clients connecting and reconnecting during a write burst all converge on the database", async () => {
  const since = await target.lastSeq();
  const ids = Array.from({ length: 40 }, (_, index) => `scouting_705_${index + 1}`);
  const early = await Promise.all([1, 2].map(() => realtime.connected(since)));
  const writing = (async () => { for (const id of ids) await target.upsert(id, { type: "scouting_data", data: {} }); })();
  // More clients arrive mid-burst from the same page cursor, and connections drop.
  const late = await Promise.all([1, 2, 3].map(() => realtime.connected(since)));
  realtime.dropConnections();
  await writing;
  const expected = await Promise.all(ids.map(async (id) => (await target.read(id))!._rev));
  const all = [...early, ...late];
  await waitFor(() => all.every((client) => ids.every((id, index) => client.store.get(id)?.rev === expected[index])), "all clients converged", 15_000);
  closeAll(all);
});
