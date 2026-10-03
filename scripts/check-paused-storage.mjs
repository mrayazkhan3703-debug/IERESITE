import { db } from '../src/lib/db.ts';
import { createSession } from '../src/server/auth.ts';
import { requireDisposableEnvironment } from '../tests/disposable-environment.ts';
requireDisposableEnvironment(process.env);
if(process.env.STORAGE_MUTATIONS_PAUSED!=='true') throw new Error('Paused disposable web required');
const prefix=`storage-pause-${crypto.randomUUID()}`;
const userId=prefix, mediaId=`${prefix}-media`, email=`${prefix}@example.invalid`;
const checks=[];
for(let attempt=0;attempt<30;attempt++) {
 try { if((await fetch('http://localhost:3000/api/health')).ok) break; } catch {}
 if(attempt===29) throw new Error('Disposable paused server did not become ready');
 await new Promise(resolve=>setTimeout(resolve,1000));
}
try {
 const role=await db.role.findUniqueOrThrow({where:{key:'OWNER'}});
 await db.user.create({data:{id:userId,email,emailVerified:new Date(),roles:{create:{roleId:role.id}}}});
 const cookie=`ie_session=${await createSession(userId,{mfaVerified:true})}`;
 await db.mediaAsset.create({data:{id:mediaId,kind:'DOCUMENT',storageKey:`public/media/${mediaId}.pdf`,url:`/api/media/${mediaId}/content`,mimeType:'application/pdf',sizeBytes:12}});
 const mediaCount=await db.mediaAsset.count(), runCount=await db.importRun.count();
 const headers={Cookie:cookie,'x-requested-with':'fetch'};
 const form=new FormData();form.set('file',new File([], 'empty.jpg',{type:'image/jpeg'}));
 const upload=await fetch('http://localhost:3000/api/media',{method:'POST',headers,body:form});
 const uploadBody=await upload.json();checks.push({name:'upload-paused',pass:upload.status===503&&uploadBody.code==='STORAGE_MUTATIONS_PAUSED'});
 const deletion=await fetch('http://localhost:3000/api/media',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({mediaAssetIds:[mediaId]})});
 const deletionBody=await deletion.json();checks.push({name:'delete-paused-before-database-change',pass:deletion.status===503&&deletionBody.code==='STORAGE_MUTATIONS_PAUSED'&&Boolean(await db.mediaAsset.findUnique({where:{id:mediaId}}))});
 const source=JSON.stringify([{externalId:prefix,title:'Synthetic isolated storage pause',community:'Synthetic isolated community',priceAed:1000000}]);
 const imported=await fetch('http://localhost:3000/api/admin/imports',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':prefix},body:JSON.stringify({format:'json',data:JSON.parse(source),dryRun:true})});
 const importBody=await imported.json();checks.push({name:'private-import-snapshot-write-paused',pass:imported.status===503&&importBody.code==='STORAGE_MUTATIONS_PAUSED'&&await db.importRun.count()===runCount});
 const library=await fetch('http://localhost:3000/api/media?take=1',{headers:{Cookie:cookie}});checks.push({name:'library-read-available',pass:library.status===200});await library.arrayBuffer();
 const staticAsset=await db.mediaAsset.findFirstOrThrow({where:{storageKey:{startsWith:'static/images/'},isPrivate:false}});
 const image=await fetch(`http://localhost:3000/${staticAsset.storageKey.slice('static/'.length)}`);checks.push({name:'public-image-read-available',pass:image.status===200&&(await image.arrayBuffer()).byteLength>0});
 checks.push({name:'no-upload-record-created',pass:await db.mediaAsset.count()===mediaCount});
 console.log(JSON.stringify({status:checks.every(row=>row.pass)?'PASS_PAUSED_HTTP':'FAILED_PAUSED_HTTP',checks}));
 if(checks.some(row=>!row.pass)) process.exitCode=1;
} finally {
 await db.mediaAsset.deleteMany({where:{id:mediaId}});
 await db.user.deleteMany({where:{id:userId}});
 await db.$disconnect();
}
