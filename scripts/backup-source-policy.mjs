const fail = code => { throw new Error(code); };

/** TLS is mandatory outside Railway's explicitly selected WireGuard private network. */
export function databaseTransport(source, fixture = false) {
  let url;
  try { url = new URL(source.databaseUrl); } catch { fail("INVALID_HOSTED_SOURCE"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      url.hash || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || (url.port && url.port !== "5432" && !fixture)) fail("INVALID_HOSTED_SOURCE");
  const transport = source.databaseTransport ?? "verified-tls";
  if (transport === "railway-private") {
    if (!/^[a-z0-9][a-z0-9-]*\.railway\.internal$/.test(url.hostname) ||
        ![null, "disable"].includes(url.searchParams.get("sslmode")) || source.caCertificate) fail("INVALID_PRIVATE_DATABASE");
    return { url, sslmode: "disable", tls: false };
  }
  if (transport !== "verified-tls") fail("INVALID_DATABASE_TRANSPORT");
  if (!fixture && (url.searchParams.get("sslmode") !== "verify-full" || typeof source.caCertificate !== "string" ||
      source.caCertificate.length > 16384 || !/^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\s*$/.test(source.caCertificate))) fail("SOURCE_CA_REQUIRED");
  return { url, sslmode: fixture ? "disable" : "verify-full", tls: fixture ? false : { ca: source.caCertificate, rejectUnauthorized: true } };
}

export function objectNamespace(prefix = "", key) {
  if (typeof prefix !== "string" || prefix.length > 160 || (prefix && !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)) ||
      typeof key !== "string" || !key || key.startsWith("/") || key.includes("\\") || key.split("/").some(part => !part || part === "." || part === "..")) fail("INVALID_OBJECT_NAMESPACE");
  return prefix ? `${prefix}/${key}` : key;
}

export function staticMediaKey(key) {
  return typeof key === "string" && /^static\/images\/[A-Za-z0-9._/-]+\.(?:jpg|jpeg|png|webp|avif)$/i.test(key) &&
    !key.split("/").some(part => !part || part === "." || part === "..");
}
