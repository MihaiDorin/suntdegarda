import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { ADMIN_EMAIL } from "./team";
export type User={id:string;email:string;name:string;role:string;active:number;base_points:number;password:string;created:string;listed:number};
export const isAdmin=(user:Pick<User,"email"|"role">)=>user.role==="admin"&&user.email.toLowerCase()===ADMIN_EMAIL;
export function db():D1Database {const binding=(env as unknown as {DB?:D1Database}).DB;if(!binding)throw new Error("Baza de date nu este disponibilă momentan.");return binding;}
export const runtime=(key:string)=>String((env as unknown as Record<string,unknown>)[key]??process.env[key]??"");
export const uuid=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export const randomToken=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export async function digest(value:string){return Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))).toString("hex");}
export async function hashPassword(password:string,salt=randomToken()){
 const secret=runtime("AUTH_SECRET");if(!secret)throw new Error("Autentificarea nu este configurată.");
 const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(password+secret),"PBKDF2",false,["deriveBits"]);
 const bytes=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:100000,hash:"SHA-256"},material,256);
 return `pbkdf2$100000$${salt}$${Buffer.from(bytes).toString("hex")}`;
}
export function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export async function passwordOK(password:string,encoded:string){const salt=encoded.split("$")[2];if(!salt)return false;return equal(await hashPassword(password,salt),encoded);}
export async function currentUser(request:Request):Promise<User|null>{const match=request.headers.get("cookie")?.match(/(?:^|;\s*)garda_session=([^;]+)/);if(!match)return null;return db().prepare("SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.listed=1 AND u.active=1 AND u.password<>''").bind(await digest(match[1]),Date.now()).first<User>();}
export function cookie(token:string,request:Request,expired=false){return `garda_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${expired?0:604800}${new URL(request.url).protocol==="https:"?"; Secure":""}`;}
export async function session(userId:string,request:Request){const token=randomToken();await db().prepare("INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)").bind(await digest(token),userId,Date.now()+604800000).run();return cookie(token,request);}
export class AppError extends Error {constructor(message:string,public status=400){super(message);}}
export function fail(message:string,status=400):never{throw new AppError(message,status);}
export async function rateLimit(request:Request,scope:string,max=30){const ip=request.headers.get("cf-connecting-ip")??"local";const id=await digest(`${scope}:${ip}`);const t=Date.now(),expires=t+900000;const row=await db().prepare("INSERT INTO limits (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN limits.expires<? THEN 1 ELSE limits.count+1 END, expires=CASE WHEN limits.expires<? THEN excluded.expires ELSE limits.expires END RETURNING count").bind(id,expires,t,t).first<{count:number}>();if(row&&row.count>max)fail("Prea multe încercări. Reîncearcă peste 15 minute.",429);}
export function notification(userId:string,message:string){return db().prepare("INSERT INTO notifications (id,user_id,message,read,created) VALUES (?,?,?,0,?)").bind(uuid(),userId,message,now());}
export function audit(userId:string,action:string){return db().prepare("INSERT INTO audit (id,user_id,action,created) VALUES (?,?,?,?)").bind(uuid(),userId,action,now());}
export const safeUser=(u:User)=>({id:u.id,email:u.email,name:u.name,role:isAdmin(u)?"admin":"doctor",active:u.active,base_points:u.base_points,listed:u.listed,registered:1});
