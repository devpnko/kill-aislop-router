import {
  acquireStateLease,
  inspectStateLease
} from "../../src/state-lease.mjs";

const statePath = process.argv[2];
if (!statePath) throw new Error("lease crash fixture requires a state path");

acquireStateLease({ statePath, operation: "fixture-crash" });
process.stdout.write(`${JSON.stringify(inspectStateLease(statePath))}\n`);
