# Sunt de gardă

Aplicația de programare a gărzilor, pregătită pentru **GitHub → Cloudflare Workers Builds**. Funcționează în browser, pe laptop și telefon. Codul este în GitHub; conturile, preferințele și programele sunt în Cloudflare D1.

## Funcții incluse

- Conturi cu email și parolă, aprobate de administrator.
- Calendar anual și deschiderea/închiderea înscrierilor pe luni.
- Preferințe ordonate și cel puțin tot atâtea zile suplimentare disponibile.
- Repartizare pe baza punctajului și rotației priorității la conflicte.
- Punctaje de 1 pentru zile lucrătoare, 2 pentru weekend, 3 pentru sărbători.
- Previzualizarea programului, zilelor neacoperite și punctajelor înainte de publicare.
- Program definitiv și schimburi acceptate sau refuzate de colegi, cu notificări în aplicație.
- Confirmarea gărzilor efectuate și actualizarea punctajelor o singură dată.
- Resetarea parolei de către administrator; recuperarea prin email poate fi activată separat.

## Publicare în Cloudflare

### Dacă încarci proiectul din arhivă

1. Extrage arhiva ZIP pe calculator.
2. Deschide [repository-ul](https://github.com/MihaiDorin/suntdegarda) → **Add file → Upload files**.
3. Trage în pagină **toate fișierele și directoarele din interiorul arhivei extrase**, inclusiv fișierele care încep cu punct. Nu încărca ZIP-ul sau directorul exterior care îl conține.
4. Confirmă cu **Commit changes** pe `main`. Noul `README.md` îl înlocuiește pe cel inițial.
5. Verifică să vezi `package.json`, `wrangler.json` și `pnpm-lock.yaml` direct în rădăcina repository-ului. Continuă cu pașii de mai jos.

### 1. Alege repository-ul

Deschide [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → opțiunea de import/conectare GitHub pentru un **Worker**.

Alege **MihaiDorin/suntdegarda**. Dacă ai creat deja un Worker, deschide **Settings → Build/Builds → Connect** și conectează acest repository.

### 2. Completează setările de build

| Câmp | Valoare |
| --- | --- |
| Worker name / Project name | `suntdegarda` |
| Production branch | `main` |
| Root directory | rădăcina repository-ului; lasă câmpul gol |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy` |
| Build variable `PNPM_VERSION` | `11.25.0` |
| Build variable `NODE_VERSION` | `22` |

Numele Worker-ului trebuie să fie **suntdegarda**, identic cu `name` din `wrangler.json`. Fișierul `.node-version` selectează și el Node 22.

Păstrează instalarea automată a dependențelor activată. Dezactivează pentru început build-urile pentru alte ramuri/preview; acestea necesită configurarea unei baze separate pentru testare.

### 3. Publică proiectul

Apasă **Deploy**. După build, Cloudflare afișează adresa aplicației de forma `https://suntdegarda.<subdomeniul-contului>.workers.dev`.

Baza ta existentă este deja configurată în `wrangler.json`:

| Setare D1 | Valoare |
| --- | --- |
| Binding | `DB` |
| Database name | `suntdegarda-db-b74f6760c825` |
| Database ID | `f8df57c5-4b5c-44cc-b54a-370a70371a02` |

Selectează contul Cloudflare în care ai creat această bază. La prima cerere API, aplicația creează automat tabelele lipsă cu `CREATE TABLE IF NOT EXISTS`. Nu trebuie să rulezi SQL manual. Înregistrările deja existente nu sunt șterse sau înlocuite.

### 4. Adaugă cheile private

În Worker → **Settings → Variables and Secrets**, adaugă **două Secrets pentru runtime**:

| Nume | Valoare |
| --- | --- |
| `AUTH_SECRET` | cheia din fișierul privat de configurare primit în conversație |
| `BOOTSTRAP_TOKEN` | tokenul din același fișier |

Salvează/publică modificarea din Cloudflare. Aceste chei trebuie configurate în **Variables and Secrets**, nu numai în **Build variables and secrets**. Nu le încărca în GitHub.

Păstrează cheia `AUTH_SECRET` originală: parolele existente depind de ea. Configurația `keep_vars` păstrează și variabilele setate în dashboard la publicările viitoare.

### 5. Intră în aplicație

- Dacă D1 conține deja contul de administrator, folosește emailul și parola existente.
- Dacă D1 este goală, deschide linkul de configurare din fișierul privat, înlocuind adresa exemplu cu adresa afișată de Cloudflare. Creează contul administratorului, apoi ceilalți medici își pot crea conturile.

**Publicarea din GitHub nu copiază automat datele din aplicația veche.** Proiectul folosește datele care există în baza D1 indicată mai sus. Nu presupune că încercările anterioare de import au reușit; verifică utilizatorii și lunile după autentificare. Aplicația veche nu este modificată de acest proiect.

## Actualizări

Modificările trimise pe `main` declanșează un nou build și deploy în Cloudflare. Codul se actualizează folosind aceeași bază D1. Păstrează ID-ul bazei și `AUTH_SECRET`; nu recrea baza pentru o actualizare de cod.

Modificările viitoare ale structurii datelor trebuie realizate prin migrări care păstrează înregistrările. Inițializarea inclusă aici creează schema actuală; nu înlocuiește o strategie de migrare pentru coloane noi.

## Recuperarea parolei prin email

Pentru trimiterea emailurilor, configurează un cont [Resend](https://resend.com/), un expeditor verificat și apoi, în **runtime Variables and Secrets**:

- `RESEND_API_KEY` ca Secret.
- `MAIL_FROM` ca variabilă sau Secret, cu expeditorul verificat în Resend.

Până atunci, administratorul poate genera din aplicație un link de resetare. Linkurile folosesc adresa curentă a aplicației; nu este necesar să copiezi vechea adresă Sites în `SITE_ORIGIN`.

## Dezvoltare și verificare

Proiectul folosește React, Vite, TypeScript și Cloudflare Workers cu D1. Nu necesită server Node permanent sau infrastructura Sites.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```

Pentru dezvoltare, copiază `.dev.vars.example` în `.dev.vars`, completează chei locale de test și rulează `pnpm dev`. Baza D1 locală este separată de cea de producție. Fișierele cu chei și `node_modules` sunt excluse din Git.

Testele API folosesc conturi fictive și D1 local: configurare administrator, roluri, înscrieri, confidențialitate, previzualizare, generare, publicare, schimburi, punctaje și resetări. Build-ul și verificarea `wrangler deploy --dry-run` validează pachetul fără a publica în contul tău.

Această versiune are autentificare prin email/parolă și interfață web adaptată telefonului. Autentificarea Google/Apple/Facebook și pachetele native APK/iOS pot fi dezvoltate ulterior.

## Documentație Cloudflare

- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Configurarea build-ului și variabilelor](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Versiuni Node și pnpm](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
- [React + Vite pe Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
