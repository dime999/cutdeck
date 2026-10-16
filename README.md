# CutDeck

Lokalna web aplikacija koja od snimaka gameplaya pravi videe spremne za YouTube.
Radi na tvom računaru, besplatna je i nema vanjskih biblioteka: trebaju ti samo Node.js i ffmpeg.

**Šta radi sada:**

- Vodi biblioteku snimaka iz jednog foldera, sa sličicom i vremenskom trakom glasnoće.
- Predlaže najglasnije trenutke svakog snimka kao kandidate za Shorts.
- Reže izabrani dio u vertikalni Short (1080×1920), sa cijelim kadrom na zamućenoj pozadini ili izrezom dijela slike.
- Pravi thumbnail (JPG 1280×720) od kadra iz snimka, sa tekstom i doradom slike.
- Ubacuje memove iz tvoje biblioteke preko Shorta: sam predloži mjesta na glasnim trenucima, ili ih postaviš ručno.
- Po izboru stavlja tvoj logo (watermark) u ugao Shorta ili klipa.
- Dodaje intro i outro na cijeli snimak ili na Short i pravi gotov video.
- Spaja više videa (snimke, Shorts, intro i outro klipove) u jedan, redom koji zadaš.
- Pravi engleske titlove iz tvog govora u Shortu i upisuje ih u sliku, sa isticanjem riječi koja se izgovara.
- Jednim klikom od izabranog dijela snimka pravi Short s titlovima, introm i outrom.
- Reže cijeli snimak na Shorts zadane dužine, sa natpisom PART 1, PART 2… i titlovima.
- Priprema paket za objavu: naslov, opis, hashtagove, tagove i thumbnail, spremne za kopiranje u YouTube Studio.
- U odvojenoj sekciji **Clipping** pravi klipove tuđe epizode za clipping kampanje: transkript cijele epizode s pretragom, hook na početku, izbacivanje pauza, provjera pravila kampanje i tekst za objavu po platformama.
- Nema prijave: aplikacija je za jednog korisnika i dostupna je samo sa računara na kojem radi.

Aplikacija ne objavljuje ništa na YouTube. Gotov video skineš i postaviš ga sam kroz YouTube Studio.

Kako je sve napravljeno i zašto, stoji u [bazi znanja](docs/KNOWLEDGE_BASE.md).

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
6. Za brisanje više Shortsa odjednom označi kvačice na pločicama (ili **Select all**) i klikni **Delete selected**.

**Sve jednim klikom.** Ispod naslova u istoj formi možeš uključiti **Add captions from the voice** i izabrati intro i outro. Tada **Create Short** uradi sve redom: izreže Short, prepozna govor i upiše titlove (u stilu koji si zadnji put sačuvao na stranici titlova), pa doda intro i outro. Gotov rezultat je na stranici **Videos** ako ima intro ili outro, a inače na stranici **Shorts**. Izbor se pamti za sljedeći put. Međukoraci (Short bez titlova i Short s titlovima) ostaju na stranici Shorts.

Prijedlozi se zasnivaju samo na glasnoći zvuka, pa ih uvijek pregledaj prije rezanja. Uklanjanje snimka sa liste ne briše fajl sa diska.

## Auto edit dugog videa (bez komentara)

Od sirovog snimka igranja pravi dugi video spreman za YouTube.

1. Otvori snimak i klikni **Auto edit long video**. Aplikacija prvo pregleda snimak (pokret slike, crna slika, glasnoća); sat snimka traje nekoliko minuta.
2. Dobiješ plan: traka snimka pokazuje šta ostaje (zeleno), šta se izbacuje (učitavanja, meniji, pauze, dug hod bez akcije) i odakle je najava. Izaberi dužinu (sve akcije ili oko 45/30/20/12 minuta) i koliko jako se reže, pa **Update the plan**.
3. Poglavlja nastaju na mjestima izbačenih učitavanja; preimenuj ih po misijama. Ispod su prijedlozi za thumbnail: klik otvara editor thumbnaila na tom kadru.
4. Upiši naslov, po želji logo, intro i outro, izaberi kvalitet (1080p ili kao snimak, do 4K) i klikni **Create the video**.

Video počinje najavom od 12 sekundi (najjači trenutak), pa ide od početka. Glasnoća se ujednačava na −14 LUFS, HDR snimci (PS5) se pretvaraju da boje ne budu isprane, a snimak se nikad ne povećava iznad svoje rezolucije. Gotov video je pod **Videos**, a njegov paket za objavu je već popunjen naslovom i opisom s poglavljima. Plan gleda samo pokret i zvuk igre: ne zna razliku između cutscene koju želiš i praznog hoda, pa plan pogledaj prije pravljenja.

## Shortsi iz kompilacije (po scenama)

Za duži video koji je kompilacija klipova: svaki klip postaje svoj Short, tačno svoje dužine.

1. Otvori snimak i klikni **Shorts from scenes**. Aplikacija pregleda svaku sličicu i nađe rezove između klipova (deset minuta videa traje oko minut).
2. Dobiješ listu scena sa sličicom, vremenom i dužinom. Klik na sličicu pusti tu scenu.
3. **Cuts** određuje koliko jak rez se računa kao novi klip. Short nikad nije kraći od 15 s: kraća scena se spaja sa kraćom susjednom (i kad tu susjednu odznačiš); **Shortest Short** može podići granicu na 20 ili 30 s. Crni prelazi između klipova se sami izbace.
4. Ako je jedan klip ipak razbijen na dva, označi **Join with the next**; scene koje ne želiš odznači.
5. Ispod playera biraš šta svaki Short odmah dobija: titlove iz glasa i tvoj logo (oba su unaprijed uključena, a izbor se pamti), raspored i naslov (Shortsi dobiju #1, #2…). Klikni **Create … Shorts**; ništa ne moraš dodavati naknadno.

Scena duža od 3 minute se dijeli na jednake dijelove, jer Short ne može biti duži. Gotovi Shortsi su pod **Shorts**, gdje im možeš dodati memove.

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

## Memovi

1. Na stranici **Memes** dodaj kratke reakcijske klipove (MP4, MOV, WebM, MKV ili GIF) i meme zvukove (MP3, WAV, OGG, M4A), do 20 sekundi. Zvuk se u Shortu samo čuje, ništa ne iskače; za zvuk + sliku stavi zvuk i klip na istu sekundu. Na pločici zvuka je dugme **Play**.
2. Na stranici **Shorts**, u meniju Shorta (tri tačke), izaberi **Memes**. Aplikacija odmah predloži mjesta: najglasnije trenutke Shorta, do tri, barem 7 sekundi jedan od drugog, i uz svaki mem iz biblioteke.
3. Pusti Short: memovi iskaču preko playera tačno kako će izgledati. Za svaki mem možeš promijeniti koji je, kada počinje (**Now** uzme vrijeme iz playera), gdje stoji (gore, sredina, dole) i koliki je. **Add meme here** dodaje mem na mjesto gdje je player zaustavljen.
**Efekti uz zvukove.** Svaki mem nosi efekat na samom snimku igre dok traje: Punch zoom (brzi zum), Screen shake (trešnja), Hype (trešnja, pulsirajući zum i jače boje), Zoom with dark edges, Sad (crno-bijelo i spori zum) ili Glitch (trzaj, pomak boja i crveni bljesak). Novi zvuk dobije efekat po imenu (Vine boom → zum, metal pipe → trešnja, airhorn → hype, violina → sad, error → glitch); u biblioteci ga mijenjaš uz ime (**Save**), a za jedan Short u koloni **Effect**. Pregled pokazuje efekat na playeru.

4. Klikni **Create Short with memes**. Nastaje novi Short s nastavkom "(memes)", a original ostaje.

Mem je kartica sa zaobljenim uglovima i mekom sjenom. Ulazi odskokom: izleti odozdo, prebaci malo iznad svog mjesta i smiri se, uz pojavljivanje; na kraju se spusti i izblijedi. Traje najviše 5 sekundi, a zvuk igre se dok traje glatko utiša. Ime mema mijenjaš direktno na njegovoj pločici (**Rename**). Memove skidaš sam: većina su isječci iz tuđih filmova i videa, pa vrijede ista pravila o autorskim pravima kao za ostali tuđi materijal.

## Logo (watermark)

1. Na stranici **Logo watermark** dodaj svoj logo jednom: PNG s providnom pozadinom izgleda najbolje, a radi i JPG ili WebP (do 10 MB).
2. Izaberi ugao, veličinu i vidljivost. Pregled pokazuje gdje će logo stajati u vertikalnom Shortu.
3. Kad praviš Short, dijeliš snimak na dijelove ili praviš klip u kampanji, štikliraj **Add my logo**. Bez kvačice video ostaje čist.

Logo se crta ispod titlova i odmaknut je od dugmadi i teksta koje TikTok i YouTube crtaju preko videa. Kad se Shortu dodaju titlovi, logo ostaje. Promjena podešavanja ili brisanje loga ne mijenja Shortse koji su već napravljeni. Klipu kampanje logo možeš uključiti ili isključiti i naknadno, u **Edit clip**.

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

## Clipping (kampanje)

Sekcija **Clipping** je odvojena od ostatka aplikacije i služi za kampanje u kojima klipaš tuđu epizodu po zadanim pravilima. Klipovi iz kampanje se ne pojavljuju na stranici **Shorts**.

1. Kopiraj epizodu u `data/recordings` i klikni **Scan folder** na stranici **Recordings**.
2. Na stranici **Campaigns** napravi kampanju: ime, epizoda, hashtagovi (npr. `#r3born`), nalog koji se taguje na svakoj platformi, riječi koje se ne smiju pojaviti (npr. `FaZe`) i najkraća dozvoljena dužina klipa.
3. Otvori kampanju i klikni **Transcribe the episode**. Aplikacija presluša cijelu epizodu (treba isti model kao za titlove).
4. U polje **Search what is said** upiši riječ ili frazu. Klik na red pusti to mjesto u playeru, a dugmad **Start here**, **End here** i **Use as hook** upišu ga u formu. Redovi koji su već u nekom klipu imaju zelenu crtu.
5. Po želji zadaj **hook** (najjača sekunda ili dvije scene, koja se pušta prva) i ostavi uključeno **Cut out pauses in the talking**, koje izbacuje tišine duže od 0,6 s.
6. Klikni **Create clip**. Titlovi dolaze iz transkripta i odmah su u slici. Ako se scena većim dijelom poklapa s klipom koji već imaš, aplikacija te upozori.
7. Otvori gotov klip. **Campaign rules** pokazuje šta je u redu, a šta treba popraviti: dužina, titlovi, zabranjene riječi u naslovu, opisu i titlovima, te da li si napisao opis.
8. Napiši kratak opis svojim riječima. Ispod dobiješ gotov tekst za YouTube Shorts, TikTok, Instagram Reels i X, svaki s pravim tagom i hashtagovima kampanje. Klikni **Copy**, objavi klip sam, pa označi **Posted** i po želji upiši link.

**Prijedlozi.** Kad je epizoda transkribovana, u kartici **Suggest clips** izaberi koliko scena želiš (5 do 20) i približnu dužinu (15, 30 ili 45 s), pa klikni **Find scenes**. Aplikacija izabere najglasnije scene s najviše govora i reže ih na kraju rečenice. Na stranici **Suggested scenes** svaku scenu pustiš dugmetom **Play**, pročitaš šta se u njoj kaže i odznačiš slabe; ispod svake piše i koji dio bi bio hook. Tek **Create N clips** pravi klipove, s titlovima. Scene koje su već u tvojim klipovima se ne nude, pa novo traženje daje nove scene. **Stop creating clips** uklanja nedovršene klipove. Izbor ne zna šta je smiješno ili zanimljivo, zato pregled i postoji.

**Hook bez ručnog rada.** Ako polja za hook ostaviš prazna, a uključeno je **Pick the hook for me**, aplikacija u sceni nađe do tri sekunde govora glasnije od ostatka i pusti ih prve. Ako se nijedan dio ne ističe, klip ostaje bez hooka i poruka to kaže. Prve tri sekunde scene se ne uzimaju, jer klip njima ionako počinje.

**Izmjena gotovog klipa.** Na stranici klipa otvori **Edit this clip**: možeš pomjeriti početak i kraj, promijeniti ili obrisati hook, promijeniti raspored i ispraviti riječi u titlovima (prazan red se briše). **Save and create again** pravi klip iznova u isti fajl; opis i evidencija objava ostaju. Ako promijeniš rez, titlovi se uzimaju iznova iz transkripta, pa ispravke riječi radi nakon reza.

Stranica kampanje ima četiri taba: **Clips** (gotovi klipovi), **Find scenes** (prijedlozi), **Cut by hand** (player, transkript i ručni rez) i **Rules** (pravila). Za brisanje više klipova odjednom označi kvačice na pločicama (ili **Select all**) i klikni **Delete selected**. Kampanju brišeš dugmetom **Delete campaign** u zaglavlju ili dugmetom **Delete** na njenoj kartici.

Za drugačiji rez iste scene klikni **Make a variation** na klipu: forma se otvori s istim početkom i krajem, pa promijeni hook ili raspored.

Aplikacija ne može provjeriti da li je snimak iz prave epizode, da li je klip prijavljen i u drugu kampanju, ni ko ti gleda videe. **Split into Shorts** ne koristi za kampanje: niz PART 1, PART 2… je isto što i objava cijele epizode, što kampanje zabranjuju.

## Gdje su podaci

- `data/app.db` je baza (snimci, Shorts, thumbnailovi, klipovi i gotovi videi).
- `data/recordings/` su tvoji snimci gameplaya.
- `data/shorts/` su izrezani Shorts, a `data/thumbnails/` thumbnailovi koje si napravio.
- `data/brand/` je tvoj logo, a `data/memes/` tvoji memovi.
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
src/clipping-*.js    rute i stranice sekcije Clipping
src/lib/clipping.js  pravila kampanje, hook, izbacivanje pauza, tekst za objavu
public/              CSS i JavaScript za preglednik
```

## Česti problemi

- **"ffmpeg is not installed"**: instaliraj ffmpeg (korak 1) i ponovo pokreni aplikaciju. Ako je na neobičnom mjestu, upiši putanje u `.env` kao `FFMPEG_PATH` i `FFPROBE_PATH`.
- **Snimak se ne pojavljuje nakon skeniranja**: fajl se možda još kopira. Sačekaj da kopiranje završi i skeniraj ponovo.
- **Aplikacija se ne otvara sa drugog uređaja**: to je namjerno. Nema prijave, pa se javlja samo na računaru na kojem radi (`HOST=127.0.0.1` u `.env`).
