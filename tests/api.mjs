// These tests use an isolated local D1 and synthetic accounts only.
// No production database or Cloudflare credentials are used.
for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) delete process.env[key];
import {createRequire} from 'node:module';
import {createHash,pbkdf2Sync} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const req=createRequire(import.meta.resolve('wrangler'));const {Miniflare}=await import(req.resolve('miniflare'));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.join(dir,x.name)]);}
// Verification uses synthetic secrets and an isolated D1, never production data.
const bindings={AUTH_SECRET:'test-only-garda-auth-secret-not-for-production',BOOTSTRAP_TOKEN:'test-only-garda-bootstrap-token'};
bindings.SITE_ORIGIN='https://garda.test';
const modules=walk('dist/suntdegarda').filter(x=>x.endsWith('.js')).sort((a,b)=>a==='dist/suntdegarda/index.js'?-1:b==='dist/suntdegarda/index.js'?1:a.localeCompare(b)).map(x=>({type:'ESModule',path:path.resolve(x)}));
const miniflareOptions={modules,modulesRoot:path.resolve('dist/suntdegarda'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',cf:false,d1Databases:{DB:'garda-qa'},bindings,assets:{directory:path.resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,static_routing:{user_worker:['/api/*']}},assetConfig:{not_found_handling:'single-page-application'}}};
const mf=new Miniflare(miniflareOptions);
const yearNumber=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Bucharest',year:'numeric'}).format(new Date()))+1;
const pastYear=yearNumber-2;
const cookies={};let checks=0;
async function call(actor,action,values={},status=200){const r=await mf.dispatchFetch('https://garda.test/api/garda',{method:'POST',headers:{'content-type':'application/json','X-Garda-Request':'1',Origin:'https://garda.test',...(cookies[actor]?{Cookie:cookies[actor]}:{})},body:JSON.stringify({action,...values})});const b=await r.json();assert.equal(r.status,status,`${action}: ${JSON.stringify(b)}`);const cookie=r.headers.get('set-cookie');if(cookie)cookies[actor]=cookie.split(';')[0];checks++;return b;}
async function state(actor,year=yearNumber){const r=await mf.dispatchFetch('https://garda.test/api/garda?year='+year,{headers:cookies[actor]?{Cookie:cookies[actor]}:{}});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));checks++;return b;}
async function preview(actor,month,status=200){const r=await mf.dispatchFetch('https://garda.test/api/garda?view=preview&month='+month,{headers:cookies[actor]?{Cookie:cookies[actor]}:{}});const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));checks++;return b;}
try{
 const database=await mf.getD1Database('DB');
 const firstState=await state('anon');assert.equal(firstState.doctors.length,9);assert.equal(firstState.doctors.filter(d=>d.administrator).length,1);assert.equal(firstState.doctors.find(d=>d.administrator).name,'Pecie Mihai');assert(firstState.doctors.every(d=>!d.registered&&!('email' in d)));const ownerId=firstState.doctors.find(d=>d.administrator).id;assert.equal(firstState.me,null);assert.equal(firstState.setupComplete,false);assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('users','months','settings','holidays','submissions','shifts','swaps','notifications','audit','sessions','resets','limits')").first()).n,12);await preview('anon',`${yearNumber}-11`,401);
 const badOrigin=await mf.dispatchFetch('https://garda.test/api/garda',{method:'POST',headers:{'content-type':'application/json','X-Garda-Request':'1',Origin:'https://attacker.test'},body:JSON.stringify({action:'login',email:'qa@test.example',password:'wrong'})});assert.equal(badOrigin.status,403);checks++;
 await call('anon','setup',{token:'wrong-bootstrap-token',doctor_id:ownerId,email:'pmihaidorin@gmail.com',password:'Verification123!'},403);
 await call('anon','setup',{token:bindings.BOOTSTRAP_TOKEN,doctor_id:ownerId,email:'intruder@qa.example',password:'Verification123!'},403);
 const initialIds=firstState.doctors.filter(d=>!d.administrator).map(d=>d.id);
 await call('anon','register',{doctor_id:initialIds[0],email:'a@qa.example',password:'Verification123!'},409);
 await call('admin','setup',{token:bindings.BOOTSTRAP_TOKEN,doctor_id:ownerId,email:'pmihaidorin@gmail.com',password:'Verification123!'});
 await call('anon','setup',{token:bindings.BOOTSTRAP_TOKEN,doctor_id:ownerId,email:'pmihaidorin@gmail.com',password:'Verification123!'},409);
 const admin=(await state('admin')).me;assert.equal(admin.role,'admin');assert.equal(admin.email,'pmihaidorin@gmail.com');
 const ids={admin:admin.id};
 for(const [i,actor] of ['a','b','c','d'].entries()){ids[actor]=initialIds[i];await call(actor,'register',{doctor_id:ids[actor],email:`${actor}@qa.example`,password:'Verification123!'});const signed=await state(actor);assert.equal(signed.me.id,ids[actor]);assert.equal(signed.me.role,'doctor');assert(!signed.pending);await call(actor,'month-open',{month:`${yearNumber}-11`,deadline:null},403);if(actor==='a')await preview(actor,`${yearNumber}-11`,403);await call('admin','user-update',{id:ids[actor],active:1,base_points:actor==='a'?40:actor==='b'?30:0});}
 await call('anon','register',{doctor_id:'invented-user',email:'invented@qa.example',name:'Fake Doctor',password:'Verification123!'},400);
 await call('anon','register',{doctor_id:initialIds[4],email:'pmihaidorin@gmail.com',password:'Verification123!'},403);
 await call('anon','register',{doctor_id:ownerId,email:'another@qa.example',password:'Verification123!'},403);
 await call('anon','register',{doctor_id:ids.a,email:'again@qa.example',password:'Verification123!'},409);
 await call('anon','register',{doctor_id:initialIds[4],email:'a@qa.example',password:'Verification123!'},409);
 await call('a','doctor-add',{name:'Not Allowed'},403);
 await call('a','reset-accounts',{confirmation:'RESETARE'},403);
 await call('admin','user-update',{id:ids.admin,active:0,base_points:0},400);
 await call('a','user-update',{id:admin.id,active:0,base_points:0},403);
 const unopened=await preview('admin',`${yearNumber}-10`);assert.equal(unopened.source,'empty');assert.equal(unopened.stats.covered,0);assert.equal(unopened.report.uncovered.length,31);await preview('admin',`${yearNumber}-99`,400);await preview('a',`${yearNumber}-11`);
 await call('admin','month-open',{month:`${yearNumber}-11`,deadline:null});const openEmpty=await preview('admin',`${yearNumber}-11`);assert.equal(openEmpty.source,'simulation');assert.equal(openEmpty.stats.covered,0);
 await call('a','submit',{month:`${yearNumber}-11`,preferred:[1,2],available:[2,3]},400);
 const actors=['admin','a','b','c','d'];
 for(let i=0;i<actors.length;i++){const preferred=Array.from({length:6},(_,n)=>i*6+n+1);const available=Array.from({length:30},(_,n)=>n+1).filter(d=>!preferred.includes(d));await call(actors[i],'submit',{month:`${yearNumber}-11`,preferred,available});if(i===0){const before=await state('admin');const partial=await preview('admin',`${yearNumber}-11`);assert.equal(partial.stats.covered,6);assert.equal(partial.report.uncovered.length,24);assert.equal(partial.stats.missingSubmissions.length,8);const repeated=await preview('admin',`${yearNumber}-11`);assert.deepEqual(repeated.shifts,partial.shifts);const after=await state('admin');assert.deepEqual(after.months,before.months);assert.deepEqual(after.shifts,before.shifts);assert.deepEqual(after.events,before.events);assert.deepEqual(after.users,before.users);}}
 const visible=await state('a');assert.equal(visible.submissions.length,1);assert(!visible.users.some(u=>u.email));
 const simulated=await preview('admin',`${yearNumber}-11`);assert.equal(simulated.stats.covered,30);assert.equal(simulated.stats.preferredHonored,30);assert.equal(simulated.report.uncovered.length,0);assert.equal(simulated.doctors.find(u=>u.id===ids.a).currentPoints,40);assert(simulated.doctors.find(u=>u.id===ids.a).projectedPoints>40);
 let m=(await state('admin')).months.find(m=>m.id===`${yearNumber}-11`);await call('admin','month-close',{month:m.id,version:m.version});
 await call('a','submit',{month:`${yearNumber}-11`,preferred:[1],available:[2]},409);
 m=(await state('admin')).months.find(m=>m.id===`${yearNumber}-11`);await call('admin','generate',{month:m.id,version:m.version});
 const draft=await state('admin');assert.equal(draft.shifts.length,30);assert.equal((await state('a')).shifts.length,0);const savedPreview=await preview('admin',`${yearNumber}-11`);assert.equal(savedPreview.source,'saved');assert.deepEqual(savedPreview.shifts,simulated.shifts);await database.prepare(`UPDATE shifts SET reason='Atribuire manuală QA' WHERE date='${yearNumber}-11-01'`).run();const manualPreview=await preview('admin',`${yearNumber}-11`);assert.equal(manualPreview.shifts.find(s=>s.date===`${yearNumber}-11-01`).reason,'Atribuire manuală QA');
 await call('admin','publish',{month:`${yearNumber}-11`,version:m.version},409);
 m=draft.months.find(m=>m.id===`${yearNumber}-11`);await call('admin','publish',{month:m.id,version:m.version});
 const published=await state('a');assert.equal(published.shifts.length,30);const from=published.shifts.find(s=>s.user_id===ids.a).date,to=published.shifts.find(s=>s.user_id===ids.b).date;
 await call('a','swap-request',{from,to});let swaps=(await state('b')).swaps;const swap=swaps[0];assert.equal(swap.status,'pending');assert((await state('b')).notifications.some(n=>n.message.includes('propone')||n.message.includes('propune')));
 await call('c','swap-answer',{id:swap.id,answer:'accept'},403);
 await call('b','swap-answer',{id:swap.id,answer:'accept'});const after=await state('b');assert.equal(after.shifts.find(s=>s.date===from).user_id,ids.b);assert.equal(after.shifts.find(s=>s.date===to).user_id,ids.a);const finalPreview=await preview('admin',`${yearNumber}-11`);assert.equal(finalPreview.source,'final');assert.deepEqual(finalPreview.shifts,after.shifts);assert.equal(finalPreview.shifts.find(s=>s.date===from).user_id,ids.b);
 await call('b','swap-answer',{id:swap.id,answer:'accept'},409);assert.equal((await state('a')).users.find(u=>u.id===ids.a).points,40);
 m=after.months.find(m=>m.id===`${yearNumber}-11`);await call('admin','complete',{month:m.id,version:m.version},400);
 await call('admin','month-open',{month:`${yearNumber}-12`,deadline:null});await call('admin','holiday',{date:`${yearNumber}-12-24`,label:'Ajun QA',enabled:1});await call('a','submit',{month:`${yearNumber}-12`,preferred:[25],available:[26]});m=(await state('admin')).months.find(m=>m.id===`${yearNumber}-12`);await call('admin','month-close',{month:m.id,version:m.version});m=(await state('admin')).months.find(m=>m.id===`${yearNumber}-12`);await call('admin','generate',{month:m.id,version:m.version});m=(await state('admin')).months.find(m=>m.id===`${yearNumber}-12`);await call('admin','publish',{month:m.id,version:m.version},400);
 // Seed a historical finalized month only in this isolated test database.
 await database.batch([database.prepare(`INSERT INTO months(id,status,version,report) VALUES('${pastYear}-09','published',0,'{}')`),database.prepare(`INSERT INTO shifts(date,month,user_id,points,reason,completed) VALUES('${pastYear}-09-01','${pastYear}-09',?,3,'QA',0)`).bind(ids.a)]);
 await call('admin','complete',{month:`${pastYear}-09`,version:0});assert.equal((await state('a')).users.find(u=>u.id===ids.a).points,43);const completedPreview=await preview('admin',`${pastYear}-09`);assert.equal(completedPreview.source,'final');assert.equal(completedPreview.doctors.find(u=>u.id===ids.a).monthPoints,3);assert.equal(completedPreview.doctors.find(u=>u.id===ids.a).projectedPoints,43);await call('admin','complete',{month:`${pastYear}-09`,version:1},400);assert.equal((await state('a')).users.find(u=>u.id===ids.a).points,43);
 const reset=await call('admin','admin-reset',{id:ids.a});const token=new URL(reset.link).searchParams.get('reset');await call('anon','reset',{token,password:'ChangedPassword123!'});assert.equal((await state('a')).me,null);await call('a','login',{doctor_id:ids.a,password:'ChangedPassword123!'});await call('anon','reset',{token,password:'ReplayPassword123!'},400);
 await call('a','password',{current:'WrongPassword',password:'NextPassword123!'},400);await call('a','password',{current:'ChangedPassword123!',password:'NextPassword123!'});await call('a','logout');assert.equal((await state('a')).me,null);
 await call('anon','forgot',{email:'a@qa.example'},503);
 await call('admin','month-open',{month:`${yearNumber+1}-01`,deadline:null});await call('a','login',{doctor_id:ids.a,password:'NextPassword123!'});assert.equal((await state('a')).suggestedMonth,`${yearNumber+1}-01`);checks++;const futurePreview=await preview('admin',`${yearNumber+1}-01`);assert.equal(futurePreview.stats.days,31);assert.equal(futurePreview.holidays[`${yearNumber+1}-01-01`],'Anul Nou');
 // Only the administrator adds roster entries; adding a profile does not create credentials.
 const added=await call('admin','doctor-add',{name:'Doctor Test'});assert(added.id);const newPublic=await state('anon');assert(newPublic.doctors.some(d=>d.id===added.id&&!d.registered));
 await call('admin','doctor-add',{name:'  doctor   TEST  '},409);
 await call('admin','admin-reset',{id:added.id},400);
 await call('admin','user-update',{id:ids.d,active:0,base_points:0});assert.equal((await state('d')).me,null);await call('d','login',{doctor_id:ids.d,password:'Verification123!'},401);assert(!(await state('anon')).doctors.some(d=>d.id===ids.d));await call('admin','user-update',{id:ids.d,active:1,base_points:0});
 // Reset every credential without deleting physician identities, schedules or points.
 const preserved={};for(const table of ['months','shifts','submissions','swaps'])preserved[table]=(await database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
 const beforePoints=(await state('admin')).users.map(u=>({id:u.id,points:u.points,base_points:u.base_points}));
 await call('admin','reset-accounts',{confirmation:'wrong'},400);
 const allReset=await call('admin','reset-accounts',{confirmation:'RESETARE'});assert.equal(new URL(allReset.link).origin,'https://garda.test');assert.equal((await state('admin')).me,null);assert.equal((await state('a')).me,null);assert.equal((await state('b')).me,null);
 for(const [table,rows]of Object.entries(preserved))assert.deepEqual((await database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,rows,table+' must survive account reset');
 const unclaimed=await state('anon');assert.equal(unclaimed.setupComplete,false);assert(unclaimed.doctors.every(d=>!d.registered));assert.equal((await database.prepare("SELECT COUNT(*) n FROM users WHERE password<>''").first()).n,0);assert.equal((await database.prepare('SELECT COUNT(*) n FROM sessions').first()).n,0);assert.equal((await database.prepare('SELECT COUNT(*) n FROM resets').first()).n,0);assert.equal((await database.prepare("SELECT COUNT(*) n FROM users WHERE email NOT LIKE '%@garda.invalid' AND email<>'pmihaidorin@gmail.com'").first()).n,0);
 await call('a','login',{doctor_id:ids.a,password:'NextPassword123!'},401);
 await call('anon','register',{doctor_id:ids.a,email:'fresh@qa.example',password:'FreshPassword123!'},409);
 const ownerToken=new URL(allReset.link).searchParams.get('setup');await call('admin','setup',{doctor_id:ids.admin,email:'pmihaidorin@gmail.com',password:'OwnerFreshPassword123!',token:ownerToken});assert.equal((await state('admin')).accountResetPending,false);assert.deepEqual((await state('admin')).users.map(u=>({id:u.id,points:u.points,base_points:u.base_points})),beforePoints);
 await call('anon','setup',{doctor_id:ids.admin,email:'pmihaidorin@gmail.com',password:'ReplayPassword123!',token:ownerToken},403);
 await call('a','register',{doctor_id:ids.a,email:'fresh@qa.example',password:'FreshPassword123!'});assert.equal((await state('a')).me.id,ids.a);assert.equal((await state('a')).users.find(u=>u.id===ids.a).points,43);
 const html=await mf.dispatchFetch('https://garda.test/');assert.equal(html.status,200);const markup=await html.text();assert(markup.includes('Garda'));checks++;
 console.log(`Passed ${checks} API checks: admin setup, roster registration, sole administrator, permissions, reset preserving schedules and points, roles, CSRF, enrollment, private drafts, generation, publishing, swaps, points once only, reset single use, session revocation HTML rendering and read-only monthly previews including manual changes, swaps and confirmed points.`);
 
}finally{await mf.dispose();}

// Upgrade a populated database without rebuilding physician identities or schedules.
const legacyOptions={...miniflareOptions,d1Databases:{DB:'garda-legacy-qa'}};
const legacy=new Miniflare(legacyOptions);
try{
 let database=await legacy.getD1Database('DB');
 const schema=fs.readFileSync('drizzle/0000_steady_toxin.sql','utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean);
 await database.batch(schema.map(sql=>database.prepare(sql)));
 const oldPassword='LegacyVerification123!',salt='synthetic-legacy-salt';
 const hash=`pbkdf2$100000$${salt}$${pbkdf2Sync(oldPassword+bindings.AUTH_SECRET,salt,100000,32,'sha256').toString('hex')}`;
 const sessionHash=t=>createHash('sha256').update(t).digest('hex');
 await database.batch([
  database.prepare("INSERT INTO users(id,email,name,password,role,active,base_points,created) VALUES('legacy-owner','pmihaidorin@gmail.com','Old Owner',?,'admin',1,9,'2020-01-01')").bind(hash),
  database.prepare("INSERT INTO users(id,email,name,password,role,active,base_points,created) VALUES('legacy-doctor','legacy-doctor@qa.example','  Mohammad  Al Marazgh ',?,'doctor',1,4,'2020-01-02')").bind(hash),
  database.prepare("INSERT INTO users(id,email,name,password,role,active,base_points,created) VALUES('legacy-other','legacy-other@qa.example','Legacy Other',?,'admin',1,8,'2020-01-03')").bind(hash),
  database.prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,'legacy-owner',?)").bind(sessionHash('synthetic-owner-session'),Date.now()+3600000),
  database.prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,'legacy-other',?)").bind(sessionHash('synthetic-other-session'),Date.now()+3600000),
  database.prepare("INSERT INTO months(id,status,version,report) VALUES(?,'completed',3,'{}')").bind(`${pastYear}-09`),
  database.prepare("INSERT INTO shifts(date,month,user_id,points,reason,completed) VALUES(?,?,'legacy-doctor',2,'Legacy QA',1)").bind(`${pastYear}-09-01`,`${pastYear}-09`),
  database.prepare("INSERT INTO submissions(id,month,user_id,preferred,available,updated) VALUES(?,?,'legacy-doctor','[1]','[2]','2020-01-02')").bind(`${pastYear}-09:legacy-doctor`,`${pastYear}-09`),
 ]);
 const preserved={};for(const table of ['months','shifts','submissions'])preserved[table]=(await database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
 async function legacyState(token){const r=await legacy.dispatchFetch(`https://garda.test/api/garda?year=${pastYear}`,{headers:token?{Cookie:'garda_session='+token}:{}});assert.equal(r.status,200);checks++;return r.json();}
 const upgraded=await legacyState('synthetic-owner-session');assert.equal(upgraded.me.id,'legacy-owner');assert.equal(upgraded.me.name,'Pecie Mihai');assert.equal(upgraded.me.role,'admin');assert.equal(upgraded.doctors.length,9);assert.equal(upgraded.users.filter(u=>u.role==='admin').length,1);assert(upgraded.doctors.some(d=>d.id==='legacy-doctor'&&d.registered));assert.equal(upgraded.users.find(u=>u.id==='legacy-doctor').points,6);assert.equal(upgraded.users.find(u=>u.id==='legacy-other').listed,0);assert.equal((await legacyState('synthetic-other-session')).me,null);
 assert.equal((await database.prepare("SELECT password FROM users WHERE id='legacy-owner'").first()).password,hash);
 for(const [table,rows]of Object.entries(preserved))assert.deepEqual((await database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,rows);
 await legacy.setOptions({...legacyOptions,bindings:{...bindings,QA_RESTART:'restart-isolate'}});
 database=await legacy.getD1Database('DB');
 const again=await legacyState('synthetic-owner-session');assert.equal(again.doctors.length,9);assert.equal(again.me.id,'legacy-owner');assert.deepEqual(again.users,upgraded.users);
 for(const [table,rows]of Object.entries(preserved))assert.deepEqual((await database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,rows);
 console.log('Passed existing-database upgrade checks: nine listed physicians, sole owner, existing identities and passwords preserved, archived account access revoked, shifts/preferences/points retained and repeat initialization safe.');
}finally{await legacy.dispose();}
