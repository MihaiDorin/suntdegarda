import { db,now } from "./server";
import { allocate,type Participant } from "./scheduler";
import { dateKey,monthDays,holidayMap } from "./calendar";

type PreviewUser={id:string;name:string;active:number;points:number};
type PreviewSubmission={user_id:string;preferred:string;available:string};
type PreviewShift={date:string;month:string;user_id:string;points:number;reason:string;completed:number};
export type MonthPreview={
 month:string;status:string;source:"simulation"|"saved"|"final"|"empty";version:number;generatedAt:string;
 holidays:Record<string,string>;shifts:PreviewShift[];
 report:{uncovered:number[];conflicts:string[];deficits:{id:string;name:string;requested:number;assigned:number}[]};
 stats:{days:number;covered:number;requested:number;submitted:number;activeDoctors:number;preferredHonored:number;missingSubmissions:string[]};
 doctors:{id:string;name:string;requested:number;assigned:number;preferredHonored:number;weekday:number;weekend:number;holiday:number;currentPoints:number;monthPoints:number;projectedPoints:number}[];
};
const scoreSQL="SELECT u.id,u.name,u.active,u.base_points+COALESCE(SUM(CASE WHEN s.completed=1 THEN s.points ELSE 0 END),0) AS points FROM users u LEFT JOIN shifts s ON s.user_id=u.id GROUP BY u.id ORDER BY points DESC,u.name COLLATE NOCASE";
export async function getMonthPreview(month:string):Promise<MonthPreview>{
 // One read-only batch keeps the month, submissions, scores and overrides in a consistent snapshot.
 const results=await db().batch([
  db().prepare("SELECT id,status,version,report FROM months WHERE id=?").bind(month),
  db().prepare(scoreSQL),
  db().prepare("SELECT user_id,preferred,available FROM submissions WHERE month=?").bind(month),
  db().prepare("SELECT date,month,user_id,points,reason,completed FROM shifts WHERE month=? ORDER BY date").bind(month),
  db().prepare("SELECT date,label,enabled FROM holidays WHERE date LIKE ?").bind(`${month.slice(0,4)}-%`)
 ]);
 const m=results[0].results[0] as {status:string;version:number;report:string}|undefined;
 const users=results[1].results as PreviewUser[];
 const submissions=(results[2].results as PreviewSubmission[]).map(s=>({...s,preferred:JSON.parse(s.preferred) as number[],available:JSON.parse(s.available) as number[]}));
 const holidays=holidayMap(Number(month.slice(0,4)),results[4].results as {date:string;label:string;enabled:number}[]);
 const status=m?.status??"locked";
 const source:MonthPreview["source"]=["open","closed"].includes(status)?"simulation":status==="draft"?"saved":["published","completed"].includes(status)?"final":"empty";
 const participants:Participant[]=submissions.flatMap(s=>{const u=users.find(u=>u.id===s.user_id&&u.active);return u?[{id:u.id,name:u.name,points:u.points,preferred:s.preferred,available:s.available}]:[];});
 const calculated=source==="simulation"?allocate(month,participants,holidays):null;
 const shifts:PreviewShift[]=calculated?calculated.allocations.map(a=>({...a,month,completed:0})):source==="empty"?[]:results[3].results as PreviewShift[];
 const recordedReport=m?JSON.parse(m.report) as {conflicts?:string[]}:{};
 const doctors=users.filter(u=>submissions.some(s=>s.user_id===u.id)&&(source!=="simulation"||u.active)||shifts.some(s=>s.user_id===u.id)).map(u=>{
  const sub=submissions.find(s=>s.user_id===u.id),own=shifts.filter(s=>s.user_id===u.id);
  return {id:u.id,name:u.name,requested:sub?.preferred.length??0,assigned:own.length,preferredHonored:own.filter(s=>sub?.preferred.includes(Number(s.date.slice(8)))).length,
   weekday:own.filter(s=>s.points===1).length,weekend:own.filter(s=>s.points===2).length,holiday:own.filter(s=>s.points===3).length,
   currentPoints:u.points,monthPoints:own.reduce((n,s)=>n+s.points,0),projectedPoints:u.points+own.filter(s=>!s.completed).reduce((n,s)=>n+s.points,0)};
 }).sort((a,b)=>b.currentPoints-a.currentPoints||a.name.localeCompare(b.name,"ro"));
 const uncovered=Array.from({length:monthDays(month)},(_,i)=>i+1).filter(d=>!shifts.some(s=>s.date===dateKey(month,d)));
 return {month,status,source,version:m?.version??0,generatedAt:now(),holidays,shifts,
  report:{uncovered,conflicts:calculated?.report.conflicts??recordedReport.conflicts??[],deficits:doctors.filter(u=>u.assigned<u.requested).map(u=>({id:u.id,name:u.name,requested:u.requested,assigned:u.assigned}))},
  stats:{days:monthDays(month),covered:shifts.length,requested:doctors.reduce((n,u)=>n+u.requested,0),submitted:submissions.filter(s=>users.some(u=>u.id===s.user_id&&u.active)).length,activeDoctors:users.filter(u=>u.active).length,preferredHonored:doctors.reduce((n,u)=>n+u.preferredHonored,0),missingSubmissions:users.filter(u=>u.active&&!submissions.some(s=>s.user_id===u.id)).map(u=>u.name)},doctors};
}
