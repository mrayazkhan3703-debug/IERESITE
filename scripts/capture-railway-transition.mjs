// One-time migration safeguard using the current service's existing configuration.
// No R2 credentials or private recovery identity are transmitted to Railway.
import { mkdtemp, readFile, open, rm, realpath, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { captureHosted, hostedTool } from "./backup-hosted.mjs";
import { hashFile } from "./backup-adapter.mjs";

const [recipientFile, destination] = process.argv.slice(2);
let scratch;
async function run() {
  if (!isAbsolute(recipientFile ?? "") || !isAbsolute(destination ?? "") || !destination.endsWith(".tar.gz.age")) throw new Error("INVALID_PATH");
  const recipientInfo = await lstat(recipientFile);
  if (!recipientInfo.isFile() || recipientInfo.isSymbolicLink() || recipientInfo.size < 1 || recipientInfo.size > 4096) throw new Error("INVALID_RECIPIENT_FILE");
  for (const path of [destination, `${destination}.receipt.json`]) {
    try { await lstat(path); throw new Error("OUTPUT_ALREADY_EXISTS"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const recipients = (await readFile(recipientFile, "utf8")).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith("#"));
  if (recipients.length !== 1 || !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipients[0])) throw new Error("PUBLIC_RECIPIENT_REQUIRED");
  scratch = await mkdtemp(resolve(tmpdir(), "iere-transition-capture-"));
  const directory = resolve(scratch, "capture");
  const source = { format: 1, sourceId: "railway-main", databaseTransport: "railway-private", databaseUrl: process.env.DATABASE_URL,
    mediaProfile: "railway-temporary-seaweed", endpoint: "https://media-production-51c3.up.railway.app", bucket: process.env.S3_BUCKET,
    keyPrefix: process.env.S3_KEY_PREFIX ?? "", accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY };
  const manifest = await captureHosted({ source, directory, staticRoot: "/app/public" });
  const archive = resolve(scratch, "capture.tar.gz");
  await hostedTool("tar", ["-czf", archive, "-C", directory, "database.dump", "object-storage.tar.gz", "manifest.json"]);
  const output = await open(destination, "wx", 0o600);
  try {
    await new Promise((done, reject) => {
      const child = spawn("age", ["--encrypt", "--recipient", recipients[0], archive], { shell: false, stdio: ["ignore", output.fd, "ignore"] });
      const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
      child.once("error", () => { clearTimeout(timer); reject(new Error("ENCRYPTION_FAILED")); });
      child.once("close", code => { clearTimeout(timer); if (code === 0) done(); else reject(new Error("ENCRYPTION_FAILED")); });
    });
  } finally { await output.close(); }
  const receipt = { status: "PASS_ENCRYPTED_TRANSITION_CAPTURE", sourceId: manifest.sourceId, source: manifest.source,
    mediaProfile: manifest.mediaProfile, syntheticFixture: false, completedAtUtc: manifest.completedAtUtc,
    objectCount: manifest.objectStorage.objectCount,
    ciphertext: await hashFile(destination), restoreDrill: "NOT_VERIFIED", independentSchedule: "NOT_ENABLED" };
  await writeFile(`${destination}.receipt.json`, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(receipt));
}
run().catch(() => { console.error('{"status":"FAILED_TRANSITION_CAPTURE","details":"redacted"}'); process.exitCode = 1; }).finally(async () => {
  if (!scratch) return;
  const actual = await realpath(scratch), distance = relative(await realpath(tmpdir()), actual);
  if (isAbsolute(distance) || distance.startsWith("..") || !distance.startsWith("iere-transition-capture-") || distance.includes("/") || distance.includes("\\")) throw new Error("UNSAFE_CLEANUP");
  await rm(actual, { recursive: true, force: true });
});
