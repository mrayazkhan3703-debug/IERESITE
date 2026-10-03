/** Physical storage namespace; database keys and application URLs stay stable. */
export function namespacedObjectKey(prefix: string, key: string): string {
  if (prefix && !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error("Invalid storage namespace");
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some(part => part === "." || part === ".." || part === "")) throw new Error("Invalid object key");
  return prefix ? `${prefix}/${key}` : key;
}
