import fs from "node:fs";
import { startAutomation } from "../../src/automation.mjs";
import { readJson } from "../../src/router.mjs";

const [configurationPath, crashCheckpoint = "after-initial-state-write"] = process.argv.slice(2);
if (!configurationPath) {
  throw new Error("start crash fixture requires a configuration file");
}

const configuration = JSON.parse(fs.readFileSync(configurationPath, "utf8"));
startAutomation({
  ...configuration,
  router: readJson(configuration.routerPath, "start crash router"),
  profile: configuration.profilePath
    ? readJson(configuration.profilePath, "start crash profile")
    : null,
  faultInjector(checkpoint) {
    if (checkpoint === crashCheckpoint) process.exit(92);
  }
});

throw new Error("start crash fixture unexpectedly completed");
