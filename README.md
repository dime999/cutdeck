# CutDeck

Lokalna web aplikacija koja od snimaka gameplaya pravi videe spremne za YouTube.
Radi na tvom računaru, besplatna je i nema vanjskih biblioteka: trebaju ti samo Node.js i ffmpeg.

**Šta radi sada:**

- Vodi biblioteku snimaka iz jednog foldera, sa sličicom i vremenskom trakom glasnoće.
- Predlaže najglasnije trenutke svakog snimka kao kandidate za Shorts.
- Reže izabrani dio u vertikalni Short (1080×1920), sa cijelim kadrom na zamućenoj pozadini ili izrezom dijela slike.
- Nema prijave: aplikacija je za jednog korisnika i dostupna je samo sa računara na kojem radi.

**Šta je u planu:** pravljenje thumbnailova, dodavanje intra i outra, spajanje više videa u jedan.

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

Prijedlozi se zasnivaju samo na glasnoći zvuka, pa ih uvijek pregledaj prije rezanja. Uklanjanje snimka sa liste ne briše fajl sa diska.

## Gdje su podaci

- `data/app.db` je baza (snimci i Shorts).
- `data/recordings/` su tvoji snimci gameplaya.
- `data/shorts/` su izrezani Shorts, a `data/thumbs/` sličice.
- `.env` sadrži podešavanja.

Folder `data/` i fajl `.env` nisu u gitu. Napravi im rezervnu kopiju ako ti je sadržaj bitan.

## Struktura koda

```
src/server.js        rute i HTTP server
src/views.js         HTML stranice
src/lib/media.js     ffmpeg: analiza zvuka, prijedlozi trenutaka i rezanje u 9:16
src/lib/studio.js    skeniranje foldera sa snimcima i red poslova za analizu i rezanje
src/lib/db.js        SQLite šema (ugrađeni node:sqlite)
public/              CSS i JavaScript za preglednik
```

## Česti problemi

- **"ffmpeg is not installed"**: instaliraj ffmpeg (korak 1) i ponovo pokreni aplikaciju. Ako je na neobičnom mjestu, upiši putanje u `.env` kao `FFMPEG_PATH` i `FFPROBE_PATH`.
- **Snimak se ne pojavljuje nakon skeniranja**: fajl se možda još kopira. Sačekaj da kopiranje završi i skeniraj ponovo.
- **Aplikacija se ne otvara sa drugog uređaja**: to je namjerno. Nema prijave, pa se javlja samo na računaru na kojem radi (`HOST=127.0.0.1` u `.env`).
