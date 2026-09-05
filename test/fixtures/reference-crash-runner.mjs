import { loadHostManifest } from "../../src/execution.mjs";
import {
  recoverReferenceStateLease,
  startReferenceIntelligence
} from "../../src/reference.mjs";

const [
  briefPath,
  statePath,
  hostPath,
  root,
  crashPoint = "before-spawn",
  ownerToken,
  acquiredAt,
  stateDigest
] = process.argv.slice(2);

if (["recovery-complete", "recovery-checkpoint"].includes(crashPoint)) {
  recoverReferenceStateLease(statePath, {
    ownerToken,
    acquiredAt,
    stateDigest,
    faultInjector(point) {
      if (crashPoint === "recovery-complete" &&
        point === "after-recovery-complete-before-state-write") process.exit(77);
      if (point === "after-state-write-before-lease-commit") process.exit(75);
    }
  });
  process.exit(76);
}

startReferenceIntelligence({
  briefPath,
  statePath,
  hostManifest: loadHostManifest(hostPath),
  root,
  faultInjector(point, details) {
    if (crashPoint === "before-spawn" && point === "after-child-lease-before-spawn") {
      process.exit(73);
    }
    if (crashPoint === "post-child-checkpoint" &&
      point === "after-state-write-before-lease-commit" &&
      details.attempt_count > 0 && details.in_flight === null) {
      process.exit(74);
    }
  }
});
