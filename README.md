# Sunt de gardă

Aplicația de programare a gărzilor, pregătită pentru **GitHub → Cloudflare Workers Builds**. Funcționează în browser, pe laptop și telefon. Codul este în GitHub; conturile, preferințele și programele sunt în Cloudflare D1.

## Funcții incluse

- Un singur administrator: Pecie Mihai, cu adresa `pmihaidorin@gmail.com`.
- Listă de medici gestionată exclusiv de administrator.
- Prima accesare: alegerea medicului, email de recuperare și parolă. Ulterior: numele medicului și parola, cu suport pentru salvarea în browser.
- Calendarul lunii în curs ca pagină inițială, cu medicul de gardă în fiecare zi.
- Zile rotunjite: roșu pastel pentru nealese, verde pentru preferate, albastru pentru disponibilitate.
- Resetarea tuturor conturilor fără pierderea gărzilor, preferințelor sau punctajelor.
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

Selectează contul Cloudflare în care ai creat această bază. La prima cerere API, aplicația creează automat tabelele lipsă cu `CREATE TABLE IF NOT EXISTS`. Nu trebuie să rulezi SQL manual. Actualizarea listei medicilor păstrează identificatorii, gărzile, preferințele și punctajele existente. Conturile din afara listei noi sunt arhivate și nu mai au acces. Parolele se șterg numai din acțiunea explicită de resetare descrisă mai jos.

### 4. Adaugă cheile private

În Worker → **Settings → Variables and Secrets**, adaugă **două Secrets pentru runtime**:

| Nume | Valoare |
| --- | --- |
| `AUTH_SECRET` | cheia din fișierul privat de configurare primit în conversație |
| `BOOTSTRAP_TOKEN` | tokenul din același fișier |

Salvează/publică modificarea din Cloudflare. Aceste chei trebuie configurate în **Variables and Secrets**, nu numai în **Build variables and secrets**. Nu le încărca în GitHub.

Păstrează cheia `AUTH_SECRET` originală: parolele existente depind de ea. Configurația `keep_vars` păstrează și variabilele setate în dashboard la publicările viitoare.

### 5. Intră în aplicație

Adresa actuală a aplicației este [suntdegarda.baneasa.workers.dev](https://suntdegarda.baneasa.workers.dev/).

- Dacă ai deja contul cu adresa `pmihaidorin@gmail.com`, alege **Pecie Mihai** în câmpul „Medicul” și folosește parola existentă. Emailul nu se mai folosește la autentificare.
- Dacă administratorul nu este încă configurat, deschide linkul privat de configurare primit în conversație, cu **adresa actuală a aplicației** înainte de `/?setup=…`. Contul este fixat pe Pecie Mihai și `pmihaidorin@gmail.com`; alegi numai parola.
- Ceilalți medici selectează numele lor din listă. La prima accesare completează emailul de recuperare și parola. La accesările următoare introduc doar numele și parola.
- Chrome poate propune salvarea numelui și parolei. Acceptă propunerea în propriul browser; aplicația reține local medicul autentificat, fără să salveze parola în `localStorage`.

### 6. Resetează conturile vechi o singură dată

1. Autentifică-te ca **Pecie Mihai** cu parola existentă.
2. Deschide **Administrare**. În secțiunea **Resetarea tuturor conturilor**, apasă **Resetează toate conturile** și confirmă.
3. Se șterg parolele și emailurile de recuperare ale tuturor medicilor, iar toate sesiunile și linkurile de resetare a parolei sunt invalidate. Emailul tău de administrator rămâne rezervat. Gărzile, înscrierile, punctajele și lista medicilor se păstrează.
4. Aplicația te duce automat la configurarea contului tău. Alege noua parolă înainte de a închide pagina. Linkul privat creat de această operație este valabil **o oră** și se invalidează la configurare. Dacă îl pierzi sau expiră, poți folosi linkul privat bazat pe `BOOTSTRAP_TOKEN` din configurarea Cloudflare.
5. După configurarea ta, fiecare medic își activează din nou contul din lista de autentificare.

Lista inițială este: Pecie Mihai, Mohammad Al Marazgh, Pirvulescu Cristina, Stanila Ana, Toma Andrei, Roman Rares, Poenaru Radu, Vijiiac Cristi și Budescu Diana. Poți adăuga ulterior medici din formularul **Adaugă medic** din Administrare. Un medic suspendat nu se poate autentifica și nu apare în lista publică.

**Parolele deja memorate de Chrome nu se șterg de pe server.** Deschide în Chrome meniul → **Parole și completare automată → Manager de parole Google**, caută vechile adrese ale aplicației și șterge intrările pe care nu le mai folosești. Repetă operația pe fiecare profil/browser relevant.

**Publicarea din GitHub nu copiază automat datele din aplicația veche.** Proiectul folosește datele care există în baza D1 indicată mai sus. Nu presupune că încercările anterioare de import au reușit; verifică utilizatorii și lunile după autentificare. Aplicația veche nu este modificată de acest proiect.

## Actualizări

Dacă Workers Builds este conectat la repository și ramura de producție este `main`, modificările trimise pe `main` declanșează un nou build și deploy în Cloudflare. Codul se actualizează folosind aceeași bază D1. Păstrează ID-ul bazei și `AUTH_SECRET`; nu recrea baza pentru o actualizare de cod.

Modificările viitoare ale structurii datelor trebuie realizate prin migrări care păstrează înregistrările. Inițializarea inclusă aici creează tabelele lipsă și adaugă idempotent coloana `listed` la baza existentă. Nu este necesar un import sau SQL manual pentru această actualizare.

Dacă nu pornește automat publicarea: deschide Worker-ul **suntdegarda → Settings → Build/Builds**, verifică repository-ul `MihaiDorin/suntdegarda`, ramura `main`, comanda de build `pnpm run build` și deploy `pnpm run deploy`. Din istoricul build-urilor pornește/reîncearcă publicarea pentru ultimul commit din `main`. Așteaptă succesul **deploy**, apoi reîncarcă aplicația cu **Ctrl + Shift + R**. Nu recrea Worker-ul sau baza D1.

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

Testele API folosesc conturi fictive și D1 local: configurare administrator unic, activarea medicilor din listă, interdicția autoînregistrării în afara listei, suspendare, migrarea sigură a conturilor vechi, resetarea accesului cu păstrarea programărilor, roluri, înscrieri, confidențialitate, previzualizare, generare, publicare, schimburi, punctaje și resetări. Build-ul și verificarea `wrangler deploy --dry-run` validează pachetul fără a publica în contul tău.

Această versiune are autentificare prin numele medicului și parolă și interfață web adaptată telefonului. Autentificarea Google/Apple/Facebook și pachetele native APK/iOS pot fi dezvoltate ulterior.

## Documentație Cloudflare

- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Configurarea build-ului și variabilelor](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Versiuni Node și pnpm](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
- [React + Vite pe Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
