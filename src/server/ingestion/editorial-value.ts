/** Only persisted CMS overrides can replace incoming source facts, including explicit null/false/zero. */
export function editorialValue<T>(overrides: Record<string, unknown>, field: string, sourceValue: T): T {
  return Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] as T : sourceValue;
}
