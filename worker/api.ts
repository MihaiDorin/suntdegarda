import { z } from "zod";
import { db,runtime,uuid,now,digest,hashPassword,passwordOK,currentUser,session,cookie,fail,AppError,rateLimit,notification,broadcastNotification,audit,safeUser,randomToken,isAdmin,type User } from "@/lib/server";
import { pushAction,removePushDevice } from "./push";
import { ADMIN_EMAIL,normalizeDoctorName,unclaimedEmail } from "@/lib/team";
import { setupComplete as setupDone,publicDoctors,validSetupToken,resetAccounts } from "./accounts";
import { allocate,type Participant } from "@/lib/scheduler";
import { getMonthPreview } from "@/lib/preview";
import { monthDays,monthTitle,dateKey,dateLabel,holidayMap,dayPoints,validateSelection,todayRO } from "@/lib/calendar";
type Month={id:string;status:string;version:number;deadline:string|null;report:string};
type Submission={user_id:string;month:string;preferred:string;available:string};
type Shift={date:string;month:string;user_id:string;points:number;completed:number;reason:string};
type Swap={id:string;from_date:string;to_date:string;requester:string;recipient:string;status:string};
const monthSchema=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const dateSchema=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/).refine(d=>{try{return new Date(d+"T12:00:00Z").toISOString().slice(0,10)===d;}catch{return false;}},"Dată invalidă");
const emailSchema=z.string().trim().email().max(254).transform(v=>v.toLowerCase());
const passwordSchema=z.string().min(10,"Parola trebuie să aibă minimum 10 caractere.").max(128);
const credentials=z.object({doctor_id:z.string().min(1),email:emailSchema,password:passwordSchema});
const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers}});
const parseJSON=(s:string,fallback:unknown)=>{try{return JSON.parse(s);}catch{return fallback;}};
async function pointsUsers(){return (await db().prepare("SELECT u.id,u.name,u.email,u.role,u.active,u.listed,CASE WHEN u.password<>'' THEN 1 ELSE 0 END AS registered,u.base_points,u.created,u.base_points+COALESCE(SUM(CASE WHEN s.completed=1 THEN s.points ELSE 0 END),0) AS points FROM users u LEFT JOIN shifts s ON s.user_id=u.id GROUP BY u.id ORDER BY points DESC,u.name COLLATE NOCASE").all()).results as (Omit<User,"password">&{points:number;registered:number})[];}
async function holidaysFor(year:number){return holidayMap(year,(await db().prepare("SELECT * FROM holidays WHERE date LIKE ?").bind(`${year}-%`).all()).results as {date:string;label:string;enabled:number}[]);}
async function getMonth(id:string){const m=await db().prepare("SELECT * FROM months WHERE id=?").bind(id).first<Month>();if(!m)fail("Luna nu a fost deschisă încă.");return m;}
function guard(m:Month,version:number){if(m.version!==version)fail("Datele au fost actualizate de altcineva. Reîncarcă și încearcă din nou.",409);}
async function mutation(m:Month,status:string,statements:(op:string)=>D1PreparedStatement[],actor:User,action:string){const op=uuid();const results=await db().batch([db().prepare("UPDATE months SET status=?,version=version+1,mutation=? WHERE id=? AND version=?").bind(status,op,m.id,m.version),...statements(op),db().prepare("INSERT INTO audit (id,user_id,action,created) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(uuid(),actor.id,action,now(),m.id,op)]);if(!results[0].meta.changes)fail("Luna a fost actualizată între timp. Reîncarcă datele.",409);}

export async function GET(request:Request){try{
 const user=await currentUser(request),setupComplete=await setupDone(),emailReady=!!(runtime("RESEND_API_KEY")&&runtime("MAIL_FROM"));
 if(new URL(request.url).searchParams.get("view")==="preview"){
  if(!user)fail("Autentifică-te pentru a vedea programul.",401);
  if(!user.active)fail("Contul nu are acces la program.",403);
  const month=monthSchema.parse(new URL(request.url).searchParams.get("month"));
  const preview=await getMonthPreview(month);
  if(!isAdmin(user))return json({...preview,shifts:preview.shifts.map(s=>({...s,reason:"Repartizare"})),doctors:[],report:{uncovered:preview.report.uncovered,conflicts:[],deficits:[]},stats:{...preview.stats,requested:0,submitted:0,activeDoctors:0,preferredHonored:0,missingSubmissions:[]}});
  return json(preview);
 }
 if(!user)return json({me:null,setupComplete,emailReady,doctors:await publicDoctors()});
 if(!user.active)return json({me:safeUser(user),setupComplete,emailReady,pending:true});
 const year=z.coerce.number().int().min(2020).max(2099).parse(new URL(request.url).searchParams.get("year")??todayRO().slice(0,4));
 const admin=isAdmin(user);
 const results=await Promise.all([
  pointsUsers(),db().prepare("SELECT id,status,deadline,version,report FROM months WHERE id LIKE ? ORDER BY id").bind(`${year}-%`).all(),
  db().prepare(`SELECT * FROM submissions WHERE month LIKE ? ${admin?"":"AND user_id=?"}`).bind(`${year}-%`,...(!admin?[user.id]:[])).all(),
  db().prepare(`SELECT s.* FROM shifts s JOIN months m ON m.id=s.month WHERE s.month LIKE ? ${admin?"":"AND m.status IN ('published','completed')"} ORDER BY s.date`).bind(`${year}-%`).all(),
  db().prepare("SELECT * FROM swaps WHERE requester=? OR recipient=? ORDER BY created DESC LIMIT 100").bind(user.id,user.id).all(),
  db().prepare("SELECT id,message,read,created FROM notifications WHERE user_id=? ORDER BY created DESC LIMIT 100").bind(user.id).all(),holidaysFor(year),
  db().prepare("SELECT s.* FROM shifts s JOIN months m ON m.id=s.month WHERE m.status='published' AND s.date>=? ORDER BY s.date LIMIT 1200").bind(todayRO()).all(),
  admin?db().prepare("SELECT a.action,a.created,u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created DESC LIMIT 40").all():Promise.resolve({results:[]}),
  db().prepare("SELECT m.id FROM months m LEFT JOIN submissions s ON s.month=m.id AND s.user_id=? WHERE m.status='open' AND m.id>=? AND (m.deadline IS NULL OR m.deadline>?) AND s.id IS NULL ORDER BY m.id LIMIT 1").bind(user.id,todayRO().slice(0,7),now()).first<{id:string}>()
 ]);
 const [users,months,submissions,shifts,swaps,notifications,holidays,futureShifts,events,suggestion]=results;
 return json({me:safeUser(user),setupComplete,emailReady,doctors:await publicDoctors(),accountResetPending:admin&&!await db().prepare("SELECT value FROM settings WHERE key='accounts_reset_v2'").first(),suggestedMonth:suggestion?.id??null,users:users.map(u=>({id:u.id,name:u.name,role:isAdmin(u)?"admin":"doctor",active:u.active,listed:u.listed,registered:u.registered,points:u.points,base_points:u.base_points,...(admin?{email:u.registered?u.email:undefined}:{})})),months:months.results.map(m=>({...m,report:admin?parseJSON(String(m.report),{}):{}})),submissions:submissions.results.map(s=>({...s,preferred:parseJSON(String(s.preferred),[]),available:parseJSON(String(s.available),[])})),shifts:shifts.results,swaps:swaps.results,notifications:notifications.results,holidays,futureShifts:futureShifts.results,events:events.results,today:todayRO()});
 }catch(error){return onError(error);}}

export async function POST(request:Request){try{
 if(request.headers.get("X-Garda-Request")!=="1")fail("Cerere invalidă.",403);
 const origin=request.headers.get("origin");const url=new URL(request.url);if(origin&&origin!==url.origin&&origin!==runtime("SITE_ORIGIN"))fail("Origine nepermisă.",403);
 if(Number(request.headers.get("content-length")??0)>20000)fail("Cerere prea mare.",413);
 const raw=await request.text();if(raw.length>20000)fail("Cerere prea mare.",413);
 const body=JSON.parse(raw) as Record<string,unknown>;const action=z.string().parse(body.action);
 if(["register","login","setup","forgot","reset"].includes(action))await rateLimit(request,"auth",40);
 if(action==="setup"||action==="register"){
  const c=credentials.extend({token:z.string().optional()}).parse(body);
  const target=await db().prepare("SELECT * FROM users WHERE id=? AND listed=1 AND active=1").bind(c.doctor_id).first<User>();
  if(!target)fail("Selectează un medic din lista introdusă de administrator.",400);
  const owner=isAdmin(target);
  if(action==="setup"){
   if(!owner||c.email!==ADMIN_EMAIL)fail("Administratorul este Pecie Mihai, cu adresa pmihaidorin@gmail.com.",403);
   if(!c.token||!await validSetupToken(c.token))fail("Linkul de configurare nu este valid.",403);
   if(await setupDone())fail("Administratorul este deja configurat.",409);
  }else{
   if(owner||c.email===ADMIN_EMAIL)fail("Contul administratorului se configurează numai prin linkul privat.",403);
   if(!await setupDone())fail("Administratorul trebuie să configureze aplicația înainte de activarea conturilor.",409);
  }
  if(target.password)fail("Acest medic are deja un cont. Folosește autentificarea sau recuperarea parolei.",409);
  if(c.email.endsWith("@garda.invalid"))fail("Introdu o adresă de email reală pentru recuperarea parolei.");
  if(await db().prepare("SELECT id FROM users WHERE email=? AND id<>?").bind(c.email,target.id).first())fail("Există deja un cont cu această adresă de email.",409);
  const pwd=await hashPassword(c.password);
  const result=await db().batch([
   db().prepare("UPDATE users SET email=?,password=? WHERE id=? AND password='' AND listed=1 AND active=1").bind(c.email,pwd,target.id),
   ...(owner?[
    db().prepare("INSERT INTO settings(key,value) SELECT 'bootstrap_done',? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(target.id,target.id,pwd),
    db().prepare("DELETE FROM settings WHERE key='owner_setup_token' AND EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)").bind(target.id,pwd)
   ]:[])
  ]);
  if(!result[0].meta.changes)fail("Acest medic a fost deja activat. Autentifică-te.",409);
  await audit(target.id,owner?"Administrator configurat":"Cont activat pentru "+target.name).run();
  return json({ok:true},200,{"Set-Cookie":await session(target.id,request)});
 }
 if(action==="login"){
  const c=z.object({doctor_id:z.string().min(1),password:z.string().max(128)}).parse(body);
  await rateLimit(request,`login:${await digest(c.doctor_id)}`,10);
  const u=await db().prepare("SELECT * FROM users WHERE id=? AND listed=1 AND active=1 AND password<>''").bind(c.doctor_id).first<User>();
  const valid=await passwordOK(c.password,u?.password??"pbkdf2$100000$nonexistent-user-salt$0000000000000000000000000000000000000000000000000000000000000000");
  if(!u||!valid)fail("Medicul selectat sau parola este incorectă.",401);
  return json({ok:true},200,{"Set-Cookie":await session(u.id,request)});
 }
 if(action==="forgot"){
  const c=z.object({email:emailSchema}).parse(body);await rateLimit(request,`forgot:${await digest(c.email)}`,5);
  if(!runtime("RESEND_API_KEY")||!runtime("MAIL_FROM"))fail("Recuperarea prin email nu este încă activată. Solicită administratorului resetarea parolei.",503);
  const u=await db().prepare("SELECT * FROM users WHERE email=? AND listed=1 AND active=1 AND password<>''").bind(c.email).first<User>();
  if(u){const token=randomToken();const hashed=await digest(token);await db().batch([db().prepare("DELETE FROM resets WHERE user_id=?").bind(u.id),db().prepare("INSERT INTO resets (token,user_id,expires) VALUES (?,?,?)").bind(hashed,u.id,Date.now()+1800000)]);
   const link=`${runtime("SITE_ORIGIN")||url.origin}/?reset=${encodeURIComponent(token)}`;
   const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${runtime("RESEND_API_KEY")}`,"Content-Type":"application/json"},body:JSON.stringify({from:runtime("MAIL_FROM"),to:[u.email],subject:"Garda · Resetarea parolei",text:`Ai solicitat resetarea parolei. Deschide linkul în următoarele 30 de minute:\n${link}\nDacă nu ai solicitat resetarea, ignoră acest email.`})});
   if(!sent.ok){console.error("Mail delivery failed",sent.status);await db().prepare("DELETE FROM resets WHERE token=?").bind(hashed).run();fail("Emailul nu a putut fi trimis. Reîncearcă mai târziu.",503);}
  }return json({ok:true,message:"Dacă există un cont cu această adresă, vei primi un link de resetare."});
 }
 if(action==="reset"){
  const c=z.object({token:z.string().min(30),password:passwordSchema}).parse(body);const token=await digest(c.token);const reset=await db().prepare("SELECT user_id FROM resets WHERE token=? AND expires>?").bind(token,Date.now()).first<{user_id:string}>();if(!reset)fail("Linkul a expirat sau a fost deja folosit.");
  const r=await db().batch([db().prepare("UPDATE users SET password=? WHERE id=? AND EXISTS(SELECT 1 FROM resets WHERE token=? AND expires>?)").bind(await hashPassword(c.password),reset.user_id,token,Date.now()),db().prepare("DELETE FROM sessions WHERE user_id=?").bind(reset.user_id),db().prepare("DELETE FROM resets WHERE user_id=?").bind(reset.user_id)]);if(!r[0].meta.changes)fail("Linkul de resetare nu mai este valid.");return json({ok:true});
 }
 const user=await currentUser(request);if(!user)fail("Autentifică-te pentru a continua.",401);
 if(action==="logout"){if(typeof body.endpoint==="string"&&body.endpoint.length<=2048)await removePushDevice(user.id,body.endpoint);const match=request.headers.get("cookie")?.match(/(?:^|;\s*)garda_session=([^;]+)/);if(match)await db().prepare("DELETE FROM sessions WHERE token=?").bind(await digest(match[1])).run();return json({ok:true},200,{"Set-Cookie":cookie("",request,true)});}
 if(action==="password"){
  const c=z.object({current:z.string().max(128),password:passwordSchema}).parse(body);if(!await passwordOK(c.current,user.password))fail("Parola actuală este incorectă.");await db().batch([db().prepare("UPDATE users SET password=? WHERE id=?").bind(await hashPassword(c.password),user.id),db().prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id)]);return json({ok:true},200,{"Set-Cookie":await session(user.id,request)});
 }
 if(!user.active)fail("Contul așteaptă aprobarea administratorului.",403);
 if(["push-config","push-subscribe","push-unsubscribe","push-status","push-test"].includes(action))return json(await pushAction(action,body,user));
 if(action==="read-notifications"){await db().prepare("UPDATE notifications SET read=1 WHERE user_id=?").bind(user.id).run();return json({ok:true});}
 if(action==="submit"){
  const c=z.object({month:monthSchema,preferred:z.array(z.number().int()).max(31),available:z.array(z.number().int()).max(31)}).parse(body);try{validateSelection(c.month,c.preferred,c.available);}catch(error){fail((error as Error).message);}
  const m=await getMonth(c.month);if(m.status!=="open"||m.deadline&&m.deadline<=now())fail("Perioada de înscriere este închisă.",409);
  const op=uuid();const r=await db().batch([db().prepare("UPDATE months SET version=version+1,mutation=? WHERE id=? AND status='open' AND (deadline IS NULL OR deadline>?)").bind(op,c.month,now()),db().prepare("INSERT INTO submissions (id,month,user_id,preferred,available,updated) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?) ON CONFLICT(id) DO UPDATE SET preferred=excluded.preferred,available=excluded.available,updated=excluded.updated").bind(`${c.month}:${user.id}`,c.month,user.id,JSON.stringify(c.preferred),JSON.stringify(c.available),now(),c.month,op),db().prepare("INSERT INTO audit (id,user_id,action,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(uuid(),user.id,`Preferințe salvate: ${c.month}`,now(),c.month,op)]);if(!r[0].meta.changes)fail("Înscrierile s-au închis între timp.",409);await notification(user.id,`Înscrierea ta pentru ${monthTitle(c.month)} a fost salvată: ${c.preferred.length} gărzi solicitate.`).run();return json({ok:true});
 }
 if(action==="swap-request"){
  const c=z.object({from:dateSchema,to:dateSchema}).parse(body);if(c.from===c.to||c.from<=todayRO()||c.to<=todayRO())fail("Schimburile sunt permise doar pentru două zile viitoare distincte.");
  const shifts=(await db().prepare("SELECT s.* FROM shifts s JOIN months m ON m.id=s.month WHERE s.date IN (?,?) AND m.status='published' AND s.completed=0").bind(c.from,c.to).all()).results as Shift[];
  const from=shifts.find(s=>s.date===c.from),to=shifts.find(s=>s.date===c.to);if(!from||!to||from.user_id!==user.id||to.user_id===user.id)fail("Selectează o gardă proprie și o gardă a altui medic dintr-un program definitiv.");
  if(!await db().prepare("SELECT id FROM users WHERE id=? AND active=1").bind(to.user_id).first())fail("Medicul selectat nu mai are cont activ.");
  if(await db().prepare("SELECT id FROM swaps WHERE requester=? AND from_date=? AND to_date=? AND status='pending'").bind(user.id,c.from,c.to).first())fail("Ai trimis deja această cerere.");
  await db().batch([db().prepare("INSERT INTO swaps (id,from_date,to_date,requester,recipient,status,created) VALUES (?,?,?,?,?,'pending',?)").bind(uuid(),c.from,c.to,user.id,to.user_id,now()),notification(to.user_id,`${user.name} propune schimbul: ${dateLabel(c.from)} cu ${dateLabel(c.to)}.`),audit(user.id,`Cerere schimb: ${c.from} ↔ ${c.to}`)]);return json({ok:true});
 }
 if(action==="swap-answer"){
  const c=z.object({id:z.string(),answer:z.enum(["accept","decline","cancel"])}).parse(body);const s=await db().prepare("SELECT * FROM swaps WHERE id=? AND status='pending'").bind(c.id).first<Swap>();if(!s)fail("Cererea nu mai este în așteptare.",409);
  if(c.answer==="cancel"?s.requester!==user.id:s.recipient!==user.id)fail("Nu poți răspunde la această cerere.",403);
  if(c.answer!=="accept"){const status=c.answer==="cancel"?"cancelled":"declined";const r=await db().prepare("UPDATE swaps SET status=? WHERE id=? AND status='pending'").bind(status,s.id).run();if(!r.meta.changes)fail("Cererea a fost deja soluționată.",409);await db().batch([notification(c.answer==="cancel"?s.recipient:s.requester,`${user.name} ${c.answer==="cancel"?"a anulat":"a refuzat"} schimbul ${dateLabel(s.from_date)} ↔ ${dateLabel(s.to_date)}.`),audit(user.id,`Schimb ${status}: ${s.from_date} ↔ ${s.to_date}`)]);return json({ok:true});}
  if(s.from_date<=todayRO()||s.to_date<=todayRO())fail("O gardă din cerere a început deja.",409);
  const op=`accepting:${uuid()}`;
  const r=await db().batch([db().prepare("UPDATE swaps SET status=? WHERE id=? AND status='pending' AND (SELECT COUNT(*) FROM shifts x JOIN months m ON m.id=x.month WHERE ((x.date=? AND x.user_id=?) OR (x.date=? AND x.user_id=?)) AND x.completed=0 AND m.status='published')=2").bind(op,s.id,s.from_date,s.requester,s.to_date,s.recipient),db().prepare("UPDATE shifts SET user_id=CASE date WHEN ? THEN ? ELSE ? END,reason='Schimb acceptat' WHERE date IN (?,?) AND EXISTS(SELECT 1 FROM swaps WHERE id=? AND status=?)").bind(s.from_date,s.recipient,s.requester,s.from_date,s.to_date,s.id,op),db().prepare("UPDATE months SET version=version+1 WHERE id IN (?,?) AND EXISTS(SELECT 1 FROM swaps WHERE id=? AND status=?)").bind(s.from_date.slice(0,7),s.to_date.slice(0,7),s.id,op),db().prepare("UPDATE swaps SET status='accepted' WHERE id=? AND status=?").bind(s.id,op)]);
  if(r[0].meta.changes!==1||r[1].meta.changes!==2){await db().prepare("UPDATE swaps SET status='expired' WHERE id=? AND status='pending'").bind(s.id).run();fail("Programul s-a schimbat între timp. Trimite o cerere nouă.",409);}
  await db().batch([notification(s.requester,`${user.name} a acceptat schimbul ${dateLabel(s.from_date)} ↔ ${dateLabel(s.to_date)}.`),notification(s.recipient,"Schimbul a fost acceptat. Programul a fost actualizat."),audit(user.id,`Schimb acceptat: ${s.from_date} ↔ ${s.to_date}`)]);return json({ok:true});
 }
 if(!isAdmin(user))fail("Această acțiune este disponibilă doar administratorului.",403);
 if(action==="doctor-add"){
  const c=z.object({name:z.string().trim().min(2).max(80)}).parse(body);
  const names=(await db().prepare("SELECT name FROM users WHERE listed=1").all()).results;
  if(names.some(u=>normalizeDoctorName(String(u.name))===normalizeDoctorName(c.name)))fail("Acest medic este deja în listă.",409);
  const id=uuid();
  await db().batch([db().prepare("INSERT INTO users(id,name,email,password,role,active,base_points,created,listed) VALUES(?,?,?,'','doctor',1,0,?,1)").bind(id,c.name,unclaimedEmail(id),now()),audit(user.id,`Medic adăugat în echipă: ${c.name}`)]);
  return json({ok:true,id});
 }
 if(action==="reset-accounts"){
  z.object({confirmation:z.literal("RESETARE")}).parse(body);
  await audit(user.id,"Toate conturile de acces resetate; programările și punctajele au fost păstrate").run();
  const token=await resetAccounts();
  return json({ok:true,link:`${url.origin}/?setup=${encodeURIComponent(token)}`},200,{"Set-Cookie":cookie("",request,true)});
 }
 if(action==="user-update"){
  const c=z.object({id:z.string(),active:z.number().int().min(0).max(1),base_points:z.number().int().min(0).max(100000)}).parse(body);const target=await db().prepare("SELECT * FROM users WHERE id=?").bind(c.id).first<User>();if(!target||!target.listed)fail("Medicul nu este în lista echipei.");if(isAdmin(target)&&!c.active)fail("Administratorul trebuie să rămână activ.");await db().batch([db().prepare("UPDATE users SET active=?,base_points=? WHERE id=?").bind(c.active,c.base_points,c.id),notification(c.id,c.active?"Accesul tău la echipă este activ. Poți selecta gărzile.":"Accesul tău la echipă a fost suspendat."),audit(user.id,`Cont actualizat: ${target.name}, puncte inițiale ${c.base_points}, activ ${c.active}`)]);return json({ok:true});
 }
 if(action==="admin-reset"){
  const c=z.object({id:z.string()}).parse(body);const target=await db().prepare("SELECT * FROM users WHERE id=?").bind(c.id).first<User>();if(!target||!target.listed||!target.password)fail("Medicul trebuie să își activeze mai întâi contul.");const token=randomToken();await db().batch([db().prepare("DELETE FROM resets WHERE user_id=?").bind(c.id),db().prepare("INSERT INTO resets (token,user_id,expires) VALUES (?,?,?)").bind(await digest(token),c.id,Date.now()+1800000),audit(user.id,`Link de resetare generat pentru ${target.name}`)]);return json({ok:true,link:`${runtime("SITE_ORIGIN")||url.origin}/?reset=${encodeURIComponent(token)}`});
 }
 if(action==="holiday"){
  const c=z.object({date:dateSchema,label:z.string().trim().min(2).max(100),enabled:z.number().int().min(0).max(1)}).parse(body);
  const m=await db().prepare("SELECT status FROM months WHERE id=?").bind(c.date.slice(0,7)).first<Month>();if(m&&["draft","published","completed"].includes(m.status))fail("Modifică sărbătorile înainte de generarea programului. Redeschide mai întâi luna.");await db().batch([db().prepare("INSERT INTO holidays (date,label,enabled) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET label=excluded.label,enabled=excluded.enabled").bind(c.date,c.label,c.enabled),audit(user.id,`Sărbătoare actualizată: ${c.date}`)]);return json({ok:true});
 }
 if(action==="month-open"){
  const c=z.object({month:monthSchema,deadline:z.string().datetime().nullable()}).parse(body);if(c.month<todayRO().slice(0,7))fail("Poți deschide luna curentă sau o lună viitoare.");if(c.deadline&&c.deadline<=now())fail("Termenul trebuie să fie în viitor.");
  const m=await db().prepare("SELECT * FROM months WHERE id=?").bind(c.month).first<Month>();if(m&&["published","completed"].includes(m.status))fail("Un program definitiv nu poate fi redeschis. Folosește cererile de schimb.");
  if(m)await mutation(m,"open",op=>[db().prepare("UPDATE months SET deadline=?,report='{}' WHERE id=? AND mutation=?").bind(c.deadline,c.month,op),db().prepare("DELETE FROM shifts WHERE month=? AND EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(c.month,c.month,op)],user,`Înscrieri deschise: ${c.month}`);
  else await db().batch([db().prepare("INSERT INTO months (id,status,deadline,version,report) VALUES (?,'open',?,0,'{}')").bind(c.month,c.deadline),audit(user.id,`Înscrieri deschise: ${c.month}`)]);
  await broadcastNotification(`S-au deschis înscrierile pentru ${monthTitle(c.month)}.`).run();return json({ok:true});
 }
 const c=z.object({month:monthSchema,version:z.number().int()}).parse(body);const m=await getMonth(c.month);guard(m,c.version);
 if(action==="month-close"){
  if(m.status!=="open")fail("Luna nu este deschisă pentru înscrieri.");await mutation(m,"closed",op=>[db().prepare("INSERT INTO notifications(id,user_id,message,read,created) SELECT lower(hex(randomblob(16))),id,?,0,? FROM users WHERE active=1 AND listed=1 AND password<>'' AND EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(`S-au închis înscrierile pentru ${monthTitle(c.month)}.`,now(),m.id,op)],user,`Înscrieri închise: ${c.month}`);return json({ok:true});
 }
 if(action==="generate"){
  if(!["closed","draft"].includes(m.status))fail("Închide înscrierile înainte de generarea programului.");
  const users=await pointsUsers();const subs=(await db().prepare("SELECT * FROM submissions WHERE month=?").bind(c.month).all()).results as Submission[];
  const participants:Participant[]=subs.flatMap(s=>{const u=users.find(u=>u.id===s.user_id&&u.active);return u?[{id:u.id,name:u.name,points:u.points,preferred:parseJSON(s.preferred,[]) as number[],available:parseJSON(s.available,[]) as number[]}]:[];});
  if(!participants.some(p=>p.preferred.length))fail("Niciun medic nu a solicitat gărzi pentru această lună.");
  const result=allocate(c.month,participants,await holidaysFor(Number(c.month.slice(0,4))));
  await mutation(m,"draft",op=>[db().prepare("DELETE FROM shifts WHERE month=? AND EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(c.month,c.month,op),...result.allocations.map(a=>db().prepare("INSERT INTO shifts (date,month,user_id,points,reason,completed) SELECT ?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(a.date,c.month,a.user_id,a.points,a.reason,c.month,op)),db().prepare("UPDATE months SET report=? WHERE id=? AND mutation=?").bind(JSON.stringify(result.report),c.month,op)],user,`Program generat: ${c.month}`);return json({ok:true,report:result.report});
 }
 if(action==="assign"){
  if(m.status!=="draft")fail("Atribuirea manuală este disponibilă în programul provizoriu.");const a=z.object({day:z.number().int().min(1).max(monthDays(c.month)),user_id:z.string()}).parse(body);
  const target=await db().prepare("SELECT * FROM submissions WHERE month=? AND user_id=? AND user_id IN(SELECT id FROM users WHERE active=1)").bind(c.month,a.user_id).first<Submission>();if(!target)fail("Medicul nu a trimis disponibilitatea pentru această lună.");const preferred=parseJSON(target.preferred,[]) as number[],available=parseJSON(target.available,[]) as number[];
  if(![...preferred,...available].includes(a.day))fail("Medicul nu și-a declarat disponibilitatea în această zi.");const count=await db().prepare("SELECT COUNT(*) AS n FROM shifts WHERE month=? AND user_id=? AND date<>?").bind(c.month,a.user_id,dateKey(c.month,a.day)).first<{n:number}>();if((count?.n??0)>=preferred.length)fail("Medicul are deja numărul de gărzi solicitat.");
  const date=dateKey(c.month,a.day),points=dayPoints(date,await holidaysFor(Number(c.month.slice(0,4))));await mutation(m,"draft",op=>[db().prepare("INSERT INTO shifts (date,month,user_id,points,reason,completed) SELECT ?,?,?,?,'Atribuire manuală',0 WHERE EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?) ON CONFLICT(date) DO UPDATE SET user_id=excluded.user_id,reason=excluded.reason,points=excluded.points").bind(date,c.month,a.user_id,points,c.month,op)],user,`Atribuire manuală: ${date}`);return json({ok:true});
 }
 if(action==="publish"){
  if(m.status!=="draft")fail("Generează mai întâi programul provizoriu.");const count=await db().prepare("SELECT COUNT(*) AS n FROM shifts WHERE month=?").bind(c.month).first<{n:number}>();if(count?.n!==monthDays(c.month))fail("Programul are zile neacoperite. Completează-le înainte de definitivare.");
  const inactive=await db().prepare("SELECT s.date FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.month=? AND u.active=0 LIMIT 1").bind(c.month).first();if(inactive)fail("Programul conține un medic cu acces suspendat. Regenerează-l.");
  await mutation(m,"published",()=>[],user,`Program definitivat: ${c.month}`);await broadcastNotification(`Programul pentru ${monthTitle(c.month)} a fost definitivat.`).run();return json({ok:true});
 }
 if(action==="complete"){
  if(m.status!=="published")fail("Punctele se acordă doar pentru un program definitiv.");if(dateKey(c.month,monthDays(c.month))>=todayRO())fail("Poți confirma gărzile efectuate după încheierea lunii.");
  await mutation(m,"completed",op=>[db().prepare("UPDATE shifts SET completed=1 WHERE month=? AND EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(c.month,c.month,op)],user,`Gărzi efectuate confirmate: ${c.month}`);return json({ok:true});
 }
 fail("Acțiune necunoscută.");
 }catch(error){return onError(error);}}
function onError(error:unknown){if(error instanceof AppError)return json({error:error.message},error.status);if(error instanceof z.ZodError)return json({error:error.issues[0]?.message??"Date invalide."},400);if(error instanceof SyntaxError)return json({error:"Date invalide."},400);console.error("Garda request failed",error instanceof Error?error.message:error);return json({error:"Operația nu a putut fi finalizată. Datele introduse au fost păstrate; reîncearcă."},503);}
