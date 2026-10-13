# CutDeck: baza znanja

Stanje na dan 13. 10. 2026, nakon commita `d32edf3` i dodavanja sekcije Clipping. Ovaj dokument opisuje šta je do sada napravljeno, kako radi i zašto je tako odlučeno. Uputstvo za korištenje je u [README.md](../README.md); ovdje je ono što treba znati da bi se projekat nastavio razvijati.

## 1. Šta je CutDeck

Lokalna web aplikacija koja od snimaka gameplaya pravi videe spremne za YouTube: Shorts, thumbnailove, videe s introm i outrom, titlove i tekst za objavu. Radi na jednom računaru, za jednog korisnika, bez interneta i bez vanjskih biblioteka.

- **Repozitorij:** `github.com/dime999/cutdeck`, grana `main`.
- **Lokalni folder** se i dalje zove `Multipost-video` (ime iz prve verzije); to ne utiče na rad.
- **Verzija** u `package.json`: 0.2.0.
- **Jezik:** interfejs je na engleskom, a README, komentari u kodu i ovaj dokument na bosanskom.

Aplikacija **ne objavljuje ništa na YouTube**. Gotov video se skine i postavi ručno kroz YouTube Studio.

## 2. Kako je projekat došao dovde

Redoslijed odluka objašnjava zašto kod izgleda kako izgleda.

1. **MultiPost (prva verzija).** Cilj je bio jedan video objaviti na više YouTube, Instagram i TikTok naloga. Napravljen je YouTube dio: nalozi s pozivnim kodom, povezivanje kanala preko Google OAuth-a, upload u pozadini s nastavkom prekinutog uploada, šifrovani tokeni.
2. **Promjena smjera.** Objava istog videa na više kanala nosi rizik da ga YouTube označi kao spam ili ponovljeni sadržaj, a video poslan preko API-ja ostaje zaključan kao privatan dok Google ne odobri audit projekta. Zato je cilj promijenjen: alat koji ubrzava pripremu videa za jedan kanal (plan je gameplay GTA 6 sa PlayStationa 5).
3. **CutDeck.** Aplikacija je preimenovana, a sve vezano za objavu uklonjeno: kanali, upload, Google prijava, šifrovanje tokena. Stari kod je u git historiji (commit `dce7a05` i `2210514`).
4. **Bez prijave.** Pošto aplikaciju koristi jedna osoba, prijava i registracija su uklonjene. Zauzvrat se server javlja samo na `127.0.0.1`.
5. **Funkcije za pripremu videa** dodavane su jedna po jedna; vidi odjeljak 4.

Historija commita, od najstarijeg:

| Commit | Šta je donio |
|---|---|
| `dce7a05` | MultiPost: YouTube upload na više kanala |
| `45374d1` | Interfejs na engleskom; popravka rušenja na `/static/` |
| `2210514` | Biblioteka snimaka i rezanje Shortsa |
| `a793ff0` | Preimenovanje u CutDeck, uklonjena objava na YouTube |
| `1e52a7e` | Ručno biranje dijela na vremenskoj traci; uklonjena prijava |
| `e03789e` | Editor thumbnaila |
| `8d29fdd` | Intro i outro |
| `338442d` | Spajanje više videa |
| `cfdc107` | Engleski titlovi za Shorts |
| `b1fd4c9` | Novi izgled cijelog interfejsa |
| `17074a9` | Lanac "napravi sve", paket za objavu, titlovi riječ po riječ |
| `025ddd8` | Dijeljenje cijelog snimka na Shorts, prekid, ispravljen redoslijed reda |
| `7a7728d` | Označavanje više Shortsa za brisanje, prozor za potvrdu |

## 3. Tok rada

```
snimak u data/recordings
   └─ Scan folder ──► analiza zvuka ──► prijedlozi trenutaka + vremenska traka
        ├─ Create a Short (jedan dio)            ┐
        ├─ Split into Shorts (cijeli snimak)     ├─► Short ──► titlovi ──► intro/outro ──► Video
        ├─ Create thumbnail                      ┘        (lanac, opcionalno)
        └─ Add intro and outro (cijeli snimak) ──► Video
                                                   Merge videos ──► Video
Short / Video / snimak ──► Publish kit (naslov, opis, hashtagovi, tagovi, thumbnail) ──► ručno u YouTube Studio
```

## 4. Funkcije

### 4.1 Biblioteka snimaka (Recordings)

- Snimci se kopiraju u `data/recordings` (ili folder iz `RECORDINGS_DIR`), uključujući podfoldere do dubine 5.
- **Scan folder** dodaje nove fajlove. Fajl mijenjan u zadnjih 5 sekundi se preskače, jer se vjerovatno još kopira.
- Podržani nastavci: mp4, mov, m4v, mkv, webm, avi, mts, ts.
- Svaki snimak se analizira: trajanje, rezolucija, glasnoća po sekundi, sličica.
- **Remove** samo sakriva snimak (`hidden=1`); fajl ostaje na disku, a sljedeće skeniranje ga ne vraća.

### 4.2 Prijedlozi trenutaka

Zasnivaju se **samo na glasnoći zvuka**, ne na slici. Vidi odjeljak 8.1 za algoritam. Dobro hvataju pucnjavu, eksplozije i povišen glas; ne hvataju tihe a zanimljive trenutke.

### 4.3 Vremenska traka i ručno rezanje

Na stranici snimka:

- stubići pokazuju glasnoću, jantarno označeni dijelovi su prijedlozi, zelena crtica je dio iz kojeg je Short već izrezan;
- povlačenje preko trake pravi izbor; izbor se može pomjeriti ili mu se mogu skratiti rubovi;
- dok se vuče, player prikazuje kadar na rubu koji se pomjera;
- dugmad 15 s, 30 s, 45 s, 1 min postavljaju dužinu od početka izbora;
- zum (−, +, "Zoom to selection") širi traku unutar okvira koji se vodoravno pomjera;
- strelice pomjeraju izbor za sekundu, uz Shift za desetinku.

Izbor je ono što piše u poljima Start i End; traka ga samo prikazuje i mijenja.

### 4.4 Shorts

- Izlaz je uvijek vertikalni MP4 1080×1920 (H.264, AAC), dužine 3 do 180 sekundi.
- Rasporedi: cijeli kadar na zamućenoj pozadini (`blur`) ili izrez sredine, lijeve ili desne strane (`center`, `left`, `right`).
- Na pločici: Download, Publish kit, Captions, Intro and outro, Delete; dok se pravi ili čeka: Cancel.
- Više Shortsa se briše odjednom preko kvačica i dugmeta **Delete selected**.

### 4.5 Dijeljenje cijelog snimka (Split into Shorts)

- Zadaje se dužina dijela (5 do 180 s); forma odmah pokazuje koliko Shortsa nastaje. Najviše 300 po jednom dijeljenju.
- Naslovi su `<naslov> - Part N`.
- Opcionalno se na svaki Short upisuje natpis, zadano `PART N`, gore ili dole, kroz cijelo trajanje.
- Titlovi, intro i outro idu istim lancem kao kod pojedinačnog Shorta.
- Kad su titlovi uključeni, međukorak bez titlova se briše čim Short s titlovima bude gotov.

### 4.6 Lanac "napravi sve"

U formama **Create a Short** i **Split into Shorts** mogu se uključiti titlovi i izabrati intro i outro. Jedan klik tada uradi sve redom. Rezultat je pod **Videos** ako ima intro ili outro, a inače pod **Shorts**. Izbor se pamti u pregledniku (`localStorage`). Detalji su u odjeljku 7.

### 4.7 Titlovi (samo engleski)

- Prepoznavanje govora radi lokalno, preko ffmpeg filtera `whisper` i modela `ggml-small.en.bin`.
- Rezultat su kratki redovi (do oko 20 znakova) s vremenom za svaku riječ.
- Editor: ispravka teksta, vremena pojavljivanja i nestajanja, brisanje reda, font (Impact ili Arial Black), veličina, boja, pozicija, velika slova, isticanje izgovorene riječi drugom bojom. Pregled se vidi preko videa.
- **Create Short with captions** pravi kopiju Shorta s titlovima u slici; original ostaje.
- Stil se pri svakom spremanju pamti kao zadani i koristi se kad se titlovi dodaju automatski.
- Titlovi postoje samo za Shorts, ne i za duge videe.

### 4.8 Thumbnail

Editor u pregledniku crta na canvas 1280×720 i sprema JPG:

- izbor kadra klizačem i dugmadima ±0,1 s i ±1 s;
- tekst do dva reda, font, veličina, pet boja, crni obrub, položaj povlačenjem;
- zum do 3× i pomjeranje slike, svjetlina, kontrast, jačina boja, zatamnjenje iza teksta.

Spremljeni thumbnail se ne može naknadno uređivati.

### 4.9 Intro i outro

- Klipovi se dodaju na stranici **Intros and outros** (MP4, MOV, MKV, WebM, do 1 GB). U kodu se zovu *bumpers*.
- **Add intro and outro** na snimku ili Shortu pravi video: intro + glavni dio + outro.
- Gotov video uzima veličinu i broj sličica glavnog dijela. Dio drugačijeg oblika dobija crne rubove, a dio bez zvuka tišinu. Sve se kodira iznova.

### 4.10 Spajanje više videa (Merge videos)

Bilo koji redoslijed snimaka, Shortsa i klipova, najviše 30 dijelova. Polje **Frame size** određuje koji dio daje veličinu kadra. Koristi isti mehanizam kao intro i outro.

### 4.11 Paket za objavu (Publish kit)

Za Short, video ili snimak: naslov (100), opis (5000), hashtagovi (500), tagovi (500), thumbnail za vodoravne videe, dugmad za kopiranje, skidanje videa, link na YouTube Studio i oznaka "objavljeno". **Save and reuse for new kits** pamti opis, hashtagove i tagove kao početni tekst novih paketa. Tekst piše korisnik; aplikacija ga ne smišlja.

### 4.12 Clipping (kampanje)

Odvojena sekcija za clipping kampanje, u kojima se po zadanim pravilima klipa tuđa epizoda. Ostatak aplikacije nije mijenjan: klipovi kampanje su u tabeli `clips` s popunjenim `campaign_id` i ne prikazuju se na stranici Shorts ni na stranici snimka.

- **Kampanja** veže pravila za jednu epizodu (snimak): hashtagovi, tag po platformi (YouTube, TikTok, Instagram, X), zabranjene riječi i najkraća dužina klipa.
- **Transkript epizode** nastaje jednom, istim prepoznavanjem govora kao titlovi, i čuva se po riječima. Na stranici kampanje se pretražuje; klik na red premota player, a red se može postaviti kao početak, kraj ili hook.
- **Hook** je dio od 0,5 do 5 s koji se pušta prije scene.
- **Izbacivanje pauza** iz scene uklanja tišine između riječi duže od 0,6 s, uz 0,15 s zraka oko govora.
- **Titlovi** se ne prepoznaju ponovo: riječi transkripta se preslikaju na vrijeme gotovog klipa i upišu u sliku u istom prolazu.
- **Provjera pravila** na stranici klipa: dužina, titlovi, zabranjene riječi (naslov, opis, titlovi), napisan opis.
- **Tekst za objavu** po platformi: opis + tag te platforme + hashtagovi kampanje. Za svaku platformu se bilježi da li je objavljeno i link.
- **Upozorenje na ponavljanje** kad se nova scena barem 50% poklapa s postojećim klipom kampanje; redovi transkripta koji su već iskorišteni su označeni.
- **Varijacija**: link koji otvara formu s početkom i krajem postojećeg klipa.

## 5. Arhitektura

- **Node.js 22.13 ili noviji**, bez ijednog npm paketa. Baza je ugrađeni `node:sqlite`.
- **ffmpeg 8 ili noviji**, "full" verzija (treba filtere `whisper` i `ass`). Na Windowsu `winget install Gyan.FFmpeg`.
- **Model za govor** `data/models/ggml-small.en.bin` (oko 490 MB), skida se jednom; nije u gitu.
- HTML se pravi na serveru, kao nizovi u `views.js`. U pregledniku je običan JavaScript bez okvira.

| Fajl | Uloga |
|---|---|
| `src/server.js` | HTTP server, ruter, sve rute, provjera ulaza, poruke (flash) |
| `src/views.js` | HTML stranice; sve korisničke vrijednosti prolaze kroz `h()` |
| `src/lib/media.js` | Sve što poziva ffmpeg: analiza zvuka, prijedlozi, rezanje, spajanje, titlovi, sličice |
| `src/lib/studio.js` | Redovi poslova, skeniranje foldera, lanac, dijeljenje, prekid |
| `src/clipping-routes.js`, `src/clipping-views.js` | Rute i stranice sekcije Clipping; `server.js` ih samo priključuje |
| `src/lib/clipping.js` | Čista logika kampanja: lista dijelova (EDL), pauze, preslikavanje riječi, provjera pravila, tekst za objavu |
| `src/lib/db.js` | Šema baze i dodavanje novih kolona postojećim bazama |
| `src/lib/config.js` | Čitanje `.env`, putanje, pronalazak ffmpeg-a |
| `public/app.js` | Vremenska traka, editori, kopiranje, potvrde, osvježavanje stanja |
| `public/style.css` | Cijeli izgled |
| `start.bat` | Pokretanje na Windowsu |

Pokretanje: `start.bat` ili `npm start`, pa `http://localhost:3000`.

## 6. Podaci

Sve je u folderu `data/`, koji nije u gitu.

| Putanja | Sadržaj |
|---|---|
| `data/app.db` | Baza |
| `data/recordings/` | Snimci koje korisnik ubaci |
| `data/shorts/` | Izrezani Shorts |
| `data/videos/` | Gotovi videi (intro/outro, spajanje) |
| `data/thumbnails/` | Thumbnailovi koje je korisnik napravio |
| `data/bumpers/` | Intro i outro klipovi |
| `data/thumbs/` | Sličice za prikaz u aplikaciji (`rec-N.jpg`, `clip-N.jpg`, `video-N.jpg`, `bumper-N.jpg`) |
| `data/models/` | Model za prepoznavanje govora |
| `data/tmp/` | Privremeni fajlovi (ASS titlovi, izlaz prepoznavanja); brišu se nakon posla |

### Tabele

| Tabela | Šta čuva | Bitne kolone |
|---|---|---|
| `users` | Jedan lokalni korisnik | Sve ostalo pripada njemu preko `user_id` |
| `recordings` | Snimci | `status` (pending, analyzing, ready, failed), `waveform` (JSON, 240 stubića 0–100), `hidden` |
| `moments` | Prijedlozi trenutaka | `start_s`, `end_s`, `score` (0–100) |
| `clips` | Shorts | `status` (pending, rendering, ready, failed), `layout`, `source_clip_id` i `subtitles` (Short s titlovima), `label` (natpis, JSON), `followup` (lanac, JSON) |
| `captions` | Titlovi jednog Shorta | `status` (pending, transcribing, ready, failed), `lines` (JSON s riječima), `style` (JSON) |
| `thumbnails` | Thumbnailovi | `recording_id`, `path` |
| `bumpers` | Intro i outro klipovi | `duration`, `has_audio` |
| `exports` | Gotovi videi | `parts` (JSON: redoslijed dijelova, `main` označava dio koji daje veličinu), `status` |
| `kits` | Paketi za objavu | `kind` (clip, video, recording), `item_id`, `published_at` |
| `campaigns` | Clipping kampanje | `recording_id`, `hashtags`, `tag_youtube`…`tag_x`, `banned`, `min_seconds` |
| `transcripts` | Transkript cijelog snimka | `recording_id`, `status`, `words` (JSON: `{s, e, t}` po riječi) |
| `posts` | Objave klipa po platformi | `clip_id`, `platform`, `url`, `posted_at` |
| `settings` | Podešavanja | `caption_style`, `kit_defaults` |

Napomene:

- U kodu se gotov video zove *export* (tabela `exports`), jer je ime `videos` zauzeto u bazama nastalim u vrijeme MultiPosta. Takve baze mogu imati i neiskorištene tabele `accounts`, `uploads`, `videos`, `jobs` te folder `data/uploads`.
- Nove kolone se postojećim bazama dodaju funkcijom `addColumn` u `db.js`. `CREATE TABLE IF NOT EXISTS` ne mijenja postojeću tabelu, pa svaka nova kolona mora ići i tim putem.
- Klip kampanje je red u `clips` s kolonama `campaign_id`, `edl` (JSON lista dijelova izvora, hook ima `hook: true`), `length_s` (stvarna dužina nakon rezova) i `caption` (opis za objavu). `start_s` i `end_s` su i dalje granice scene u epizodi.
- Brisanje Shorta briše i njegove titlove (strani ključ) i njegov paket za objavu (ručno, u `deleteClip`).

## 7. Redovi poslova i lanac

Sve poslove vodi `studio.js`. Postoje dvije trake, svaka radi jedan ffmpeg posao istovremeno:

- **Glavna traka** (`tick`): Shorts, titlovi i analiza snimaka.
- **Traka za videe** (`tickExports`): spajanje dijelova. Odvojena je da dug video ne zaustavi rezanje Shortsa.

Redoslijed u glavnoj traci:

1. Short s titlovima koji čeka upisivanje u sliku
2. Prepoznavanje govora koje čeka
3. Običan Short koji čeka rezanje (i klip kampanje)
4. Transkript epizode koji čeka
5. Analiza novog snimka

Zbog ovog redoslijeda se svaki dio završi do kraja prije nego krene sljedeći. Ranije je red bio "prvo svi Shorts, pa titlovi", pa su pri dijeljenju snimka titlovi stizali tek nakon zadnjeg dijela.

**Lanac** je zapisan u koloni `clips.followup` kao JSON: `{ captions, style, intro, outro, title, cleanup }`.

- Kad Short bude gotov, `advanceClip` čita `followup` i pokreće sljedeći korak.
- Ako su traženi titlovi: prepoznavanje govora, pa novi Short s titlovima, kojem se `followup` predaje dalje (bez titlova).
- Zadnji korak (`finishChain`) pravi video s introm i outrom, ako su traženi.
- Ako u Shortu nema govora ili prepoznavanje ne uspije, lanac nastavlja bez titlova.
- `cleanup` (postavlja ga dijeljenje snimka) briše međukorak bez titlova.

**Prekid.** Posao koji radi ima `AbortController`; prekid ubija ffmpeg.

- `cancelShorts` uklanja sve nedovršene Shorts, prekida trenutni i briše sve lance. Gotovi Shorts ostaju.
- `cancelClip` prekida jedan Short.
- `cancelExport` prekida video koji se pravi.

**Nakon gašenja aplikacije** poslovi koji su bili u toku kreću ispočetka pri sljedećem pokretanju.

**Osvježavanje stranica.** Dok se nešto pravi, preglednik svake 2 sekunde čita `/api/studio/status`. Kad se stanje promijeni, ili se stavka pojavi ili nestane, zamjenjuje samo dijelove stranice označene s `data-live`, da forma i player ostanu netaknuti. Dio s atributom `data-rev` se ne dira ako mu se oznaka nije promijenila.

## 8. Detalji koji nisu očigledni iz koda

### 8.1 Prijedlozi trenutaka (`findMoments`)

1. ffmpeg daje zvuk kao mono signal na 8 kHz; računa se glasnoća u decibelima za svaku sekundu.
2. Uzbuđenje sekunde je koliko je glasnija od medijane cijelog snimka; tiše sekunde vrijede nula.
3. Prozor od 30 sekundi klizi kroz snimak. Sredina prozora vrijedi više od rubova, pa glasan dio završi u sredini.
4. Bira se do 8 najboljih prozora, razmaknutih barem 10 sekundi.
5. Prozori slabiji od 30% najboljeg se odbacuju.

### 8.2 Dijeljenje snimka (`splitRanges`)

- Dijelovi su uzastopni i jednake dužine.
- Ostatak postaje zaseban, kraći Short ako traje barem četvrtinu dijela i barem 3 sekunde.
- Kraći ostatak se pripaja posljednjem dijelu, ako time ne pređe 180 sekundi; inače se odbacuje.
- Isto pravilo je prepisano u `app.js`, da forma pokaže broj Shortsa. Ako se mijenja, mijenja se na oba mjesta.

### 8.3 Titlovi

- Filter `whisper` se poziva s `max_len=1`, što daje jedan zapis po riječi. `groupWords` ih slaže u redove: red se zatvara kad je pun, na kraju rečenice ili nakon pauze duže od 0,7 s.
- Pri ispravci reda: ako broj riječi ostane isti, zadržavaju se izmjerena vremena; inače se trajanje reda dijeli po dužini riječi (`fitWords`). Isto pravilo je i u `app.js`, za pregled.
- Titlovi se upisuju u sliku kao ASS fajl. Isticanje je izvedeno s po jednim događajem za svaku riječ, u kojem je ta riječ u drugoj boji.
- Pomoćni model za prepoznavanje glasa (VAD) je isproban i odbačen: usporio je obradu oko 9 puta, a nije popravio vremena.

### 8.4a Klip iz više dijelova (`renderEdl`)

Klip kampanje nastaje u jednom ffmpeg prolazu: svaki dio liste se iz istog ulaza izdvaja filterima `trim` i `atrim`, dijelovi se spajaju filterom `concat`, pa na spojenu sliku idu raspored 9:16 i titlovi. Vremena titlova se računaju unaprijed (`mapWords`): riječ pripada dijelu u kojem joj je sredina. Forma u `app.js` ispod polja pokazuje dužinu scene i hooka prije izbacivanja pauza; stvarnu dužinu računa server.

### 8.4 Putanje u ffmpeg filterima

Putanja kao vrijednost opcije filtera mora imati kose crte naprijed, označenu dvotačku i navodnike (`'C\:/…'`). To radi `filterPath` u `media.js`. Putanja s apostrofom nije podržana.

### 8.5 ffmpeg i PATH na Windowsu

`winget` dodaje ffmpeg u PATH samo za programe pokrenute nakon instalacije. Zato `config.js` provjerava i folder `%LOCALAPPDATA%\Microsoft\WinGet\Links`.

### 8.6 Editor thumbnaila

Nakon premotavanja preglednik javi `seeked` prije nego što je kadar dostupan za crtanje. Zato se canvas crta i na `requestVideoFrameCallback` i još jednom nakon 200 ms.

### 8.7 Kodiranje

- Shorts: `libx264`, preset `veryfast`, CRF 20, AAC 160 kb/s.
- Spajanje: isto, AAC 192 kb/s; svaki dio se prethodno svodi na istu veličinu, broj sličica i format zvuka, jer ih filter `concat` inače ne može spojiti.

## 9. Rute

| Metoda i adresa | Namjena |
|---|---|
| `GET /recordings`, `POST /recordings/scan` | Lista snimaka, skeniranje foldera |
| `GET /recordings/:id` | Stranica snimka s trakom |
| `POST /recordings/:id/clips` | Novi Short (uz opcioni lanac) |
| `GET`, `POST /recordings/:id/split` | Dijeljenje cijelog snimka |
| `GET /recordings/:id/thumbnail`, `PUT /api/recordings/:id/thumbnails` | Editor thumbnaila, spremanje JPG-a |
| `POST /recordings/:id/analyze`, `POST /recordings/:id/remove` | Ponovna analiza, uklanjanje s liste |
| `GET /shorts`, `POST /shorts/delete`, `POST /shorts/cancel` | Lista, brisanje označenih, prekid svega |
| `POST /clips/:id/delete`, `POST /clips/:id/cancel` | Brisanje i prekid jednog Shorta |
| `GET /clips/:id/captions`, `POST /clips/:id/captions/generate`, `POST /clips/:id/captions` | Titlovi: stranica, prepoznavanje, spremanje i upisivanje |
| `GET /thumbnails`, `POST /thumbnails/:id/delete` | Galerija thumbnailova |
| `GET /bumpers`, `PUT /api/bumpers`, `POST /bumpers/:id/delete` | Intro i outro klipovi |
| `GET /videos`, `GET /videos/new`, `POST /videos` | Lista videa, dodavanje intra i outra |
| `GET`, `POST /videos/merge` | Spajanje više videa |
| `POST /videos/:id/cancel`, `POST /videos/:id/delete` | Prekid i brisanje videa |
| `GET`, `POST /publish/:kind/:id` | Paket za objavu |
| `GET`, `POST /clipping` | Lista kampanja, nova kampanja |
| `GET`, `POST /clipping/:id`, `POST /clipping/:id/delete` | Stranica kampanje, izmjena pravila, brisanje |
| `POST /clipping/:id/transcribe`, `POST /clipping/:id/clips` | Transkript epizode, novi klip |
| `GET`, `POST /clipping/clips/:id`, `POST /clipping/clips/:id/delete` | Provjera pravila, tekst i evidencija objava; brisanje klipa |
| `GET …/file`, `GET …/thumb` | Video i slike, uz podršku za Range |
| `GET /api/studio/status` | Stanje poslova za osvježavanje stranica (`?campaign=N` za klipove kampanje, `?all=1` za bočni meni) |
| `GET /privacy`, `GET /terms`, `GET /healthz` | Tekstualne stranice i provjera rada |

## 10. Izgled

Uzor su alati za video (DaVinci Resolve, CapCut, Frame.io). Ideja je radni sto za montažu: interfejs je tih, a najsvjetlija stvar na ekranu je video.

- **Podloga:** neutralna grafitna siva (`--deck`, `--panel`, `--raised`), jer ne mijenja utisak boja u videu.
- **Jantarna** (`--amber`) znači zvuk i glavnu akciju: stubići glasnoće, prijedlozi, glavno dugme.
- **Plava** (`--sky`) znači korisnikov izbor: označeni dio trake, izabrana opcija, fokus.
- **Pismo:** Bahnschrift za naslove, dugmad i vremena; Segoe UI za tekst. Oba dolaze s Windowsom, pa nema vanjskih fontova.
- **Raspored:** bočni meni s grupama Library, Create, Assets, Clipping; na uskom ekranu se sklapa u traku na vrhu.
- Samo tamna tema.
- Potvrda prije brisanja je prozor u stilu aplikacije (`<dialog>`). Tekst dolazi iz atributa `data-confirm`: dio do prvog upitnika je naslov, ostatak objašnjenje.

Kontrole su oblikovane kao dugmad na uređaju (blagi sjaj odozgo, sjena ispod, pomak pri pritisku) i imaju ista pravila na svim stranicama:

- **Dugmad:** glavna akcija je jantarna, ostale sive, brisanje crveno. Nakon klika dugme pokazuje da je zahtjev poslan i ne prima drugi klik.
- **Polja:** udubljena, s plavim okvirom u fokusu. Kvačice u formama su prekidači, a klizači pokazuju vrijednost obojenim dijelom trake (`--fill` postavlja `app.js`).
- **Pločice:** najviše dvije vidljive akcije; ostale su u meniju iza tri tačke (`<details class="menu">`).
- **Poruke** nakon akcije iskaču u donjem desnom uglu; potvrda sama nestane, greška ostaje dok se ne zatvori.
- **Bočni meni** pokazuje šta se trenutno pravi u pozadini, sa svake stranice.
- **Prazne liste** kažu šta tu nastaje i čime se počinje.

Sve boje, zaobljenja i visine kontrola su varijable na vrhu `style.css`. Pomoćne funkcije za ikone, meni, link nazad i prazno stanje su na vrhu `views.js` (`icon`, `menu`, `crumb`, `emptyState`).

## 11. Podešavanja (`.env`)

| Ključ | Značenje |
|---|---|
| `PORT`, `BASE_URL` | Adresa aplikacije; zadano `http://localhost:3000` |
| `HOST` | Zadano `127.0.0.1`; ne mijenjati bez razloga, jer nema prijave |
| `APP_NAME` | Ime u interfejsu |
| `CONTACT_EMAIL` | Prikazuje se u politici privatnosti |
| `RECORDINGS_DIR` | Folder sa snimcima; prazno znači `data/recordings` |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Putanje ako ffmpeg nije u PATH-u |
| `WHISPER_MODEL` | Model za govor; prazno znači `data/models/ggml-small.en.bin` |

`.env` nastaje iz `.env.example` pri prvom pokretanju.

## 12. Sigurnost

- Nema prijave. Server sluša samo na `127.0.0.1`, pa aplikaciji ne može pristupiti niko s mreže.
- Zahtjevi koji mijenjaju stanje (`POST`, `PUT`) odbijaju se ako zaglavlje `Origin` ne odgovara adresi aplikacije. To sprječava da druga web stranica šalje zahtjeve lokalnoj aplikaciji.
- Sve korisničke vrijednosti se u HTML-u označavaju funkcijom `h()`.
- Poslani fajlovi se provjeravaju: thumbnail mora počinjati JPG zaglavljem, a intro/outro klip mora proći `ffprobe`.

Ako se aplikacija ikad otvori prema internetu, prijava se mora vratiti.

## 13. Testiranje

U repou **nema automatskih testova**. Tokom razvoja su korištene skripte izvan repoa:

- test cijelog toka preko HTTP-a s lažnim ffmpegom;
- testovi sa stvarnim ffmpegom i modelom za govor: rezanje, spajanje, titlovi, lanac, dijeljenje, prekid;
- ručna provjera u pregledniku na probnoj kopiji aplikacije.

Probni materijal je bio generisan: ffmpeg testna slika i sintetički Windows glas preko šuma.

## 14. Poznata ograničenja i neprovjereno

- **Clipping je isproban samo na sintetičkom govoru od 90 sekundi.** Transkript cijele epizode od sat vremena nije mjeren (vrijeme, memorija), a izbacivanje pauza zavisi od tačnosti vremena riječi.
- **Clipping ne provjerava** da li je snimak iz prave epizode, da li je klip prijavljen i u drugu kampanju, niti publiku naloga. Zabranjene riječi se traže samo u tekstu, ne u slici.
- **Pravi PS5 snimak nikad nije isproban.** Posebno HDR: boje u Shortu ili videu mogu ispasti isprane, jer konverzija HDR-a nije ugrađena.
- **Tačnost titlova** je mjerena samo na sintetičkom glasu. S pravim glasom i glasnom igrom ispod njega može biti lošija.
- **Prvi titl** se ponekad pojavi prije nego što govor počne.
- **Prijedlozi** gledaju samo glasnoću.
- **Dijeljenje snimka** reže po vremenu, pa rez može pasti usred rečenice.
- **Titlovi iz dijeljenja** se ne mogu naknadno ispravljati, jer se međukorak briše.
- **Natpis PART N i titlovi** se preklapaju ako su na istoj poziciji.
- **Titlovi** postoje samo za Shorts i samo na engleskom.
- **Spremljeni thumbnail** se ne može ponovo otvoriti u editoru.
- **Fontovi** su samo oni instalirani na računaru (Impact, Arial Black).
- **Spajanje** kodira sve iznova, pa dugi videi traju.
- **Povlačenje mišem** je provjereno simuliranim događajima, ne rukom.

## 15. Šta bi moglo biti sljedeće

Ideje o kojima se razgovaralo, a nisu urađene:

- titlovi i izvoz `.srt` fajla za duge videe;
- prijedlozi trenutaka i pretraga snimka po izgovorenom tekstu;
- podijeljen ekran za Shorts (igra gore, kamera dole) i ručno biranje dijela kadra;
- ujednačavanje glasnoće na nivo koji YouTube preporučuje;
- kalendar objava;
- pretvaranje HDR snimaka;
- automatski testovi u repou;
- automatska objava na YouTube, što traži Googleov audit i povratak prijave.

## 16. Rječnik

| Pojam u interfejsu | U kodu | Značenje |
|---|---|---|
| Recording | `recordings` | Izvorni snimak gameplaya |
| Moment | `moments` | Predloženi dio snimka |
| Short | `clips` | Vertikalni video izrezan iz snimka |
| Captions | `captions` | Titlovi jednog Shorta |
| Intro, outro | `bumpers` | Kratki klip za početak ili kraj |
| Video | `exports` | Video složen iz više dijelova |
| Publish kit | `kits` | Tekst i thumbnail za objavu |
| "Then, without more clicks" | `followup` | Lanac koraka nakon rezanja |
| Part label | `label` | Natpis PART N na Shortu |
