import { Buffer } from "node:buffer";
import { db,runtime,fail } from "@/lib/server";

async function encryptionKey(){
 const secret=runtime("AUTH_SECRET");if(!secret)fail("Configurarea autentificării lipsește.",503);
 const material=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("garda:mail-settings:"+secret));
 return crypto.subtle.importKey("raw",material,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function protect(value:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},await encryptionKey(),new TextEncoder().encode(value));
 return Buffer.from(iv).toString("base64url")+"."+Buffer.from(encrypted).toString("base64url");
}
async function reveal(value:string){
 const [iv,encrypted]=value.split(".");
 const decrypted=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(Buffer.from(iv,"base64url"))},await encryptionKey(),Uint8Array.from(Buffer.from(encrypted,"base64url")));
 return new TextDecoder().decode(decrypted);
}
export async function mailConfig(){
 const rows=(await db().prepare("SELECT key,value FROM settings WHERE key IN ('mail.resend.key','mail.from')").all()).results;
 const values=new Map(rows.map(row=>[String(row.key),String(row.value)]));
 return {key:values.has("mail.resend.key")?await reveal(values.get("mail.resend.key")!):runtime("RESEND_API_KEY"),from:values.get("mail.from")??runtime("MAIL_FROM")};
}
export async function mailStatus(){const config=await mailConfig();return {configured:!!(config.key&&config.from),hasKey:!!config.key,from:config.from};}
export async function saveMailConfig(from:string,key:string){
 const existing=await mailConfig();if(!key&&!existing.key)fail("Introdu cheia API Resend.");
 const statements=[db().prepare("INSERT INTO settings(key,value) VALUES('mail.from',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(from)];
 if(key)statements.push(db().prepare("INSERT INTO settings(key,value) VALUES('mail.resend.key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(await protect(key)));
 await db().batch(statements);
}
export async function sendPasswordReset(email:string,link:string){
 const config=await mailConfig();
 if(!config.key||!config.from)fail("Recuperarea prin email necesită activarea serviciului de email în Administrare, o singură dată pentru întreaga echipă.",503);
 const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${config.key}`,"Content-Type":"application/json"},body:JSON.stringify({from:config.from,to:[email],subject:"Garda · Resetarea parolei",text:`Ai solicitat resetarea parolei pentru contul tău Garda.\n\nDeschide acest link în următoarele 30 de minute:\n${link}\n\nLinkul poate fi folosit o singură dată. Dacă nu ai solicitat resetarea, ignoră acest mesaj.`})});
 if(!response.ok){console.error("Password recovery email failed",response.status);fail("Emailul nu a putut fi trimis. Reîncearcă mai târziu. Administratorul poate consulta configurarea serviciului de email.",503);}
}
