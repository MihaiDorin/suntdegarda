export const monthNames = ["ianuarie","februarie","martie","aprilie","mai","iunie","iulie","august","septembrie","octombrie","noiembrie","decembrie"];
export const monthTitle = (id:string) => `${monthNames[Number(id.slice(5))-1]} ${id.slice(0,4)}`;
export const monthDays = (id:string) => new Date(Date.UTC(Number(id.slice(0,4)),Number(id.slice(5)),0)).getUTCDate();
export const dateKey = (month:string, day:number) => `${month}-${String(day).padStart(2,"0")}`;
export const todayRO = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Bucharest",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export const dateLabel = (date:string) => new Intl.DateTimeFormat("ro-RO",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
export function orthodoxEaster(year:number) { const a=year%4,b=year%7,c=year%19,d=(19*c+15)%30,e=(2*a+4*b-d+34)%7; const m=Math.floor((d+e+114)/31),day=((d+e+114)%31)+1; const delta=Math.floor(year/100)-Math.floor(year/400)-2; return new Date(Date.UTC(year,m-1,day+delta)); }
export function defaultHolidays(year:number):Record<string,string> {
 const out:Record<string,string>={};
 const fixed:Record<string,string>={"01-01":"Anul Nou","01-02":"Anul Nou","01-06":"Boboteaza","01-07":"Sfântul Ioan","01-24":"Unirea Principatelor","05-01":"Ziua Muncii","06-01":"Ziua Copilului","08-15":"Adormirea Maicii Domnului","11-30":"Sfântul Andrei","12-01":"Ziua Națională","12-25":"Crăciun","12-26":"Crăciun","12-31":"Revelion (regula echipei)"};
 for(const [d,label] of Object.entries(fixed))out[`${year}-${d}`]=label;
 const easter=orthodoxEaster(year);
 for(const [offset,label] of [[-2,"Vinerea Mare"],[0,"Paște"],[1,"A doua zi de Paște"],[49,"Rusalii"],[50,"A doua zi de Rusalii"]] as const){const d=new Date(easter);d.setUTCDate(d.getUTCDate()+offset);out[d.toISOString().slice(0,10)]=label;}
 return out;
}
export function holidayMap(year:number,overrides:{date:string;label:string;enabled:number}[]=[]){const map=defaultHolidays(year);for(const h of overrides)if(h.enabled)map[h.date]=h.label;else delete map[h.date];return map;}
export function dayPoints(date:string,holidays:Record<string,string>){if(holidays[date])return 3;const day=new Date(date+"T12:00:00Z").getUTCDay();return day===0||day===6?2:1;}
export function validateSelection(month:string,preferred:number[],available:number[]) {
 const days=monthDays(month), all=[...preferred,...available];
 if(preferred.length>Math.floor(days/2))throw new Error(`Poți solicita maximum ${Math.floor(days/2)} gărzi, pentru a păstra același număr de zile suplimentare.`);
 if(all.some(d=>!Number.isInteger(d)||d<1||d>days)||new Set(all).size!==all.length)throw new Error("Selectează zile distincte, valide pentru luna aleasă.");
 if(available.length<preferred.length)throw new Error(`Mai selectează ${preferred.length-available.length} zile suplimentare de disponibilitate.`);
}
