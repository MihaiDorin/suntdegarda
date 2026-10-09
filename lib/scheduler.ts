import { dateKey, monthDays, dayPoints } from "./calendar";
export type Participant={id:string;name:string;points:number;preferred:number[];available:number[]};
export type Allocation={date:string;user_id:string;points:number;reason:string};
export function allocate(month:string,input:Participant[],holidays:Record<string,string>){
 const people=[...input].filter(p=>p.preferred.length).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,"ro")||a.id.localeCompare(b.id));
 let queue=people.map(p=>p.id);const initial=[...queue];const byId=new Map(people.map(p=>[p.id,p]));
 const picks=new Map<number,{id:string;reason:string;locked:boolean}>();const counts=new Map(people.map(p=>[p.id,0]));const conflicts:string[]=[];
 const rotate=(id:string)=>{queue=queue.filter(x=>x!==id);queue.push(id);};
 for(let rank=0;rank<Math.max(0,...people.map(p=>p.preferred.length));rank++){
  const visited=new Set<string>();
  while(true){const id=queue.find(x=>!visited.has(x));if(!id)break;visited.add(id);const p=byId.get(id)!;const day=p.preferred[rank];
   if(day===undefined||picks.has(day)||(counts.get(id)??0)>=p.preferred.length)continue;
   const contenders=people.filter(q=>q.preferred[rank]===day&&!visited.has(q.id));
   if(contenders.length)conflicts.push(`Ziua ${day}, preferința ${rank+1}: ${[p,...contenders].map(q=>q.name).join(", ")}. Prioritate: ${p.name}.`);
   picks.set(day,{id,reason:`Preferința ${rank+1}`,locked:true});counts.set(id,(counts.get(id)??0)+1);rotate(id);
  }
 }
 const candidates=(id:string)=>{const p=byId.get(id)!;return [...p.preferred,...p.available].filter(d=>!picks.get(d)?.locked).sort((a,b)=>{
  const scarcity=(day:number)=>people.filter(q=>[...q.preferred,...q.available].includes(day)).length;
  return scarcity(a)-scarcity(b)||a-b;
 });};
 function fill(id:string,seen:Set<number>):boolean{for(const day of candidates(id)){if(seen.has(day))continue;seen.add(day);const occupant=picks.get(day);if(!occupant||(!occupant.locked&&fill(occupant.id,seen))){picks.set(day,{id,reason:"Disponibilitate suplimentară",locked:false});return true;}}return false;}
 let progress=true;
 while(progress){progress=false;for(const id of [...queue]){const p=byId.get(id)!;if((counts.get(id)??0)<p.preferred.length&&fill(id,new Set())){counts.set(id,(counts.get(id)??0)+1);rotate(id);progress=true;}}}
 const allocations=[...picks].sort((a,b)=>a[0]-b[0]).map(([day,p])=>({date:dateKey(month,day),user_id:p.id,points:dayPoints(dateKey(month,day),holidays),reason:p.reason}));
 const uncovered=Array.from({length:monthDays(month)},(_,i)=>i+1).filter(d=>!picks.has(d));
 const deficits=people.filter(p=>(counts.get(p.id)??0)<p.preferred.length).map(p=>({id:p.id,name:p.name,requested:p.preferred.length,assigned:counts.get(p.id)??0}));
 return {allocations,report:{initialQueue:initial,finalQueue:queue,conflicts,uncovered,deficits,requested:people.reduce((n,p)=>n+p.preferred.length,0)}};
}
