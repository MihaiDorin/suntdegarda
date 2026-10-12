import { db, now, uuid, fail, type User } from "@/lib/server";
import { ADMIN_EMAIL, normalizeDoctorName, unclaimedEmail } from "@/lib/team";
import { HISTORICAL_SHIFTS } from "@/lib/history";
import { allocate, type Allocation, type Participant } from "@/lib/scheduler";
import { dateKey, dayPoints, holidayMap, holidayScoreMap, isWeekend, monthDays, monthTitle, shiftDate, shiftMonth, todayRO } from "@/lib/calendar";
import { bucharestTimestamp, registrationDates, registrationStage } from "@/lib/rules";

export type PlanningMonth={id:string;status:string;version:number;deadline:string|null;report:string};
export type ScoredUser=Omit<User,"password">&{points:number;registered:number};
export async function scoredUsers(){return (await db().prepare("SELECT u.id,u.name,u.email,u.role,u.active,u.listed,CASE WHEN u.password<>'' THEN 1 ELSE 0 END AS registered,u.base_points,u.created,u.base_points+COALESCE((SELECT SUM(s.points) FROM shifts s WHERE s.user_id=u.id AND s.completed=1),0)+COALESCE((SELECT SUM(a.points) FROM point_adjustments a WHERE a.user_id=u.id),0) AS points FROM users u ORDER BY points DESC,u.name COLLATE NOCASE").all()).results as ScoredUser[];}
export async function holidayCalendar(year:number){
 const overrides=(await db().prepare("SELECT h.date,h.label,h.enabled,p.points FROM holidays h LEFT JOIN holiday_points p ON p.date=h.date WHERE h.date LIKE ?").bind(year+"-%").all()).results as {date:string;label:string;enabled:number;points:number}[];
 const holidays=holidayMap(year,overrides);return {holidays,holidayPoints:holidayScoreMap(year,holidays,overrides)};
}
export async function boundaryShifts(month:string){return (await db().prepare("SELECT date,user_id FROM shifts WHERE date IN (?,?)").bind(shiftDate(month+"-01",-1),shiftMonth(month,1)+"-01").all()).results as Pick<Allocation,"date"|"user_id">[];}
export async function assertNoConsecutive(date:string,userId:string,except:string[]=[]){
 const exclusion=except.length?" AND date NOT IN ("+except.map(()=>"?").join(",")+")":"";
 if(await db().prepare("SELECT date FROM shifts WHERE user_id=? AND date IN (?,?)"+exclusion+" LIMIT 1").bind(userId,shiftDate(date,-1),shiftDate(date,1),...except).first())fail("Acest medic ar avea două gărzi consecutive, inclusiv între luni. Alege altă zi sau alt medic.",409);
}
export async function assertProgramSpacing(month:string){
 if(await db().prepare("SELECT a.date FROM shifts a JOIN shifts b ON b.user_id=a.user_id AND b.date=date(a.date,'+1 day') WHERE a.month=? OR b.month=? LIMIT 1").bind(month,month).first())fail("Programul conține gărzi consecutive. Corectează atribuirea înainte de definitivare.",409);
}
export async function buildAllocation(month:string,force=false,locked?:Allocation[]){
 const [users,submissions,calendar,boundary,refusals,existing]=await Promise.all([
  scoredUsers(),db().prepare("SELECT user_id,preferred,available FROM submissions WHERE month=?").bind(month).all(),holidayCalendar(Number(month.slice(0,4))),boundaryShifts(month),
  db().prepare("SELECT date,user_id FROM shift_refusals WHERE date LIKE ?").bind(month+"-%").all(),
  force&&!locked?db().prepare("SELECT date,user_id,points,reason FROM shifts WHERE month=? ORDER BY date").bind(month).all():Promise.resolve({results:[]})
 ]);
 const people:Participant[]=users.filter(u=>u.active&&u.listed).map(u=>{const s=submissions.results.find(s=>s.user_id===u.id);return {id:u.id,name:u.name,points:u.points,preferred:s?JSON.parse(String(s.preferred)) as number[]:[],available:s?JSON.parse(String(s.available)) as number[]:[]};});
 return allocate(month,people,calendar.holidays,{holidayPoints:calendar.holidayPoints,boundary,force,locked:locked??(existing.results as Allocation[]),refused:refusals.results.map(s=>String(s.date)+":"+String(s.user_id))});
}
export async function weekendAvailable(month:string,userId:string){
 const result=await buildAllocation(month);
 return Array.from({length:monthDays(month)},(_,i)=>dateKey(month,i+1)).some(date=>isWeekend(date)&&(!result.allocations.some(s=>s.date===date)||result.allocations.some(s=>s.date===date&&s.user_id===userId)));
}

export async function initializeRulesHistory(){
 await db().batch([
  db().prepare("CREATE TABLE IF NOT EXISTS holiday_points(date TEXT PRIMARY KEY NOT NULL,points INTEGER NOT NULL CHECK(points IN (5,10)))"),
  db().prepare("CREATE TABLE IF NOT EXISTS point_adjustments(id TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL,points INTEGER NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id))"),
  db().prepare("CREATE TABLE IF NOT EXISTS shift_refusals(date TEXT NOT NULL,user_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(date,user_id),FOREIGN KEY(user_id) REFERENCES users(id))"),
  db().prepare("CREATE TRIGGER IF NOT EXISTS shifts_spacing_insert BEFORE INSERT ON shifts WHEN NEW.reason NOT LIKE 'Istoric importat:%' BEGIN SELECT RAISE(ABORT,'Garzi consecutive interzise') WHERE EXISTS(SELECT 1 FROM shifts s WHERE s.user_id=NEW.user_id AND s.date IN(date(NEW.date,'-1 day'),date(NEW.date,'+1 day'))); END"),
  db().prepare("CREATE TRIGGER IF NOT EXISTS shifts_spacing_update BEFORE UPDATE OF user_id,date ON shifts WHEN NEW.reason NOT LIKE 'Istoric importat:%' BEGIN SELECT RAISE(ABORT,'Garzi consecutive interzise') WHERE EXISTS(SELECT 1 FROM shifts s WHERE s.date<>OLD.date AND s.user_id=NEW.user_id AND s.date IN(date(NEW.date,'-1 day'),date(NEW.date,'+1 day'))); END")
 ]);
 const key="rules-history-2026-v1";if(await db().prepare("SELECT key FROM settings WHERE key=?").bind(key).first())return;
 const today=todayRO(),created=now(),guard="NOT EXISTS(SELECT 1 FROM settings WHERE key='rules-history-2026-v1')";
 const users=(await db().prepare("SELECT id,name FROM users").all()).results as {id:string;name:string}[];
 const ids=new Map(users.map(u=>[normalizeDoctorName(u.name),u.id]));
 const archiveId=ids.get(normalizeDoctorName("Shevchenko Irina"))??"doctor-history-shevchenko-irina";
 ids.set(normalizeDoctorName("Shevchenko Irina"),archiveId);
 const calendars=new Map<number,Awaited<ReturnType<typeof holidayCalendar>>>();
 for(const year of new Set(HISTORICAL_SHIFTS.map(s=>Number(s.date.slice(0,4)))))calendars.set(year,await holidayCalendar(year));
 const rows=HISTORICAL_SHIFTS.map(s=>{const id=ids.get(normalizeDoctorName(s.name));if(!id)throw new Error("Medicul din istoric nu a fost găsit: "+s.name);const c=calendars.get(Number(s.date.slice(0,4)))!;return {date:s.date,month:s.date.slice(0,7),user_id:id,points:dayPoints(s.date,c.holidays,c.holidayPoints),reason:"Istoric importat: "+s.source+" · "+s.original,completed:s.date<today?1:0};});
 const months=[...new Set(rows.map(s=>s.month))].map(month=>({id:month,status:month<today.slice(0,7)?"completed":"published",report:JSON.stringify({history:true,source:"Documentele Word ale administratorului"})}));
 const old=(await db().prepare("SELECT date,points FROM shifts").all()).results as {date:string;points:number}[];
 const updates:{date:string;points:number}[]=[];for(const s of old){const year=Number(s.date.slice(0,4));if(!calendars.has(year))calendars.set(year,await holidayCalendar(year));const c=calendars.get(year)!;updates.push({date:s.date,points:dayPoints(s.date,c.holidays,c.holidayPoints)});}
 const submissions=(await db().prepare("SELECT id,preferred,available FROM submissions").all()).results.map(s=>{const oldPreferred=JSON.parse(String(s.preferred)) as number[],preferred=oldPreferred.slice(0,4),available=[...new Set([...oldPreferred.slice(4),...JSON.parse(String(s.available)) as number[]])].filter(d=>!preferred.includes(d));return {id:s.id,preferred:JSON.stringify(preferred),available:JSON.stringify(available)};});
 await db().batch([
  db().prepare("INSERT INTO users(id,name,email,password,role,active,base_points,created,listed) SELECT ?,'Shevchenko Irina',?,'','doctor',0,0,?,0 WHERE "+guard+" ON CONFLICT(id) DO NOTHING").bind(archiveId,unclaimedEmail(archiveId),created),
  db().prepare("UPDATE shifts SET points=COALESCE((SELECT json_extract(j.value,'$.points') FROM json_each(?) j WHERE json_extract(j.value,'$.date')=shifts.date),points) WHERE "+guard).bind(JSON.stringify(updates)),
  db().prepare("INSERT INTO months(id,status,deadline,version,report) SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.status'),NULL,1,json_extract(j.value,'$.report') FROM json_each(?) j WHERE "+guard+" ON CONFLICT(id) DO UPDATE SET status=excluded.status,deadline=NULL,version=months.version+1,report=excluded.report").bind(JSON.stringify(months)),
  db().prepare("INSERT INTO shifts(date,month,user_id,points,reason,completed) SELECT json_extract(j.value,'$.date'),json_extract(j.value,'$.month'),json_extract(j.value,'$.user_id'),json_extract(j.value,'$.points'),json_extract(j.value,'$.reason'),json_extract(j.value,'$.completed') FROM json_each(?) j WHERE "+guard+" ON CONFLICT(date) DO UPDATE SET user_id=excluded.user_id,points=excluded.points,reason=excluded.reason,completed=excluded.completed").bind(JSON.stringify(rows)),
  db().prepare("UPDATE submissions SET preferred=(SELECT json_extract(j.value,'$.preferred') FROM json_each(?) j WHERE json_extract(j.value,'$.id')=submissions.id),available=(SELECT json_extract(j.value,'$.available') FROM json_each(?) j WHERE json_extract(j.value,'$.id')=submissions.id) WHERE "+guard+" AND id IN(SELECT json_extract(j.value,'$.id') FROM json_each(?) j)").bind(JSON.stringify(submissions),JSON.stringify(submissions),JSON.stringify(submissions)),
  db().prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE "+guard).bind(key,created)
 ]);
}
export async function transitionPlanning(month:PlanningMonth,status:string,result:ReturnType<typeof allocate>|null,message:string,deadline:string|null=null){
 const op=uuid(),created=now(),guard="EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)";
 const statements=[db().prepare("UPDATE months SET status=?,deadline=?,version=version+1,mutation=? WHERE id=? AND version=? AND status NOT IN ('published','completed')").bind(status,deadline,op,month.id,month.version)];
 if(result){statements.push(db().prepare("DELETE FROM shifts WHERE month=? AND "+guard).bind(month.id,month.id,op));statements.push(db().prepare("INSERT INTO shifts(date,month,user_id,points,reason,completed) SELECT json_extract(j.value,'$.date'),?,json_extract(j.value,'$.user_id'),json_extract(j.value,'$.points'),json_extract(j.value,'$.reason'),0 FROM json_each(?) j WHERE "+guard).bind(month.id,JSON.stringify(result.allocations),month.id,op));statements.push(db().prepare("UPDATE months SET report=? WHERE id=? AND mutation=?").bind(JSON.stringify(result.report),month.id,op));}
 if(message)statements.push(db().prepare("INSERT INTO notifications(id,user_id,message,read,created) SELECT lower(hex(randomblob(16))),u.id,?,0,? FROM users u WHERE u.active=1 AND u.listed=1 AND u.password<>'' AND "+guard).bind(message,created,month.id,op));
 statements.push(db().prepare("INSERT INTO audit(id,user_id,action,created) SELECT ?,u.id,?,? FROM users u WHERE u.email=? AND u.role='admin' AND "+guard).bind(uuid(),"Etapă program: "+month.id+" → "+status,created,ADMIN_EMAIL,month.id,op));
 const applied=await db().batch(statements);return !!applied[0].meta.changes;
}
export async function runMonthlyLifecycle(){
 const today=todayRO(),next=shiftMonth(today.slice(0,7),1);
 await db().prepare("INSERT OR IGNORE INTO months(id,status,version,report) VALUES(?,'locked',0,'{}')").bind(next).run();
 const months=(await db().prepare("SELECT id,status,version,deadline,report FROM months WHERE id>=? AND status NOT IN ('published','completed') ORDER BY id").bind(today.slice(0,7)).all()).results as PlanningMonth[];
 for(let m of months){
  const stage=registrationStage(m.id,today),dates=registrationDates(m.id);
  if(stage==="early"){if(m.status==="open")await transitionPlanning(m,"locked",null,"");continue;}
  if(stage==="open"){const deadline=bucharestTimestamp(dates.close);if(m.status==="locked")await transitionPlanning(m,"open",null,"S-au deschis înscrierile pentru "+monthTitle(m.id)+".",deadline);else if(m.status==="open"&&m.deadline!==deadline)await db().prepare("UPDATE months SET deadline=? WHERE id=? AND version=? AND status='open'").bind(deadline,m.id,m.version).run();continue;}
  if(["open","closed","locked"].includes(m.status)){
   if(!await transitionPlanning(m,"filling",await buildAllocation(m.id),stage==="filling"?"Înscrierile inițiale s-au închis. Poți prelua gărzile neacoperite pentru "+monthTitle(m.id)+" până pe 17.":"Înscrierile inițiale s-au închis pentru "+monthTitle(m.id)+".",bucharestTimestamp(dates.fillEnd)))continue;
   m=(await db().prepare("SELECT * FROM months WHERE id=?").bind(m.id).first<PlanningMonth>())!;
  }
  if(stage==="filling")continue;
  if(m.status==="filling"){
   if(!await transitionPlanning(m,"draft",await buildAllocation(m.id,true),"Gărzile neacoperite pentru "+monthTitle(m.id)+" au fost repartizate din coada clasamentului."))continue;
   m=(await db().prepare("SELECT * FROM months WHERE id=?").bind(m.id).first<PlanningMonth>())!;
  }
  if(stage==="final"&&m.status==="draft"){
   const count=await db().prepare("SELECT COUNT(*) AS n FROM shifts WHERE month=?").bind(m.id).first<{n:number}>();
   if(count?.n!==monthDays(m.id)){
    const result=await buildAllocation(m.id,true);if(result.report.uncovered.length){await db().prepare("INSERT OR IGNORE INTO notifications(id,user_id,message,read,created) SELECT ?,id,?,0,? FROM users WHERE email=? AND role='admin'").bind("planning-gap:"+m.id,"Programul pentru "+monthTitle(m.id)+" are zile fără medic eligibil. Completează-le pentru definitivare.",now(),ADMIN_EMAIL).run();continue;}
    if(!await transitionPlanning(m,"draft",result,""))continue;m=(await db().prepare("SELECT * FROM months WHERE id=?").bind(m.id).first<PlanningMonth>())!;
   }
   await assertProgramSpacing(m.id);await transitionPlanning(m,"published",null,"Programul pentru "+monthTitle(m.id)+" a fost definitivat.");
  }
 }
}
export async function sendDutyReminders(time=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Bucharest",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(time).map(p=>[p.type,p.value]));
 if(parts.hour!=="17"||Number(parts.minute)>=5)return;
 const today=parts.year+"-"+parts.month+"-"+parts.day,tomorrow=shiftDate(today,1);
 await db().prepare("INSERT OR IGNORE INTO notifications(id,user_id,message,read,created) SELECT 'duty-reminder:'||s.date||':'||s.user_id,s.user_id,?,0,? FROM shifts s JOIN months m ON m.id=s.month JOIN users u ON u.id=s.user_id WHERE s.date=? AND m.status IN ('published','completed') AND u.active=1 AND u.listed=1 AND u.password<>''").bind("Mâine ești de gardă · "+new Date(tomorrow+"T12:00:00Z").toLocaleDateString("ro-RO",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"})+".",time.toISOString(),tomorrow).run();
 await db().prepare("DELETE FROM push_deliveries WHERE created<?").bind(new Date(time.getTime()-7*86400000).toISOString()).run();
}
export async function refuseAssignedShift(date:string,user:User){
 const shift=await db().prepare("SELECT s.* FROM shifts s JOIN months m ON m.id=s.month WHERE s.date=? AND s.user_id=? AND s.completed=0 AND m.status IN ('filling','draft','published')").bind(date,user.id).first<Allocation>();
 if(!shift||date<=todayRO())fail("Poți refuza doar o gardă viitoare care îți este atribuită.");
 const month=(await db().prepare("SELECT * FROM months WHERE id=?").bind(date.slice(0,7)).first<PlanningMonth>())!;
 const [users,near,refused]=await Promise.all([scoredUsers(),db().prepare("SELECT user_id FROM shifts WHERE date IN (?,?)").bind(shiftDate(date,-1),shiftDate(date,1)).all(),db().prepare("SELECT user_id FROM shift_refusals WHERE date=?").bind(date).all()]);
 const blocked=new Set([user.id,...near.results.map(s=>String(s.user_id)),...refused.results.map(s=>String(s.user_id))]);
 const replacement=users.filter(u=>u.active&&u.listed&&!blocked.has(u.id)).sort((a,b)=>a.points-b.points||a.name.localeCompare(b.name,"ro"))[0];
 const op=uuid(),created=now(),guard="EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)";
 const statements=[
  db().prepare("UPDATE months SET version=version+1,mutation=? WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM shift_refusals WHERE date=? AND user_id=?) AND EXISTS(SELECT 1 FROM shifts WHERE date=? AND user_id=? AND completed=0)").bind(op,month.id,month.version,date,user.id,date,user.id),
  db().prepare("INSERT OR IGNORE INTO shift_refusals(date,user_id,created) SELECT ?,?,? WHERE "+guard).bind(date,user.id,created,month.id,op),
  db().prepare("INSERT OR IGNORE INTO point_adjustments(id,user_id,points,reason,created) SELECT ?,?,?,?,? WHERE "+guard).bind("refusal:"+date+":"+user.id,user.id,-shift.points,"Refuz gardă: "+date,created,month.id,op),
  replacement?db().prepare("UPDATE shifts SET user_id=?,reason='Repartizare automată după un refuz' WHERE date=? AND "+guard).bind(replacement.id,date,month.id,op):db().prepare("DELETE FROM shifts WHERE date=? AND "+guard).bind(date,month.id,op),
  db().prepare("INSERT INTO audit(id,user_id,action,created) SELECT ?,?,?,? WHERE "+guard).bind(uuid(),user.id,"Gardă refuzată: "+date+"; penalizare "+shift.points+" P",created,month.id,op)
 ];
 if(replacement)statements.push(db().prepare("INSERT INTO notifications(id,user_id,message,read,created) SELECT ?,?,?,0,? WHERE "+guard).bind(uuid(),replacement.id,"Ți-a fost repartizată garda din "+date+" după un refuz.",created,month.id,op));
 else statements.push(db().prepare("INSERT INTO notifications(id,user_id,message,read,created) SELECT ?,u.id,?,0,? FROM users u WHERE u.email=? AND "+guard).bind(uuid(),"Garda din "+date+" a fost refuzată și nu are înlocuitor eligibil.",created,ADMIN_EMAIL,month.id,op));
 const result=await db().batch(statements);if(!result[0].meta.changes)fail("Garda a fost actualizată sau refuzată deja. Reîncarcă.",409);
 return {ok:true,penalty:shift.points,replacement:replacement?.name??null};
}
