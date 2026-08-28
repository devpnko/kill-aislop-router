import { processStartIdentity } from "../../src/state-lease.mjs";

const pid = Number(process.argv[2]);
if (!Number.isInteger(pid) || pid < 1) {
  throw new Error("process identity probe requires a PID");
}

process.stdout.write(`${JSON.stringify(processStartIdentity(pid, {
  forcePosixPs: true
}))}\n`);
