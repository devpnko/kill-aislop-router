// Public state-lease primitives intentionally exclude stale-lease claiming.
// Recovery authority is verified only by recoverAutomationStateLease in
// ./automation; exposing the internal claim primitive would bypass that gate.
export {
  ABSENT_STATE_DIGEST,
  STATE_LEASE_VERSION,
  acquireStateLease,
  commitStateLeaseWrite,
  inspectStateLease,
  markStateLeaseChildExecution,
  prepareStateLeaseWrite,
  processStartIdentity,
  releaseStateLease,
  stateLeaseDirectory
} from "./state-lease.mjs";
