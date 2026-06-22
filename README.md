# Danmark · 100 Seværdigheder 🇩🇰

Et interaktivt kort over danske seværdigheder — bygget ud fra plakaten *"Danmark — 100 danske seværdigheder"*.

- ✅ **Kryds af** hvor du har været (med fremgangslinje)
- 🧭 **Planlæg en rute** med start, slut og stop undervejs — ad rigtige veje, med afstand og køretid
- 🍽️ **Find i nærheden** — seværdigheder, restauranter, caféer, bagere m.m. omkring et punkt
- ☁️ **Synkronisér** dine afkrydsninger på tværs af telefon og computer (valgfrit)
- 📱 Virker som **app på hjemskærmen** (PWA)

Alt kører på **gratis, åbne data**: OpenStreetMap (kort), Overpass (steder i nærheden), OSRM (ruter) og Nominatim (geokodning). Ingen API-nøgler nødvendige.

---

## Sådan starter du den

### På Mac (nemmest)
Dobbeltklik **`start.command`**. Den starter en lokal server og åbner appen i din browser.

### Manuelt (Mac/Linux/Windows)
Kør en lokal server i mappen (en almindelig fil-åbning virker ikke pga. browserens sikkerhedsregler):

```bash
cd danmark-100
python3 -m http.server 5173
```

Åbn derefter <http://localhost:5173/index.html>.

---

## Læg den på nettet (så du kan bruge den på mobilen)

Det er en ren statisk side — den kan hostes gratis:

- **Netlify:** træk hele `danmark-100`-mappen ind på <https://app.netlify.com/drop>.
- **GitHub Pages:** push mappen til et repo, og slå Pages til.
- **Vercel:** `vercel` i mappen.

Når den ligger på en `https://`-adresse, kan du på mobilen vælge *"Føj til hjemmeskærm"* og bruge den som en app.

---

## Udgiv offentligt med påkrævet login (trin for trin)

Når en backend er sat op (se afsnittet nedenfor), **kræver appen at man logger ind** for at bruge den — ingen betaling, bare en gratis bruger via e-mail-link. Sådan får du den online og let at gen-udgive:

1. **Opret et GitHub-repo** (gratis konto på <https://github.com>) → *New repository* → fx `danmark-100` → *Public*.
2. **Push koden** (mappen er allerede et git-repo med et commit):
   ```bash
   cd danmark-100
   git remote add origin https://github.com/<dit-brugernavn>/danmark-100.git
   git push -u origin main
   ```
3. **Slå GitHub Pages til:** repoets *Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save.* Efter et øjeblik ligger siden på `https://<dit-brugernavn>.github.io/danmark-100/`.
4. **Sæt backend op** (se næste afsnit) og indsæt nøglerne i `src/config.js`.
5. **Vigtigt — tilladte URL'er i Supabase:** under *Authentication → URL Configuration* sæt *Site URL* og tilføj under *Redirect URLs* din Pages-adresse (`https://<dit-brugernavn>.github.io/danmark-100/`). Ellers virker login-linket ikke.

**Gen-udgivelse senere** (når vi får nye idéer): ret koden, og kør:
```bash
git add -A && git commit -m "ny funktion" && git push
```
GitHub Pages opdaterer siden automatisk. (Den offentlige `anon`-nøgle må gerne ligge i repoet — den er designet til at være offentlig, og sikkerheden ligger i SQL-reglerne.)

---

## Del med familien / sync mellem enheder (valgfrit)

Uden opsætning gemmes dine afkrydsninger **lokalt i browseren** (kun på din enhed). Slår du Supabase til (gratis), får I to ting:

- **Sync:** dine markeringer følger med på tværs af telefon og computer.
- **Familie-kort:** I logger hver især ind, krydser jeres *egne* steder af, og kan se på kortet og i listen **hvem i familien der har været hvor** — med en lille oversigt over hver persons fremgang.

**Sådan slår du det til (3 trin):**

1. **Opret projekt:** gå til <https://supabase.com> og lav et nyt (gratis) projekt.
2. **Kør SQL'en:** åbn *SQL Editor → New query*, indsæt **hele** indholdet af [`supabase-setup.sql`](supabase-setup.sql) og tryk *Run*. Det opretter tabeller + sikkerhedsregler, så hver person kun kan ændre sine egne afkrydsninger, men familien kan se hinandens.
3. **Indsæt nøgler:** under *Project Settings → API* finder du *Project URL* og *anon public*-nøglen. Sæt dem ind i **`src/config.js`**:

   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "ey...";
   ```

**Vigtigt — slå e-mail-bekræftelse fra** (så login med kodeord virker uden at sende mails): i Supabase under *Authentication → Sign In / Providers → Email* → slå **"Confirm email" FRA** → Save. Login bruger e-mail + kodeord (ingen e-mails sendes, så ingen rate-limit).

**Sådan bruger familien det:**

1. Åbn appen → **opret en bruger** med e-mail + selvvalgt kodeord (eller log ind, hvis man har en) → vælg navn + farve.
2. Tryk **👪 Familie** → **Opret en familie** og giv den et navn → du får en **6-tegns kode**.
3. Del koden med familien. De opretter sig og vælger **"Deltag med kode"**.
4. Alle krydser deres egne steder af. På kortet/​listen vises de andres initialer ved de steder, de har besøgt, og under **👪 Familie** ser I hver persons tæller.

> Live-opdatering når andre krydser af kræver linjen `alter publication … add table visits;` (allerede med i SQL-filen); ellers genindlæser man bare siden. Da login bruger kodeord, er Supabase *Redirect URLs* ikke nødvendige.

---

## Tilføj eller ret seværdigheder

Alle steder ligger i **`data/places.json`** — nemt at rette i. Hvert sted ser sådan ud:

```json
{ "id": "kronborg-slot", "name": "Kronborg Slot", "region": "Helsingør, Sjælland",
  "category": "slot", "lat": 56.039, "lng": 12.621 }
```

Kategorier: `slot, kirke, natur, museum, strand, by, taarn, forlystelse, sevaerdighed`.

Du kan også tilføje steder direkte i appen med **"＋ Tilføj eget sted"** (knappen kan endda slå koordinater op ud fra navnet). Egne steder gemmes lokalt i browseren.

### Status på de 100
Datasættet indeholder **alle 100** seværdigheder fra plakaten (jf. den officielle liste på beenposter.dk), hver med præcise koordinater fra OpenStreetMap. Vil du tilføje flere egne steder, så brug `data/places.json` eller "＋ Tilføj eget sted" i appen.

---

## Teknik
Ren HTML/CSS/JS uden byggetrin. Biblioteker hentes via CDN (Leaflet, Supabase). Geokodning lavet med `geocode.py` (kan køres igen for at opdatere koordinater).
