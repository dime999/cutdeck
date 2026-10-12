'use strict';
// HTML šabloni. Sve vrijednosti od korisnika prolaze kroz h() (escape).
const cfg = require('./lib/config');
const { CATEGORIES } = require('./lib/youtube');

const h = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const YT_TOS = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const GOOGLE_PERMISSIONS = 'https://myaccount.google.com/connections';

function layout(ctx, title, body) {
  const user = ctx.user;
  const nav = (href, label) =>
    `<a href="${href}" class="${ctx.path.startsWith(href) ? 'active' : ''}">${label}</a>`;
  const flash = ctx.flash
    ? `<div class="flash ${h(ctx.flash.type)}" role="status">${h(ctx.flash.msg)}</div>`
    : '';
  return `<!doctype html>
<html lang="bs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)} · ${h(cfg.appName)}</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>▶</text></svg>">
</head>
<body>
<header class="top">
  <a class="brand" href="/">${h(cfg.appName)}</a>
  ${
    user
      ? `<nav>${nav('/upload', 'Novi video')}${nav('/dashboard', 'Objave')}${nav('/accounts', 'Kanali')}</nav>
         <form method="post" action="/logout" class="logout"><span class="who">${h(user.name)}</span><button class="link">Odjava</button></form>`
      : ''
  }
</header>
<main>
${flash}
${body}
</main>
<footer class="foot">
  <a href="/privacy">Politika privatnosti</a> · <a href="/terms">Uslovi korištenja</a>
</footer>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

// ── Prijava i registracija ─────────────────────────────────
function loginPage(ctx, { email = '', error = '' } = {}) {
  return layout(
    ctx,
    'Prijava',
    `<section class="card narrow">
  <h1>Prijava</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="/login" class="stack">
    <label>Email<input type="email" name="email" value="${h(email)}" required autofocus autocomplete="email"></label>
    <label>Lozinka<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="primary">Prijavi se</button>
  </form>
  <p class="muted">Nemaš nalog? <a href="/register">Registruj se</a></p>
</section>`
  );
}

function registerPage(ctx, { values = {}, error = '', needsInvite = true } = {}) {
  return layout(
    ctx,
    'Registracija',
    `<section class="card narrow">
  <h1>Registracija</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="/register" class="stack">
    <label>Ime<input name="name" value="${h(values.name)}" required maxlength="60" autocomplete="name"></label>
    <label>Email<input type="email" name="email" value="${h(values.email)}" required autocomplete="email"></label>
    <label>Lozinka <span class="muted">(najmanje 8 znakova)</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
    ${needsInvite ? `<label>Pozivni kod<input name="invite" value="${h(values.invite)}" required></label>` : ''}
    <button class="primary">Napravi nalog</button>
  </form>
  <p class="muted">Već imaš nalog? <a href="/login">Prijavi se</a></p>
</section>`
  );
}

// ── Kanali ────────────────────────────────────────────────
function accountsPage(ctx, { accounts, configured }) {
  const rows = accounts
    .map(
      (a) => `<li class="account">
    ${a.thumbnail ? `<img src="${h(a.thumbnail)}" alt="" width="40" height="40">` : '<span class="avatar"></span>'}
    <div class="grow">
      <strong>${h(a.name)}</strong>
      <span class="muted small">YouTube · povezan <time data-local="${h(a.created_at)}">${h(a.created_at)}</time></span>
    </div>
    ${
      a.status === 'active'
        ? '<span class="chip ok">Aktivan</span>'
        : `<span class="chip warn">Treba ponovo povezati</span><a class="button" href="/oauth/youtube/start">Ponovo poveži</a>`
    }
    <form method="post" action="/accounts/${a.id}/disconnect" data-confirm="Odspojiti kanal „${h(a.name)}“? Aplikacija će izgubiti pristup ovom kanalu.">
      <button class="danger-outline">Odspoji</button>
    </form>
  </li>`
    )
    .join('');

  return layout(
    ctx,
    'Kanali',
    `<div class="page-head">
  <h1>Povezani kanali</h1>
  ${configured ? '<a class="button primary" href="/oauth/youtube/start">+ Poveži YouTube kanal</a>' : ''}
</div>
${
  configured
    ? ''
    : `<div class="notice warn"><strong>Google pristup nije podešen.</strong> Upiši GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET u <code>.env</code> i ponovo pokreni aplikaciju (vidi README, korak 1).</div>`
}
${
  accounts.length
    ? `<ul class="list">${rows}</ul>`
    : '<div class="empty">Još nema povezanih kanala.</div>'
}
<div class="notice">
  <p><strong>Više kanala na jednom Google nalogu?</strong> Klikni „Poveži YouTube kanal“ za svaki kanal posebno i na Googleovom ekranu izaberi željeni kanal (brand nalog).</p>
  <p>Pristup možeš opozvati i direktno u <a href="${GOOGLE_PERMISSIONS}" target="_blank" rel="noopener">postavkama Google naloga</a>.</p>
  ${
    cfg.ytAudited
      ? ''
      : '<p><strong>Napomena:</strong> dok Google ne odobri audit, prijava ističe nakon 7 dana i kanal se mora ponovo povezati.</p>'
  }
</div>`
  );
}

// ── Novi video ────────────────────────────────────────────
function uploadPage(ctx, { accounts }) {
  const active = accounts.filter((a) => a.status === 'active');
  const channelList = active
    .map(
      (a) => `<label class="channel">
      <input type="checkbox" name="accounts" value="${a.id}">
      ${a.thumbnail ? `<img src="${h(a.thumbnail)}" alt="" width="28" height="28">` : '<span class="avatar sm"></span>'}
      <span>${h(a.name)}</span>
    </label>`
    )
    .join('');

  const auditBanner = cfg.ytAudited
    ? ''
    : `<div class="notice warn"><strong>Projekat još nije prošao Google audit.</strong> YouTube će svaki video zaključati kao privatan, bez obzira na izbor ispod. Koristi testni kanal dok audit ne bude odobren.</div>`;

  if (!active.length) {
    return layout(
      ctx,
      'Novi video',
      `<h1>Novi video</h1>${auditBanner}
<div class="empty">Prvo poveži barem jedan kanal. <a class="button primary" href="/accounts">Idi na Kanale</a></div>`
    );
  }

  return layout(
    ctx,
    'Novi video',
    `<h1>Novi video</h1>
${auditBanner}
<form id="upload-form" class="grid" novalidate>
  <section class="card">
    <h2>1. Video</h2>
    <label class="drop" id="drop">
      <input type="file" name="file" id="file" accept="video/*" required>
      <span id="drop-text"><strong>Izaberi video</strong> ili ga prevuci ovdje</span>
    </label>

    <h2>2. Detalji</h2>
    <label>Naslov <span class="counter" data-for="title" data-max="100"></span>
      <input name="title" id="title" maxlength="100" required>
    </label>
    <label>Opis <span class="counter" data-for="description" data-max="5000"></span>
      <textarea name="description" id="description" rows="6" maxlength="5000"></textarea>
    </label>
    <label>Tagovi <span class="muted">(odvojeni zarezom)</span>
      <input name="tags" placeholder="npr. vlog, putovanje, sarajevo">
    </label>
    <label>Kategorija
      <select name="category">${CATEGORIES.map(([id, n]) => `<option value="${id}">${h(n)}</option>`).join('')}</select>
    </label>

    <fieldset>
      <legend>Vidljivost</legend>
      <label class="radio"><input type="radio" name="privacy" value="public" required> <span><strong>Javno</strong> – svi mogu vidjeti</span></label>
      <label class="radio"><input type="radio" name="privacy" value="unlisted"> <span><strong>Nenavedeno</strong> – samo ko ima link</span></label>
      <label class="radio"><input type="radio" name="privacy" value="private"> <span><strong>Privatno</strong> – samo ti</span></label>
    </fieldset>

    <fieldset>
      <legend>Da li je video napravljen za djecu?</legend>
      <label class="radio"><input type="radio" name="made_for_kids" value="no" required> <span>Ne, nije napravljen za djecu</span></label>
      <label class="radio"><input type="radio" name="made_for_kids" value="yes"> <span>Da, napravljen je za djecu</span></label>
      <p class="muted small">Ovo zahtijeva zakon (COPPA) i YouTube pravila.</p>
    </fieldset>

    <details>
      <summary>Zakaži objavu (opcionalno)</summary>
      <label>Datum i vrijeme objave
        <input type="datetime-local" name="schedule" id="schedule">
      </label>
      <p class="muted small">Video se odmah uploaduje kao privatan i automatski postaje javan u zadato vrijeme. Za zakazivanje izaberi „Javno“.</p>
    </details>
  </section>

  <section class="card">
    <h2>3. Kanali</h2>
    <label class="channel all"><input type="checkbox" id="select-all"> <span>Označi sve (${active.length})</span></label>
    <div class="channels">${channelList}</div>

    <p class="legal">
      Objavljivanjem potvrđuješ da prihvataš <a href="${YT_TOS}" target="_blank" rel="noopener">YouTube uslove korištenja</a>
      i da se Google podaci obrađuju prema <a href="${GOOGLE_PRIVACY}" target="_blank" rel="noopener">Google politici privatnosti</a>.
      Video se objavljuje samo na kanalima koje si označio.
    </p>

    <p class="error" id="form-error" hidden></p>
    <div class="progress" id="progress" hidden><div class="bar"></div><span class="label"></span></div>
    <button class="primary big" id="submit">Objavi na označenim kanalima</button>
  </section>
</form>`
  );
}

// ── Objave ────────────────────────────────────────────────
const STATUS = {
  pending: ['Na čekanju', 'muted'],
  uploading: ['Šalje se', 'info'],
  done: ['Objavljeno', 'ok'],
  failed: ['Greška', 'bad'],
};
const PRIVACY = { public: 'Javno', unlisted: 'Nenavedeno', private: 'Privatno' };

function fmtSize(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function dashboardPage(ctx, { videos, uploadsToday }) {
  const active = videos.some((v) => v.jobs.some((j) => j.status === 'uploading' || j.status === 'pending'));

  const cards = videos
    .map((v) => {
      const busy = v.jobs.some((j) => j.status === 'uploading');
      const jobs = v.jobs
        .map((j) => {
          const [label, cls] = STATUS[j.status] || [j.status, 'muted'];
          return `<li class="job">
          <div class="grow">
            <strong>${h(j.account_name)}</strong>
            ${j.status === 'uploading' ? `<div class="progress small"><div class="bar" style="width:${j.progress}%"></div><span class="label">${j.progress}%</span></div>` : ''}
            ${j.error ? `<p class="small ${j.status === 'failed' ? 'error' : 'muted'}">${h(j.error)}</p>` : ''}
          </div>
          <span class="chip ${cls}">${label}</span>
          ${j.external_url ? `<a class="button" href="${h(j.external_url)}" target="_blank" rel="noopener">Otvori</a>` : ''}
          ${
            j.status === 'failed'
              ? `<form method="post" action="/jobs/${j.id}/retry"><button>Pokušaj ponovo</button></form>`
              : ''
          }
        </li>`;
        })
        .join('');
      const done = v.jobs.filter((j) => j.status === 'done').length;
      return `<article class="card video">
      <div class="video-head">
        <div class="grow">
          <h2>${h(v.title)}</h2>
          <p class="muted small">
            ${PRIVACY[v.privacy] || h(v.privacy)}
            ${v.publish_at ? ` · zakazano za <time data-local="${h(v.publish_at)}">${h(v.publish_at)}</time>` : ''}
            · ${fmtSize(v.size)} · <time data-local="${h(v.created_at)}">${h(v.created_at)}</time>
            · ${done}/${v.jobs.length} objavljeno
          </p>
        </div>
        ${
          busy
            ? ''
            : `<form method="post" action="/videos/${v.id}/delete" data-confirm="Obrisati ovaj zapis iz aplikacije? Videi koji su već na YouTubeu ostaju tamo."><button class="danger-outline">Obriši zapis</button></form>`
        }
      </div>
      <ul class="jobs">${jobs}</ul>
    </article>`;
    })
    .join('');

  return layout(
    ctx,
    'Objave',
    `<div class="page-head">
  <h1>Objave</h1>
  <a class="button primary" href="/upload">+ Novi video</a>
</div>
<p class="muted small quota">Uploada danas (Google kvota se resetuje u 09:00 po našem vremenu): <strong>${uploadsToday}</strong> / ~100</p>
${videos.length ? cards : '<div class="empty">Još nema objava. <a href="/upload">Objavi prvi video</a></div>'}
${active ? '<div data-autorefresh="4000" hidden></div>' : ''}`
  );
}

// ── Pravne stranice (trebaju za Google audit) ──────────────
function privacyPage(ctx) {
  const contact = cfg.contactEmail ? `<a href="mailto:${h(cfg.contactEmail)}">${h(cfg.contactEmail)}</a>` : 'administratora aplikacije';
  return layout(
    ctx,
    'Politika privatnosti',
    `<article class="card prose">
<h1>Politika privatnosti</h1>
<p class="muted">Posljednja izmjena: 12. oktobar 2026.</p>

<p>${h(cfg.appName)} je aplikacija koja korisnicima omogućava da jedan video objave na više svojih YouTube kanala odjednom. Ova politika objašnjava koje podatke aplikacija koristi i zašto.</p>

<h2>YouTube API usluge</h2>
<p>${h(cfg.appName)} koristi YouTube API usluge. Korištenjem aplikacije prihvataš <a href="${YT_TOS}" target="_blank" rel="noopener">YouTube uslove korištenja</a>. Podaci dobijeni od Googlea obrađuju se i u skladu sa <a href="${GOOGLE_PRIVACY}" target="_blank" rel="noopener">Google politikom privatnosti</a>.</p>

<h2>Koje podatke prikupljamo</h2>
<ul>
  <li><strong>Podaci naloga:</strong> ime, email adresa i lozinka (sačuvana samo kao kriptografski hash).</li>
  <li><strong>Podaci YouTube kanala:</strong> ID kanala, naziv i sličica kanala, preuzeti preko YouTube API-ja kada povežeš kanal.</li>
  <li><strong>OAuth tokeni:</strong> pristupni tokeni koje izdaje Google, sačuvani šifrovano (AES-256-GCM).</li>
  <li><strong>Video sadržaj:</strong> video fajl, naslov, opis, tagovi i postavke koje uneseš.</li>
</ul>

<h2>Kako koristimo podatke</h2>
<p>Podatke koristimo isključivo da bismo, na tvoj izričit zahtjev, uploadovali video na kanale koje si označio i prikazali status objave. Aplikacija ne čita, ne analizira i ne mijenja ništa drugo na tvojim kanalima. Dozvole koje tražimo su <code>youtube.upload</code> (objava videa) i <code>youtube.readonly</code> (prikaz naziva i sličice kanala).</p>

<h2>Dijeljenje podataka</h2>
<p>Podatke ne prodajemo i ne dijelimo sa trećim stranama. Jedina strana kojoj se podaci šalju je Google/YouTube, i to samo radi objave videa koju si sam pokrenuo.</p>

<h2>Čuvanje i brisanje</h2>
<ul>
  <li>Video fajl se automatski briše sa servera aplikacije čim je objavljen na svim izabranim kanalima.</li>
  <li>Kada odspojiš kanal, aplikacija opoziva Google pristup i briše sačuvane tokene.</li>
  <li>Pristup možeš opozvati i u bilo kojem trenutku na stranici <a href="${GOOGLE_PERMISSIONS}" target="_blank" rel="noopener">sigurnosnih postavki Google naloga</a>.</li>
  <li>Za brisanje cijelog naloga i svih podataka kontaktiraj ${contact}.</li>
</ul>

<h2>Kolačići</h2>
<p>Aplikacija koristi jedan kolačić neophodan za prijavu. Ne koristimo kolačiće za praćenje ili reklame.</p>

<h2>Kontakt</h2>
<p>Pitanja o privatnosti: ${contact}.</p>
</article>`
  );
}

function termsPage(ctx) {
  return layout(
    ctx,
    'Uslovi korištenja',
    `<article class="card prose">
<h1>Uslovi korištenja</h1>
<p class="muted">Posljednja izmjena: 12. oktobar 2026.</p>
<p>Korištenjem aplikacije ${h(cfg.appName)} prihvataš ove uslove.</p>
<ol>
  <li>Aplikacija koristi YouTube API usluge. Korištenjem aplikacije obavezuješ se na <a href="${YT_TOS}" target="_blank" rel="noopener">YouTube uslove korištenja</a>.</li>
  <li>Smiješ povezivati samo kanale koje posjeduješ ili za koje imaš dozvolu vlasnika.</li>
  <li>Odgovoran si za sadržaj koji objavljuješ, uključujući autorska prava i YouTube smjernice zajednice.</li>
  <li>Zabranjeno je koristiti aplikaciju za spam, obmanjujuće ponašanje ili zaobilaženje YouTube pravila.</li>
  <li>Aplikacija se pruža „kakva jeste“, bez garancije da će svaka objava uspjeti.</li>
  <li>Pristup možemo ukinuti nalogu koji krši ove uslove.</li>
</ol>
<p>Obrada podataka opisana je u <a href="/privacy">Politici privatnosti</a>.</p>
</article>`
  );
}

function errorPage(ctx, status, message) {
  return layout(
    ctx,
    'Greška',
    `<section class="card narrow"><h1>${status === 404 ? 'Stranica ne postoji' : 'Nešto nije u redu'}</h1><p>${h(message)}</p><p><a href="/">Nazad na početnu</a></p></section>`
  );
}

module.exports = { h, loginPage, registerPage, accountsPage, uploadPage, dashboardPage, privacyPage, termsPage, errorPage };
