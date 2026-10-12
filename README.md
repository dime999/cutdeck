# MultiPost

Lokalna web aplikacija za objavu jednog videa na više YouTube kanala odjednom.
Radi na tvom računaru, besplatna je i nema vanjskih biblioteka: treba ti samo Node.js.

**Šta radi:**

- Povezuje više YouTube kanala, uključujući brand kanale na istom Google nalogu.
- Jednim klikom šalje video na sve označene kanale.
- Postavlja naslov, opis, tagove, kategoriju, vidljivost i oznaku "za djecu", a objavu možeš i zakazati.
- Uploaduje u pozadini i nastavlja prekinut upload od mjesta gdje je stao.
- Ponovo pokušava kad dođe do greške.
- Kad potrošiš dnevnu kvotu, čeka reset kvote.
- Briše lokalnu kopiju videa čim je objavljen na svim kanalima.
- Ima naloge za tebe i prijatelje (uz pozivni kod), a svako vidi samo svoje kanale.
- Pristupe kanalima čuva šifrovano (AES-256-GCM).
- Ima politiku privatnosti i uslove korištenja, potrebne za Google audit.

---

## Korak 0: Instaliraj Node.js

Skini **Node.js 24 LTS** sa <https://nodejs.org> i instaliraj ga. Potrebna je verzija **22.13 ili novija**.

Da provjeriš verziju, u terminalu ili Command Promptu kucaj:

```
node -v
```

## Korak 1: Google Cloud podešavanje (jednom, ~15 min)

1. Otvori <https://console.cloud.google.com> i napravi **novi projekat** (npr. "MultiPost").
2. **APIs & Services → Library** → potraži **YouTube Data API v3** → **Enable**.
3. Otvori **Google Auth Platform** (ranije "OAuth consent screen"):
   - **Branding:** naziv aplikacije, tvoj email za podršku i email developera.
   - **Audience:** User type **External**. Pod **Test users** dodaj Gmail adresu svoju i svakog prijatelja koji će povezivati kanale. Dozvoljeno je do 100 adresa.
   - **Data access → Add or remove scopes:** označi
     `.../auth/youtube.upload` i `.../auth/youtube.readonly`.
4. **Clients → Create client:**
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/oauth/youtube/callback`
5. Kopiraj **Client ID** i **Client secret**.

## Korak 2: Pokretanje

1. Raspakuj folder `multipost` gdje želiš.
2. Pokreni aplikaciju:
   - **Windows:** dupli klik na `start.bat`
   - **Mac/Linux:** u terminalu, unutar foldera, kucaj `npm start`
3. Pri prvom pokretanju aplikacija sama napravi fajl `.env` i u njega upiše tajne ključeve. Ugasi je (Ctrl+C ili zatvori prozor).
4. Otvori `.env` u Notepadu i upiši:
   ```
   GOOGLE_CLIENT_ID=tvoj-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=tvoj-secret
   INVITE_CODE=neki-kod-za-prijatelje
   CONTACT_EMAIL=tvoj@email.com
   ```
5. Ponovo pokreni aplikaciju i otvori <http://localhost:3000>.
6. Registruj se. **Prvi korisnik ne treba pozivni kod.** Svi ostali trebaju `INVITE_CODE`.
7. Na stranici **Kanali** klikni **Poveži YouTube kanal**. Na Googleovom ekranu izaberi kanal i dozvoli sve tražene dozvole. Ponovi za svaki kanal.

> ⚠️ **Nikad ne mijenjaj `ENCRYPTION_KEY`** u `.env` fajlu nakon što povežeš kanale, jer se sačuvani pristupi više ne bi mogli pročitati. Napravi rezervnu kopiju `.env` fajla i foldera `data/`.

## Bitna ograničenja dok nema audita

| Ograničenje | Zašto | Rješenje |
|---|---|---|
| Svaki video je **zaključan kao privatan** i ne može se prebaciti na javno | Googleovo pravilo za neverifikovane API projekte | Prođi audit (korak 3). Do tada testiraj na testnom kanalu. |
| Prijava kanala ističe nakon **7 dana** | Aplikacija je u "Testing" modu | Na stranici Kanali klikni "Ponovo poveži". Nestaje nakon odobrenja. |
| Oko **100 uploada dnevno** za sve korisnike zajedno | Besplatna kvota Google projekta | Brojač je na stranici Objave. Upload se sam nastavlja kad se kvota resetuje (09:00 po našem vremenu). |
| Kanali se mogu povezivati **samo na računaru gdje aplikacija radi** | Google dozvoljava `localhost` samo lokalno | Pristup za prijatelje preko interneta dodajemo u sljedećem koraku. |

## Korak 3: Google audit (da videi mogu biti javni)

Aplikacija već ima sve što Google traži od samog proizvoda:

- [x] Korisnik sam bira vidljivost (Javno / Nenavedeno / Privatno). Ništa nije unaprijed izabrano.
- [x] Na ekranu objave stoji obavještenje sa linkovima na YouTube uslove korištenja i Google politiku privatnosti.
- [x] Prikazano je na koje se kanale objavljuje.
- [x] Stranice `/privacy` i `/terms`.
- [x] Odspajanje kanala opoziva Google pristup, a postoji i link na Google postavke za opoziv.
- [x] Traže se samo neophodne dozvole (`youtube.upload`, `youtube.readonly`).

Šta trebaš uraditi ti:

1. **Javni link do politike privatnosti.** Google mora moći otvoriti `/privacy`. Ovo rješavamo zajedno sa pristupom za prijatelje (tunnel ili mali hosting). Do tada možeš sadržaj stranice `/privacy` objaviti na besplatnoj stranici, npr. GitHub Pages ili Google Sites.
2. **Snimi kratak demo video (2–4 min):** prijava → povezivanje kanala (vidi se Googleov ekran za dozvole) → upload sa izborom vidljivosti → pregled objave → odspajanje kanala.
3. Popuni **YouTube API Services – Audit and Quota Extension Form**:
   <https://support.google.com/youtube/contact/yt_api_form>
   Bitno je da navedeš **isti Google Cloud projekat** čiji Client ID koristi aplikacija.
4. Kad stigne odobrenje, u `.env` postavi `YT_PROJECT_AUDITED=true` i ponovo pokreni aplikaciju.

## Shorts iz snimaka gameplaya

Aplikacija iz dugog snimka predlaže najglasnije trenutke i reže ih u vertikalne Shorts (1080×1920).

1. Instaliraj **ffmpeg**. Na Windowsu u terminalu kucaj `winget install Gyan.FFmpeg`, pa ponovo pokreni aplikaciju.
2. Kopiraj snimke u folder `data/recordings` (može i u podfoldere). Drugi folder možeš zadati u `.env` kao `RECORDINGS_DIR`.
3. Na stranici **Recordings** klikni **Scan folder**. Aplikacija presluša svaki snimak i predloži do 8 trenutaka od 30 sekundi.
4. Otvori snimak, klikni **Preview** da pogledaš prijedlog i **Use** da ga preuzmeš u formu. Početak i kraj možeš postaviti i ručno, iz playera.
5. Izaberi raspored (cijeli kadar na zamućenoj pozadini ili izrez sredine, lijeve ili desne strane) i klikni **Create Short**.
6. Gotov Short je na stranici **Shorts**: možeš ga pogledati, skinuti ili poslati na objavu dugmetom **Publish**.

Prijedlozi se zasnivaju samo na glasnoći zvuka, pa ih uvijek pregledaj prije rezanja. Uklanjanje snimka sa liste ne briše fajl sa diska.

## Gdje su podaci

- `data/app.db` je baza (korisnici, kanali, objave).
- `data/uploads/` su videi koji čekaju objavu. Automatski se brišu nakon uspješne objave na svim kanalima.
- `data/recordings/` su tvoji snimci gameplaya, a `data/shorts/` izrezani Shorts.
- `.env` sadrži podešavanja i tajne ključeve.

## Struktura koda

```
src/server.js        rute i HTTP server
src/views.js         HTML stranice
src/lib/youtube.js   OAuth i resumable upload na YouTube
src/lib/worker.js    pozadinski red poslova, ponovni pokušaji i kvota
src/lib/media.js     ffmpeg: analiza zvuka, prijedlozi trenutaka i rezanje u 9:16
src/lib/studio.js    skeniranje foldera sa snimcima i red poslova za analizu i rezanje
src/lib/db.js        SQLite šema (ugrađeni node:sqlite)
src/lib/security.js  šifrovanje tokena, lozinke, sesija
public/              CSS i JavaScript za preglednik
```

## Česti problemi

- **"redirect_uri_mismatch"**: redirect URI u Google konzoli mora biti tačno `BASE_URL` + `/oauth/youtube/callback`.
- **"Access blocked: app has not completed verification"**: Gmail adresa nije dodana u **Test users**.
- **"Ovaj Google nalog nema YouTube kanal"**: napravi kanal na youtube.com, pa ga poveži ponovo.
- **Kanal pokazuje "Treba ponovo povezati"**: istekla je prijava od 7 dana. Klikni "Ponovo poveži", pa na stranici Objave klikni "Pokušaj ponovo".
