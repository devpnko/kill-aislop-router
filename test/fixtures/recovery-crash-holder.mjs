import { recoverAutomationStateLease } from "../../src/automation.mjs";

const [
  statePath,
  ownerToken,
  acquiredAt,
  stateDigest,
  authorityDigest,
  crashCheckpoint = "after-recovery-claim"
] = process.argv.slice(2);
if (![statePath, ownerToken, acquiredAt, stateDigest, authorityDigest].every(Boolean)) {
  throw new Error("recovery crash fixture requires state, lease tuple, and resume authority");
}

recoverAutomationStateLease(statePath, {
  ownerToken,
  acquiredAt,
  stateDigest,
  authorityDigest,
  faultInjector(checkpoint) {
    if (checkpoint === crashCheckpoint) process.exit(91);
  }
});

throw new Error("recovery crash fixture unexpectedly completed");
