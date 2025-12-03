import { createPrecompiledValidator } from "@rjsf/validator-ajv8";
import type { ValidatorFunctions } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema, ValidatorType } from "@rjsf/utils";
import * as contractSpec from "../generated/contractSpecValidator";
import * as protocolSpec from "../generated/protocolSpecValidator";

export const CONTRACT_SCHEMA_ID = "contractSpec";
export const PROTOCOL_SCHEMA_ID = "protocolSpec";

type ValidatorMap = Record<string, ValidatorType<any>>;

const validatorMap: ValidatorMap = {
  [CONTRACT_SCHEMA_ID]: createPrecompiledValidator(
    contractSpec.validateFns as ValidatorFunctions,
    contractSpec.rootSchema as any
  ),
  [PROTOCOL_SCHEMA_ID]: createPrecompiledValidator(
    protocolSpec.validateFns as ValidatorFunctions,
    protocolSpec.rootSchema as any
  ),
};

export function getValidatorForSchema(schemaId: string | undefined): ValidatorType<any> | undefined {
  if (!schemaId) {
    return undefined;
  }
  return validatorMap[schemaId];
}

export function validateWithPrecompiledValidator(
  formData: unknown,
  schemaForUi: RJSFSchema | undefined,
  baseSchema: RJSFSchema | undefined,
  uiSchema?: UiSchema
) {
  const schemaId = (schemaForUi ?? baseSchema)?.$id as string | undefined;
  if (!schemaId || !baseSchema) {
    return undefined;
  }
  const validator = getValidatorForSchema(schemaId);
  if (!validator) {
    return undefined;
  }
  return validator.validateFormData(formData as any, baseSchema as any, undefined, undefined, uiSchema);
}
