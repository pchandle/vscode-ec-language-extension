import assert from "assert";
import fs from "fs";
import path from "path";
import {
  CONTRACT_SCHEMA_ID,
  PROTOCOL_SCHEMA_ID,
  getValidatorForSchema,
  validateWithPrecompiledValidator,
} from "../webview-src/validation/validatorMap";

const contractSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "../media/contractSpec.schema.json"), "utf8"));
const protocolSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "../media/protocolSpec.schema.json"), "utf8"));

function expectValid(schemaId: string, formData: unknown, schema: unknown) {
  const validator = getValidatorForSchema(schemaId);
  assert(validator, `Validator missing for schema ${schemaId}`);
  const result = validator.validateFormData(formData, schema as any);
  assert.strictEqual(result.errors?.length ?? 0, 0, `Expected no errors for ${schemaId}, got ${JSON.stringify(result.errors)}`);
}

function expectInvalid(schemaId: string, formData: unknown, schema: unknown) {
  const validator = getValidatorForSchema(schemaId);
  assert(validator, `Validator missing for schema ${schemaId}`);
  const result = validator.validateFormData(formData, schema as any);
  assert((result.errors?.length ?? 0) > 0, `Expected errors for ${schemaId}`);
}

function run() {
  expectValid(
    CONTRACT_SCHEMA_ID,
    {
      type: "supplier",
      name: "/layer/verb/subject/variation/platform",
      description: "contract description",
      requirements: [],
      obligations: [],
      supplier: "aptissio",
    },
    contractSchema
  );

  expectInvalid(CONTRACT_SCHEMA_ID, {}, contractSchema);

  expectValid(
    PROTOCOL_SCHEMA_ID,
    {
      type: "protocol",
      policy: 0,
      name: "/layer/subject/variation/platform",
      description: "protocol description",
      host: { macro: "host-macro", requirements: [], obligations: [] },
      join: { macro: "join-macro", requirements: [], obligations: [] },
    },
    protocolSchema
  );

  expectInvalid(PROTOCOL_SCHEMA_ID, { type: "protocol" }, protocolSchema);

  // Regression: enhanced schemas used for the UI should still validate against the base schema
  const enhancedContractSchema = JSON.parse(JSON.stringify(contractSchema));
  enhancedContractSchema.$defs.requirement.title = "ui-only label";
  enhancedContractSchema.$defs.requirement.allOf = [{ if: { properties: { type: { const: "string" } } }, then: {} }];
  delete enhancedContractSchema.$defs.requirement.oneOf;

  const contractValidator = getValidatorForSchema(CONTRACT_SCHEMA_ID);
  assert(contractValidator, "Validator missing for contract schema");
  assert.throws(
    () => contractValidator!.validateFormData({}, enhancedContractSchema),
    /differs from the rootSchema/,
    "Enhanced schema should not be passed directly to precompiled validator"
  );

  const validContract = {
    type: "supplier",
    name: "/layer/verb/subject/variation/platform",
    description: "contract description",
    requirements: [],
    obligations: [],
    supplier: "aptissio",
  };

  const wrappedResult = validateWithPrecompiledValidator(validContract, enhancedContractSchema as any, contractSchema as any);
  assert(wrappedResult, "Wrapped validation should return a result");
  assert.strictEqual(wrappedResult.errors?.length ?? 0, 0, "Wrapped validation should succeed with base schema");
}

run();
