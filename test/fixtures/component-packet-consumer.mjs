// A fresh packet-only child. No KSR module, schema file, template or project
// directory is read here. Ajv is a test-only dependency, not a runtime adapter.
import Ajv2020 from "ajv/dist/2020.js";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { contract, specimen } = JSON.parse(input);
if (JSON.stringify(contract.schema).includes('"$ref"')) throw new Error("unresolved packet schema");
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(contract.schema);
process.stdout.write(JSON.stringify({ valid: validate(specimen), errors: validate.errors }));
