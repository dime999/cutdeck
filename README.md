# CutDeck

Lokalna web aplikacija koja od snimaka gameplaya pravi videe spremne za YouTube.
Radi na tvom računaru, besplatna je i nema vanjskih biblioteka: trebaju ti samo Node.js i ffmpeg.

**Šta radi sada:**

- Vodi biblioteku snimaka iz jednog foldera, sa sličicom i vremenskom trakom glasnoće.
- Predlaže najglasnije trenutke svakog snimka kao kandidate za Shorts.
- Reže izabrani dio u vertikalni Short (1080×1920), sa cijelim kadrom na zamućenoj pozadini ili izrezom dijela slike.
- Pravi thumbnail (JPG 1280×720) od kadra iz snimka, sa tekstom i doradom slike.
- Dodaje intro i outro na cijeli snimak ili na Short i pravi gotov video.
- Spaja više videa (snimke, Shorts, intro i outro klipove) u jedan, redom koji zadaš.
- Pravi engleske titlove iz tvog govora u Shortu i upisuje ih u sliku, sa isticanjem riječi koja se izgovara.
- Jednim klikom od izabranog dijela snimka pravi Short s titlovima, introm i outrom.
- Reže cijeli snimak na Shorts zadane dužine, sa natpisom PART 1, PART 2… i titlovima.
- Priprema paket za objavu: naslov, opis, hashtagove, tagove i thumbnail, spremne za kopiranje u YouTube Studio.
- Nema prijave: aplikacija je za jednog korisnika i dostupna je samo sa računara na kojem radi.

Aplikacija ne objavljuje ništa na YouTube. Gotov video skineš i postaviš ga sam kroz YouTube Studio.

---

## Korak 1: Instaliraj Node.js i ffmpeg

1. Skini **Node.js 24 LTS** sa <https://nodejs.org> i instaliraj ga. Potrebna je verzija **22.13 ili novija**.
2. Instaliraj **ffmpeg**. Na Windowsu u terminalu kucaj:
   ```
   winget install Gyan.FFmpeg
   ```

## Korak 2: Pokretanje

1. Pokreni aplikaciju:
   - **Windows:** dupli klik na `start.bat`
   - **Mac/Linux:** u terminalu, unutar foldera, kucaj `npm start`
2. Pri prvom pokretanju aplikacija sama napravi fajl `.env` sa podešavanjima.
3. Otvori <http://localhost:3000>. Prijave nema, odmah si na stranici **Recordings**.

## Shorts iz snimaka gameplaya

1. Kopiraj snimke u folder `data/recordings` (može i u podfoldere). Drugi folder možeš zadati u `.env` kao `RECORDINGS_DIR`.
2. Na stranici **Recordings** klikni **Scan folder**. Aplikacija presluša svaki snimak i predloži do 8 trenutaka od 30 sekundi.
3. Otvori snimak. Klik na označeni dio vremenske trake pusti taj trenutak i upiše ga u formu.
   Dio možeš izabrati i sam: povuci mišem preko trake, pa izbor pomjeri ili mu skrati rubove. Dugmad **15 s, 30 s, 45 s, 1 min** postave dužinu, a zum uveća traku za precizan rez.
4. Izaberi raspored i klikni **Create Short**.
5. Gotov Short je na stranici **Shorts**: možeš ga pogledati i skinuti dugmetom **Download**.

**Sve jednim klikom.** Ispod naslova u istoj formi možeš uključiti **Add captions from the voice** i izabrati intro i outro. Tada **Create Short** uradi sve redom: izreže Short, prepozna govor i upiše titlove (u stilu koji si zadnji put sačuvao na stranici titlova), pa doda intro i outro. Gotov rezultat je na stranici **Videos** ako ima intro ili outro, a inače na stranici **Shorts**. Izbor se pamti za sljedeći put. Međukoraci (Short bez titlova i Short s titlovima) ostaju na stranici Shorts.

Prijedlozi se zasnivaju samo na glasnoći zvuka, pa ih uvijek pregledaj prije rezanja. Uklanjanje snimka sa liste ne briše fajl sa diska.

## Cijeli snimak u Shorts odjednom

1. Otvori snimak i klikni **Split into Shorts**.
2. Upiši dužinu jednog dijela u sekundama (5 do 180) ili klikni jednu od ponuđenih. Ispod polja piše koliko će Shortsa nastati.
3. Izaberi raspored i naslov; svaki Short dobija nastavak "- Part 1", "- Part 2"…
4. Ako želiš natpis na videu, ostavi uključeno **Write the part number on each Short** i izaberi riječ (zadano PART) i poziciju.
5. Po želji uključi titlove i izaberi intro i outro, pa klikni **Create Shorts**.

Dijelovi se završavaju jedan po jedan: svaki se izreže, dobije titlove i tek onda kreće sljedeći. Dok traje, na stranici **Shorts** je dugme **Stop creating Shorts**, koje uklanja nedovršene Shorts i zaustavlja dalje dodavanje titlova, intra i outra; gotovi ostaju. Pojedinačni Short koji čeka ili se pravi prekidaš dugmetom **Cancel** na njegovoj pločici.

Ostatak od nekoliko sekundi na kraju pripaja se posljednjem dijelu, a duži ostatak postaje zaseban, kraći Short. Kad su titlovi uključeni, na stranici **Shorts** ostaju samo gotovi Shorts sa titlovima; međukoraci bez titlova se brišu. Svaki gotov Short ima svoj **Publish kit** sa već upisanim naslovom.

## Thumbnail

1. Otvori snimak i klikni **Create thumbnail**. Editor se otvara na kadru koji je u tom trenutku u playeru.
2. Klizačem i dugmadima **±0.1 s** i **±1 s** izaberi tačan kadar.
3. Upiši tekst (do dva reda), izaberi font, veličinu i boju, pa ga mišem odvuci na mjesto.
4. Po potrebi uvećaj sliku i odvuci je da izabereš šta ostaje u kadru, te podesi svjetlinu, kontrast i jačinu boja.
5. Klikni **Save thumbnail**. Gotovi thumbnailovi su na stranici **Thumbnails**, odakle ih skidaš dugmetom **Download**.

Spremljeni thumbnail se ne može naknadno uređivati; za izmjenu napravi novi.

## Intro i outro

1. Na stranici **Intros and outros** dodaj svoje intro i outro klipove (MP4, MOV, MKV ili WebM, do 1 GB). Isti klip može biti i intro i outro.
2. Otvori snimak ili Short i klikni **Add intro and outro**.
3. Izaberi intro, outro ili oboje, upiši naslov i klikni **Create video**.
4. Gotov video je na stranici **Videos**, odakle ga skidaš dugmetom **Download**. Dok se pravi, možeš ga prekinuti dugmetom **Cancel**.

Gotov video ima veličinu glavnog videa. Klip drugačijeg oblika (npr. vodoravni intro na vertikalnom Shortu) uklapa se u kadar sa crnim rubovima, a klip bez zvuka dobija tišinu. Cijeli video se kodira iznova, pa dug snimak traje.

## Spajanje više videa

1. Na stranici **Videos** klikni **Merge videos**.
2. Dugmetom **Add** dodaj dijelove redom kojim trebaju ići: snimke, Shorts ili intro i outro klipove. Isti dio možeš dodati više puta.
3. Strelicama promijeni redoslijed, a pod **Frame size** izaberi dio čiju veličinu uzima gotov video.
4. Klikni **Create video**. Rezultat je na stranici **Videos**.

Vrijede ista pravila kao kod intra i outra: dijelovi drugačijeg oblika dobijaju crne rubove, a sve se kodira iznova.

## Titlovi (engleski)

Titlovi nastaju prepoznavanjem engleskog govora, lokalno na tvom računaru. Za to treba ffmpeg 8 ili noviji ("full" verzija, kakvu instalira `winget install Gyan.FFmpeg`) i model za prepoznavanje govora, koji se skine jednom (oko 490 MB):

```
curl -L -o data/models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

Prije toga napravi folder `data/models`. Za tačnije prepoznavanje možeš skinuti veći model (`ggml-medium.en.bin`) i upisati njegovu putanju u `.env` kao `WHISPER_MODEL`.

1. Na stranici **Shorts** klikni **Add captions** na Shortu u kojem govoriš.
2. Klikni **Generate captions** i sačekaj da aplikacija presluša Short.
3. Ispravi pogrešno prepoznate riječi. Dva broja uz svaki red su sekunde kad se titl pojavi i nestane; klik na red premota video na njega, a **×** ga briše.
4. Izaberi font, veličinu, boju i poziciju. Uz **Highlight each word as it is spoken** riječ koja se upravo izgovara dobija drugu boju. Titl se kao pregled vidi preko videa.
5. Klikni **Create Short with captions**. Nastaje kopija Shorta sa titlovima u slici, a original ostaje netaknut.

Titlovi nastaju iz govora, ne iz zvuka igre. Prvi titl se ponekad pojavi nešto prije nego što govor počne, pa mu po potrebi pomjeri vrijeme.

## Paket za objavu

Aplikacija ne objavljuje na YouTube, ali ti pripremi sve što YouTube Studio traži.

1. Na Shortu, videu ili snimku klikni **Publish kit**.
2. Upiši naslov, opis, hashtagove i tagove. Uz svako polje je dugme **Copy**; opis se kopira zajedno sa hashtagovima.
3. Za vodoravne videe izaberi thumbnail koji si napravio i skini ga dugmetom **Download thumbnail**.
4. **Save and reuse for new kits** pamti opis, hashtagove i tagove kao početni tekst svakog novog paketa.
5. Kad video objaviš, označi **I have published this on YouTube**; na pločici se pojavi oznaka **Published**.

## Gdje su podaci

- `data/app.db` je baza (snimci, Shorts, thumbnailovi, klipovi i gotovi videi).
- `data/recordings/` su tvoji snimci gameplaya.
- `data/shorts/` su izrezani Shorts, a `data/thumbnails/` thumbnailovi koje si napravio.
- `data/bumpers/` su intro i outro klipovi, a `data/videos/` gotovi videi.
- `data/models/` je model za prepoznavanje govora.
- `data/thumbs/` su sličice za prikaz u aplikaciji.
- `.env` sadrži podešavanja.

Folder `data/` i fajl `.env` nisu u gitu. Napravi im rezervnu kopiju ako ti je sadržaj bitan.

## Struktura koda

```
src/server.js        rute i HTTP server
src/views.js         HTML stranice
src/lib/media.js     ffmpeg: analiza zvuka, prijedlozi trenutaka, rezanje u 9:16, spajanje dijelova i titlovi
src/lib/studio.js    skeniranje foldera sa snimcima i redovi poslova za analizu, rezanje i spajanje
src/lib/db.js        SQLite šema (ugrađeni node:sqlite)
public/              CSS i JavaScript za preglednik
```

## Česti problemi

- **"ffmpeg is not installed"**: instaliraj ffmpeg (korak 1) i ponovo pokreni aplikaciju. Ako je na neobičnom mjestu, upiši putanje u `.env` kao `FFMPEG_PATH` i `FFPROBE_PATH`.
- **Snimak se ne pojavljuje nakon skeniranja**: fajl se možda još kopira. Sačekaj da kopiranje završi i skeniraj ponovo.
- **Aplikacija se ne otvara sa drugog uređaja**: to je namjerno. Nema prijave, pa se javlja samo na računaru na kojem radi (`HOST=127.0.0.1` u `.env`).
