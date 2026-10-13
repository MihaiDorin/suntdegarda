import { dateKey, monthDays, dayPoints, shiftDate } from "./calendar";
export type Participant={id:string;name:string;points:number;preferred:number[];available:number[]};
export type Allocation={date:string;user_id:string;points:number;reason:string};
export type AllocationStep={kind:"start"|"round"|"assigned"|"skipped"|"finish";stage?:"preferred"|"available"|"forced"|"saved";rank?:number;day?:number;doctorId?:string;contenders?:string[];explanation:string;queue:string[];allocations:Allocation[]};
export type AllocationOptions={boundary?:Pick<Allocation,"date"|"user_id">[];locked?:Allocation[];force?:boolean;refused?:string[];holidayPoints?:Record<string,number>;trace?:boolean};
export function allocate(month:string,input:Participant[],holidays:Record<string,string>,options:AllocationOptions={}){
 const people=[...input].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,"ro")||a.id.localeCompare(b.id));
 let queue=people.map(p=>p.id);const initial=[...queue],byId=new Map(people.map(p=>[p.id,p]));
 const picks=new Map<number,{id:string;reason:string}>(),counts=new Map(people.map(p=>[p.id,0])),conflicts:string[]=[];
 const boundary=new Map((options.boundary??[]).map(s=>[s.date,s.user_id])),refused=new Set(options.refused??[]);
 for(const s of options.locked??[]){if(s.date.slice(0,7)!==month)continue;const day=Number(s.date.slice(8));picks.set(day,{id:s.user_id,reason:s.reason});counts.set(s.user_id,(counts.get(s.user_id)??0)+1);}
 const rotate=(id:string)=>{queue=queue.filter(x=>x!==id);queue.push(id);};
 const eligible=(id:string,day:number)=>{if(day<1||day>monthDays(month)||picks.has(day)||refused.has(dateKey(month,day)+":"+id))return false;const date=dateKey(month,day);return picks.get(day-1)?.id!==id&&picks.get(day+1)?.id!==id&&boundary.get(shiftDate(date,-1))!==id&&boundary.get(shiftDate(date,1))!==id;};
 const take=(id:string,day:number,reason:string)=>{picks.set(day,{id,reason});counts.set(id,(counts.get(id)??0)+1);rotate(id);};
 const steps:AllocationStep[]=[],limitExplained=new Set<string>();
 const snapshot=()=>[...picks].sort((a,b)=>a[0]-b[0]).map(([day,p])=>({date:dateKey(month,day),user_id:p.id,points:dayPoints(dateKey(month,day),holidays,options.holidayPoints),reason:p.reason}));
 const record=(step:Omit<AllocationStep,"queue"|"allocations">)=>{if(options.trace)steps.push({...step,queue:[...queue],allocations:snapshot()});};
 const blockedReason=(id:string,day:number)=>{
  if(day<1||day>monthDays(month))return "Ziua nu aparține acestei luni.";
  const occupied=picks.get(day);if(occupied)return "Ziua este deja atribuită lui "+(byId.get(occupied.id)?.name??"altui medic")+" ("+occupied.reason.toLowerCase()+").";
  if(refused.has(dateKey(month,day)+":"+id))return "Medicul a refuzat această zi.";
  const date=dateKey(month,day),adjacent=[-1,1].find(delta=>picks.get(day+delta)?.id===id||boundary.get(shiftDate(date,delta))===id);
  return adjacent!==undefined?"Ar rezulta două gărzi consecutive: "+shiftDate(date,adjacent)+" și "+date+". Această alegere este sărită.":"Ziua nu poate fi atribuită.";
 };
 record({kind:"start",explanation:"Pornim de la punctajele actuale, în ordine descrescătoare. La egalitate se folosește numele. După fiecare gardă atribuită, medicul trece la finalul cozii, fără să i se scadă puncte."});
 // Every doctor's first preference is processed before the second tier;
 // availability tiers follow the four preference tiers.
 for(const stage of ["preferred","available"] as const){
  for(let position=0;position<Math.max(0,...people.map(p=>p[stage].length));position++){const visited=new Set<string>();
   if(options.trace&&people.some(p=>p[stage][position]!==undefined&&(counts.get(p.id)??0)<p.preferred.length))record({kind:"round",stage,rank:position+1,explanation:stage==="preferred"?"Analizăm preferința "+(position+1)+" a fiecărui medic, în ordinea actuală a cozii.":"Preferințele au fost parcurse. Analizăm disponibilitatea "+(position+1)+" pentru medicii care mai au gărzi de primit."});
   while(true){const id=queue.find(id=>!visited.has(id));if(!id)break;visited.add(id);const p=byId.get(id)!;
    if((counts.get(id)??0)>=p.preferred.length){if(options.trace&&p[stage][position]!==undefined&&!limitExplained.has(id)){limitExplained.add(id);record({kind:"skipped",stage,rank:position+1,doctorId:id,explanation:p.name+" are deja cele "+p.preferred.length+" gărzi solicitate; alegerile rămase nu mai sunt folosite."});}continue;}
    const day=p[stage][position];if(day===undefined)continue;
    if(!eligible(id,day)){if(options.trace)record({kind:"skipped",stage,rank:position+1,day,doctorId:id,explanation:p.name+" · "+(stage==="preferred"?"preferința ":"disponibilitatea ")+(position+1)+", ziua "+day+": "+blockedReason(id,day)});continue;}
    const rank=position+1;
    const contenders=stage==="preferred"?people.filter(other=>other.id!==id&&other.preferred.includes(day)&&(counts.get(other.id)??0)<other.preferred.length):[];
    if(contenders.length)conflicts.push("Ziua "+day+": "+[p,...contenders].map(q=>q.name).join(", ")+". Prioritate în această rundă: "+p.name+".");
    take(id,day,(stage==="preferred"?"Preferința ":"Disponibilitate ")+rank);
    record({kind:"assigned",stage,rank,day,doctorId:id,contenders:contenders.map(q=>q.id),explanation:"Ziua "+day+" este atribuită lui "+p.name+" — "+(stage==="preferred"?"preferința ":"disponibilitatea ")+rank+"."+(contenders.length?" Aceeași zi apare și între preferințele lui "+contenders.map(q=>q.name).join(", ")+"; "+p.name+" este analizat primul în această rundă.":"")+" Medicul trece la finalul cozii ("+(counts.get(id)??0)+"/"+p.preferred.length+" gărzi)."});
   }
  }
 }
 if(options.force){
  let bottom=[...people].sort((a,b)=>a.points-b.points||a.name.localeCompare(b.name,"ro")||a.id.localeCompare(b.id)).map(p=>p.id);
  for(let day=1;day<=monthDays(month);day++){if(picks.has(day))continue;const id=bottom.find(id=>eligible(id,day));if(!id)continue;take(id,day,"Repartizare automată din coada clasamentului");bottom=bottom.filter(x=>x!==id);bottom.push(id);record({kind:"assigned",stage:"forced",day,doctorId:id,explanation:"Ziua "+day+" este repartizată automat lui "+byId.get(id)!.name+", din coada clasamentului, fără gărzi consecutive."});}
 }
 const allocations=[...picks].sort((a,b)=>a[0]-b[0]).map(([day,p])=>({date:dateKey(month,day),user_id:p.id,points:dayPoints(dateKey(month,day),holidays,options.holidayPoints),reason:p.reason}));
 const uncovered=Array.from({length:monthDays(month)},(_,i)=>i+1).filter(d=>!picks.has(d));
 record({kind:"finish",explanation:"Am ajuns la aceeași repartizare ca în Live: "+allocations.length+" zile acoperite."+(uncovered.length?" Rămân neacoperite: "+uncovered.join(", ")+". Nu se atribuie automat cât timp înscrierile sunt deschise.":" Toate zilele sunt acoperite.")});
 const deficits=people.filter(p=>(counts.get(p.id)??0)<p.preferred.length).map(p=>({id:p.id,name:p.name,requested:p.preferred.length,assigned:counts.get(p.id)??0}));
 return {allocations,steps,report:{initialQueue:initial,finalQueue:queue,conflicts,uncovered,deficits,requested:people.reduce((n,p)=>n+p.preferred.length,0)}};
}
