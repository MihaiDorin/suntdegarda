import { useState, type FormEvent } from "react";
import { CalendarDays, LockKeyhole, Mail, Eye, EyeOff } from "lucide-react";
import { ADMIN_EMAIL } from "@/lib/team";
import { api } from "./api";

export type DoctorProfile = { id: string; name: string; registered: number; administrator: number };
type AuthData = { doctors: DoctorProfile[]; setupComplete: boolean; emailReady: boolean };
const rememberedKey = "garda.remembered-doctor.v2";
function rememberedName(doctors: DoctorProfile[]) {
  try { return doctors.find(d => d.id === localStorage.getItem(rememberedKey))?.name ?? ""; }
  catch { return ""; }
}
function rememberDoctor(id: string) {
  try { localStorage.setItem(rememberedKey, id); } catch { /* Private browsing can disable storage. */ }
}

export function Auth({ data, setupToken, resetToken, onDone, loadError }: { data: AuthData; setupToken: string; resetToken: string; onDone: () => Promise<void>; loadError: string }) {
  const owner = data.doctors.find(d => d.administrator);
  const [doctorName, setDoctorName] = useState(() => setupToken && !data.setupComplete ? owner?.name ?? "" : rememberedName(data.doctors));
  const [mode, setMode] = useState("login"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [show, setShow] = useState(false);
  const selected = data.doctors.find(d => d.name === doctorName);
  const setup = !!setupToken && !data.setupComplete;
  const effective = resetToken ? "reset" : setup ? "setup" : mode === "forgot" ? "forgot" : selected && !selected.registered ? selected.administrator ? "owner-needed" : "register" : "login";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Read the native field too: password managers can autofill without a React change event.
    const doctor = data.doctors.find(d => d.name === String(form.get("username") ?? doctorName));
    if (!["forgot", "reset"].includes(effective) && !doctor) { setError("Selectează numele tău din lista de medici."); return; }
    if (effective === "owner-needed") return;
    const action = effective === "login" && doctor && !doctor.registered ? "register" : effective;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api(action, { doctor_id: doctor?.id, email: action === "setup" ? ADMIN_EMAIL : form.get("email"), password: form.get("password"), token: action === "setup" ? setupToken : resetToken });
      if (action === "forgot") setMessage(result.message ?? "Verifică adresa de email.");
      else {
        if (doctor) rememberDoctor(doctor.id);
        if (action === "reset") { setMessage("Parola a fost schimbată. Te poți autentifica."); setMode("login"); }
        await onDone();
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const titles: Record<string, string> = { login: "Bine ai venit", register: "Activează contul tău", forgot: "Ai uitat parola?", reset: "Alege o parolă nouă", setup: "Configurează administratorul", "owner-needed": "Contul administratorului" };
  const descriptions: Record<string, string> = { login: "Alege medicul și introdu parola. Browserul îți poate salva datele de autentificare.", register: "La prima accesare, adaugă emailul de recuperare și alege parola.", forgot: "Introdu emailul de recuperare asociat contului tău.", reset: "Linkul poate fi folosit o singură dată.", setup: "Pecie Mihai este singurul administrator al echipei.", "owner-needed": "Folosește linkul privat de configurare pentru contul Pecie Mihai." };
  return <div className="auth-shell">
    <header><div className="brand"><span className="brand-mark"><CalendarDays size={25}/></span><span>Garda<span className="brand-sub">Programarea gărzilor</span></span></div></header>
    <main className="auth-layout">
      <section className="auth-intro"><span className="auth-tag"><CalendarDays size={17}/>Calendarul echipei medicale</span><h1>Gărzile tale.<br/><span>În ordinea ta.</span></h1><p>Vezi cine este de gardă, alege zilele preferate și consultă programul echipei.</p><div className="auth-rule"><span className="rule-step">01</span><span>Alege numele tău din echipă</span></div><div className="auth-rule"><span className="rule-step">02</span><span>Activează contul la prima accesare</span></div><div className="auth-rule"><span className="rule-step">03</span><span>Revino cu numele și parola salvate</span></div></section>
      <section className="auth-panel panel"><div className="auth-icon"><LockKeyhole size={24}/></div><h2>{titles[effective]}</h2><p className="muted">{descriptions[effective]}</p>
        {(error || loadError) && <div className="alert error" role="alert">{error || loadError}</div>}
        {message && <div className="alert success" role="status">{message}</div>}
        {!data.setupComplete && !setup && <div className="alert">Administratorul trebuie să configureze contul său înainte de activarea celorlalți medici.</div>}
        <form onSubmit={submit}>
          {!["forgot", "reset"].includes(effective) && <label>Medicul<input id="garda-username" name="username" list="garda-doctors" autoComplete="username" value={setup ? owner?.name ?? "" : doctorName} readOnly={setup} onChange={event => { setDoctorName(event.target.value); setError(""); setMessage(""); }} placeholder="Alege numele din listă" required/><datalist id="garda-doctors">{data.doctors.map(d => <option key={d.id} value={d.name}/>)}</datalist></label>}
          {["register", "setup", "forgot"].includes(effective) && <label>{effective === "forgot" ? "Email de recuperare" : "Adresă de email pentru recuperarea parolei"}<input name="email" type="email" required autoComplete="email" defaultValue={effective === "setup" ? ADMIN_EMAIL : ""} readOnly={effective === "setup"} placeholder="nume@exemplu.ro"/></label>}
          {!["forgot", "owner-needed"].includes(effective) && <label>Parolă<div className="password-input"><input name="password" type={show ? "text" : "password"} required minLength={effective === "login" ? 1 : 10} maxLength={128} autoComplete={effective === "login" ? "current-password" : "new-password"} placeholder={effective === "login" ? "Parola ta" : "Minimum 10 caractere"}/><button type="button" aria-label={show ? "Ascunde parola" : "Arată parola"} onClick={() => setShow(!show)}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>}
          {effective === "login" && <button type="button" className="text-btn forgot" onClick={() => { setMode("forgot"); setError(""); }}>Am uitat parola</button>}
          {effective !== "owner-needed" && <button className="btn primary full" disabled={busy || effective !== "reset" && effective !== "forgot" && !data.setupComplete && !setup}>{busy ? "Se procesează…" : effective === "login" ? "Autentificare" : effective === "register" ? "Activează contul" : effective === "setup" ? "Configurează echipa" : effective === "forgot" ? "Trimite linkul de resetare" : "Salvează parola"}</button>}
        </form>
        {effective === "forgot" && !data.emailReady && <p className="recovery-note"><Mail size={16}/>Trimiterea emailurilor nu este activată încă. Administratorul poate genera un link de resetare.</p>}
        {!setupToken && !resetToken && <div className="auth-switch">{mode === "forgot" ? <button className="text-btn" onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Înapoi la autentificare</button> : <span>Nu ești în listă? Solicită administratorului să te adauge.</span>}</div>}
      </section>
    </main><footer className="auth-footer">Garda · Acces pe laptop, Android și iPhone</footer>
  </div>;
}
