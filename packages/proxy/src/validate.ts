import AjvModule from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { FederatedIndex } from './downstream.js';

const Ajv = AjvModule as unknown as typeof AjvModule.default;
const ajv = new Ajv({ allErrors: true, strict: false });

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

function isEmptySchema(schema: unknown): boolean {
  if (schema === undefined || schema === null) return true;
  if (typeof schema !== 'object') return false;
  const keys = Object.keys(schema as object);
  return keys.length === 0;
}

function formatErrors(validate: ValidateFunction): string[] {
  const errors = validate.errors ?? [];
  if (errors.length === 0) return ['arguments do not match inputSchema'];
  return errors.map((e) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message ?? 'invalid'}`;
  });
}

/** Compile and cache a JSON Schema validator for a tool. */
export function getSchemaValidator(index: FederatedIndex, toolName: string, inputSchema: unknown): ValidateFunction | undefined {
  if (isEmptySchema(inputSchema)) return undefined;
  let cache = index.schemaValidators;
  if (cache === undefined) {
    cache = new Map();
    (index as { schemaValidators?: Map<string, ValidateFunction> }).schemaValidators = cache;
  }
  const existing = cache.get(toolName);
  if (existing !== undefined) return existing;
  try {
    const validate = ajv.compile(inputSchema as object);
    cache.set(toolName, validate);
    return validate;
  } catch {
    return undefined;
  }
}

/** Validate call_tool arguments against a downstream inputSchema. */
export function validateToolArguments(
  index: FederatedIndex,
  toolName: string,
  args: Record<string, unknown>,
  inputSchema: unknown | undefined,
): ValidationResult {
  if (isEmptySchema(inputSchema)) return { ok: true };
  const validate = getSchemaValidator(index, toolName, inputSchema);
  if (validate === undefined) return { ok: true };
  const valid = validate(args);
  if (valid) return { ok: true };
  return { ok: false, errors: formatErrors(validate) };
}
