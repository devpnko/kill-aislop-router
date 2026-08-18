import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.argv[2]);
const files = [];

function walk(current) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) walk(absolute);
    if (entry.isFile()) files.push(absolute);
  }
}

walk(target);
const hit = files.find((file) => fs.readFileSync(file, "utf8").includes("SCANNER_FINDING"));
const findings = hit ? [{
  id: "fixture-scanner",
  group: "fixture",
  name: "Fixture scanner candidate",
  fix: "Classify the candidate with project evidence",
  hits: [{
    file: path.relative(target, hit),
    line: 1,
    text: "SCANNER_FINDING"
  }]
}] : [];

process.stdout.write(JSON.stringify({
  filesScanned: files.length,
  groups: findings.length,
  hits: findings.length,
  findings
}));
