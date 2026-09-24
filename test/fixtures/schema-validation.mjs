import assert from "node:assert/strict";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

// Runtime separately verifies date/URI formats and semantic/digest authority.
// This check exercises the published structural contract, not only JSON parse.
let validator;
export function assertPublishedSchema(name, value) {
  if (!validator) {
    validator = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
    const directory = new URL("../../schemas/", import.meta.url);
    const bases = ["https://killsloprouter.dev/schemas/",
      "https://github.com/devpnko/kill-aislop-router/schemas/"];
    for (const file of fs.readdirSync(directory).filter((item) => item.endsWith(".schema.json"))) {
      const schema = JSON.parse(fs.readFileSync(new URL(file, directory), "utf8"));
      validator.addSchema(schema);
      // Published generations use two $id bases. Resolve either relative URI
      // to the same local filename. Copy the root URI only so fragment refs
      // still find $defs; all validation constraints remain unchanged.
      for (const base of bases) {
        const alias = `${base}${file}`;
        if (alias !== schema.$id) validator.addSchema({ ...schema, $id: alias });
      }
    }
  }
  const validate = validator.getSchema(`https://killsloprouter.dev/schemas/${name}.schema.json`);
  assert.ok(validate, `schema is unavailable: ${name}`);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}
