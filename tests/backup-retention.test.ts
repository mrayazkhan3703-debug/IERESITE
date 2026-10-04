import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { BACKUP_RETENTION_NAMESPACES, retainedBackupIds, runBackupRetention } from "../scripts/backup-retention.mjs";

const now = Date.parse("2026-10-04T12:00:00Z"), hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
const config = { bucket: "fixture-backups", maxStoredBytes: 1073741824 };
type ObjectRow = { body: Buffer; date: Date; etag: string };
function fixture() {
  const objects = new Map<string,ObjectRow>(), deleted: string[] = [], commands: string[] = [], active: string[] = [];
  let interruptAt = 0, deletes = 0, changeHead = false, headPrecision = false, headOffset = 0;
  const put = (key: string, body: Buffer, date = new Date(now - 1000)) => objects.set(key, { body, date, etag: `"${hash(body)}"` });
  const add = (prefix: string, id: string, time: number) => {
    const members = ["database.dump", "object-storage.tar.gz", "manifest.json"].map(file => {
      const body=Buffer.from("encrypted-fixture:"+id+file), key=`${prefix}/${id}/${file}.age`;put(key,body,new Date(time));
      return { file:file+".age", key, bytes:body.length, sha256:hash(body) };
    });
    const receipt={format:1,runId:id,status:"VERIFIED_CIPHERTEXT_ONLY",createdAtUtc:new Date(time).toISOString(),verifiedAtUtc:new Date(time+100).toISOString(),recipientFingerprint:"a".repeat(64),objects:members};
    put(`${prefix}/${id}/receipt.json`,Buffer.from(JSON.stringify(receipt)),new Date(time)); return receipt;
  };
  for (const [prefix,pin] of Object.entries(BACKUP_RETENTION_NAMESPACES)) {
    add(prefix,pin,now-14*86400000);
    for (let i=1;i<=4;i++) add(prefix,String(i).repeat(32),now-i*1800000);
    add(prefix,"5".repeat(32),now-4*86400000); // daily point retained
    add(prefix,"6".repeat(32),now-10*86400000); // obsolete
    put(prefix+"/latest.json",Buffer.from(JSON.stringify(add(prefix,"1".repeat(32),now-1800000))));
  }
  put("company-media/owner-photo.jpg",Buffer.from("do not delete"));
  const missing = () => { throw Object.assign(new Error("missing"),{$metadata:{httpStatusCode:404}}); };
  const store = { send: async (command: {constructor:{name:string};input:Record<string,unknown>}) => {
    const input=command.input, name=command.constructor.name; commands.push(name+":"+String(input.Key??input.Prefix));
    if(name==="ListObjectsV2Command")return {Contents:[...objects.entries()].filter(([key])=>key.startsWith(String(input.Prefix))).map(([Key,row])=>({Key,Size:row.body.length,ETag:row.etag,LastModified:row.date})),IsTruncated:false};
    if(name==="ListMultipartUploadsCommand")return {Uploads:active.filter(Key=>Key.startsWith(String(input.Prefix))).map(Key=>({Key})),IsTruncated:false};
    if(name==="PutObjectCommand"){put(String(input.Key),Buffer.from(input.Body as Uint8Array));return {};}
    const row=objects.get(String(input.Key));if(!row)return missing();
    if(name==="GetObjectCommand")return {Body:Readable.from([row.body]),ContentLength:row.body.length,ETag:row.etag};
    if(name==="HeadObjectCommand")return {ContentLength:row.body.length,ETag:changeHead?"changed":row.etag,LastModified:new Date((headPrecision?Math.floor(row.date.getTime()/1000)*1000:row.date.getTime())+headOffset)};
    if(name==="DeleteObjectCommand"){
      expect(input.IfMatch).toBe(row.etag);if(++deletes===interruptAt)throw Error("interrupted");
      objects.delete(String(input.Key));deleted.push(String(input.Key));return {};
    }throw Error("unexpected command");
  }};
  return {store,objects,deleted,commands,active,put,add,interrupt:(at:number)=>{interruptAt=at;},changed:()=>{changeHead=true;},r2Headers:(offset=0)=>{headPrecision=true;headOffset=offset;}};
}

test("R2 millisecond listings match second-precision HTTP headers; changed seconds abort",async()=>{
  const f=fixture();for(const row of f.objects.values())row.date=new Date(row.date.getTime()+454);f.r2Headers();
  expect((await runBackupRetention({store:f.store,config,now,apply:true,lockHeld:true})).removedRuns).toBe(2);
  const g=fixture();g.r2Headers(1000);await expect(runBackupRetention({store:g.store,config,now,apply:true,lockHeld:true})).rejects.toThrow();expect(g.deleted).toHaveLength(0);
});

test("retention keeps four recent, seven UTC daily representatives and pinned/pointer points",()=>{
  const captures=Array.from({length:12},(_,i)=>({runId:String(i),receipt:{createdAtUtc:new Date(now-i*86400000).toISOString()}}));
  const keep=retainedBackupIds(captures,"11","10",now);
  expect([...keep.keys()].sort()).toEqual(["0","1","10","11","2","3","4","5","6"]);
});
test("preview never writes or deletes, apply requires a lock",async()=>{
  const f=fixture(),result=await runBackupRetention({store:f.store,config,now});
  expect(result.manifest.namespaces.every(ns=>ns.remove.length===1)).toBe(true);
  expect(f.commands.some(c=>c.startsWith("PutObject")||c.startsWith("DeleteObject"))).toBe(false);
  await expect(runBackupRetention({store:f.store,config,now,apply:true})).rejects.toThrow("RETENTION_LOCK_REQUIRED");
});
test("authorized cleanup preserves pinned/daily/current/foreign objects and deletes receipts last",async()=>{
  const f=fixture(),result=await runBackupRetention({store:f.store,config,now,apply:true,lockHeld:true});
  expect(result.removedRuns).toBe(2);expect(result.removedBytes).toBeGreaterThan(0);
  for(const [prefix,pin] of Object.entries(BACKUP_RETENTION_NAMESPACES)){
    const deleted=f.deleted.filter(key=>key.startsWith(prefix+"/"));expect(deleted).toHaveLength(4);expect(deleted.at(-1)).toEndWith("/receipt.json");
    expect(f.objects.has(prefix+"/latest.json")).toBe(true);expect(f.objects.has(prefix+"/"+pin+"/receipt.json")).toBe(true);
  }
  expect(f.objects.has("company-media/owner-photo.jpg")).toBe(true);
});
test("missing baseline and tampered retained ciphertext prevent all deletion",async()=>{
  for(const fault of ["missing","tampered"]){const f=fixture(),prefix="live-backups/railway-main",pin=BACKUP_RETENTION_NAMESPACES[prefix];
    if(fault==="missing")f.objects.delete(`${prefix}/${pin}/receipt.json`);else f.put(`${prefix}/${pin}/database.dump.age`,Buffer.from("bad"));
    await expect(runBackupRetention({store:f.store,config,now,apply:true,lockHeld:true})).rejects.toThrow();expect(f.deleted).toHaveLength(0);
  }
});
test("changed metadata aborts and malformed/unknown archives are never removed",async()=>{
  const f=fixture();f.changed();await expect(runBackupRetention({store:f.store,config,now,apply:true,lockHeld:true})).rejects.toThrow();expect(f.deleted).toHaveLength(0);
  const g=fixture(),prefix="live-backups/railway-main",old="6".repeat(32);
  g.put(`${prefix}/${old}/receipt.json`,Buffer.from("malformed"));g.put(`private/iere-live/${old}/nested/unknown.txt`,Buffer.from("unknown"));
  const result=await runBackupRetention({store:g.store,config,now,apply:true,lockHeld:true});expect(result.removedRuns).toBe(0);
});
test("interrupted deletion resumes behind four intact newer recoveries",async()=>{
  const f=fixture();f.interrupt(2);await expect(runBackupRetention({store:f.store,config,now,apply:true,lockHeld:true})).rejects.toThrow("interrupted");
  expect(f.deleted).toHaveLength(1);f.interrupt(0);const result=await runBackupRetention({store:f.store,config,now,apply:true,lockHeld:true});
  expect(result.removedRuns).toBe(2);expect(f.deleted).toHaveLength(8);
});
test("incomplete captures require 24 hours and active multipart uploads are protected",async()=>{
  const f=fixture(),prefix="live-backups/railway-main",stale="7".repeat(32),fresh="8".repeat(32),active="9".repeat(32);
  f.put(`${prefix}/${stale}/database.dump.age`,Buffer.from("stale"),new Date(now-86400001));
  f.put(`${prefix}/${fresh}/database.dump.age`,Buffer.from("fresh"),new Date(now-10000));
  f.put(`${prefix}/${active}/database.dump.age`,Buffer.from("active"),new Date(now-86400001));f.active.push(`${prefix}/${active}/object-storage.tar.gz.age`);
  await runBackupRetention({store:f.store,config,now,apply:true,lockHeld:true});expect(f.objects.has(`${prefix}/${stale}/database.dump.age`)).toBe(false);
  expect(f.objects.has(`${prefix}/${fresh}/database.dump.age`)).toBe(true);expect(f.objects.has(`${prefix}/${active}/database.dump.age`)).toBe(true);
});
