const fields = [
  'id', 'kind', 'command', 'args', 'cwd', 'expected', 'assertion', 'assertionIssue', 'expectedExitCode',
  'input', 'steps', 'closeInput', 'timeoutMs', 'target', 'inputs', 'outputs', 'level', 'dependsOn',
  'requiredCapabilities', 'requirementIds', 'requirementId', 'constraintIds', 'conformance', 'acceptance',
  'capability', 'provider', 'productInputs', 'providerCommand', 'providerInputs', 'artifacts',
] as const;

/** A transport envelope can move explicit fields, never supply a missing
 * executable, reinterpret a predicate, or turn a declaration into evidence. */
export function verificationDeclaration(value: Record<string, unknown>): Record<string, unknown> {
  const recipe = value.recipe;
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return { ...value };
  const nested = recipe as Record<string, unknown>, result = { ...value };
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field) && Object.prototype.hasOwnProperty.call(nested, field)) result[field] = nested[field];
  return result;
}
