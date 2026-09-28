// Starts the fake Sync Gateway on FAKE_SG_PORT with a few seeded documents, for
// driving a real dashboard server by hand or from the end-to-end test.
import { FakeSyncGateway } from "./fake-sync-gateway.ts";

const gateway = new FakeSyncGateway();
const url = await gateway.start(Number(process.env.FAKE_SG_PORT || 0));
gateway.put("aggregate_610", { type: "aggregate_data", team: 610, data: { standing: 1, matchesPlayed: 3, autoPPG: 12, teleopPPG: 30, endgamePPG: 10, fuelscored: 20 } });
gateway.put("aggregate_254", { type: "aggregate_data", team: 254, data: { standing: 2, matchesPlayed: 3, autoPPG: 10, teleopPPG: 25, endgamePPG: 8, fuelscored: 18 } });
gateway.put("pit_610", { type: "pit", team: 610, data: { teamName: "Crescent Coyotes", drivetrainType: "swerve" } });
gateway.put("scouting_610_1", { type: "scouting_data", team: 610, match: 1, data: { start: { match: 1, alliance: "red", position: "r1" }, teleop: { fuelscored: 11 } } });
console.log(`FAKE_SYNC_GATEWAY_URL=${new URL(url).origin}`);
