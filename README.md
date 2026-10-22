# CINETABLE API

Questo progetto è un'utility creata al volo per organizzare una serata degli Oscar con gli amici.
Permette all'admin di creare un evento e a chiunque di registrarsi e inviare una candidatura, sulla base di una categoria, in forma completamente anonima: il vincitore uscirà allo scoperto solo al momento dell'assegnazione dei premi!

NB: il nome deriva da un errore di battitura dell'organizzatrice, che simpaticamente abbiamo deciso di mantenere, don't be silly!

## Run locally

1) Setup postgres
```
cd docker/
docker-compose up --build -d postgresql
```
2) Setup Node.js, Yarn and Install dependencies

```
nvm use 18.15.0
yarn install
cp .env.example .env
```
Nel `DATABASE_URL` non usare `connection_limit=1`: le operazioni del gioco tengono un lock sull'edizione dentro una transazione e, con una sola connessione, le richieste concorrenti restano in coda fino al timeout. L'esempio usa `connection_limit=5`.
#### IMPORTANTE
3) Aggiungere nel proprio .yarnrc.yml la parte relativa a prisma presente nel .yarnrc.yml.example

4) Setup prisma config and Run application
```
yarn prisma generate
yarn dev
```

5) Migrazioni
```
npx prisma migrate deploy   # DB vuoto: applica le migrazioni esistenti
npx prisma migrate reset    # solo sviluppo: azzera e ricrea il DB
```

6) Tests
```
cp .env.test.example .env.test   # poi inserire le credenziali del DB locale
# creare il database `cinetable_test` (es. createdb cinetable_test)
yarn test
```
`yarn test` resetta il DB `cinetable_test`, compila ed esegue i test.

7) E2E del frontend
```
cp .env.e2e.example .env.e2e     # poi inserire le credenziali del DB locale
# creare il database `cinetable_e2e` (es. createdb cinetable_e2e)
yarn build
node scripts/e2e-seed.js base    # base | open | screening | final | done
```
Gli e2e di `cinetable-fe` (`npm run e2e`) avviano questo backend sulla porta 5055 con `.env.e2e` (`TRUST_PROXY=1`: Next è l'unico hop e inoltra così com'è l'`X-Forwarded-For` diverso che ogni test manda, così i rate limit per IP non si sommano) e chiamano `scripts/e2e-seed.js` prima di ogni test. Lo script rifiuta un `DATABASE_URL` il cui nome del database non finisca con `_e2e`, svuota tutte le tabelle e ricrea sempre gli stessi dati con gli stessi id; scenari, token fissi e voti attesi sono descritti in testa al file.

Swagger documentation is available at `http://localhost:5000/docs`

## TMDB

La ricerca film usa [TMDB](https://www.themoviedb.org/). Per ottenere il token: crea un account, poi Impostazioni > API > richiedi una chiave (uso personale) e copia l'"API Read Access Token" in `TMDB_API_TOKEN` nel tuo `.env` (obbligatorio in production). Il token resta sul backend.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Build

```
yarn build
```
Build output will be available at `/dist/`

## Deploy

- Questa versione richiede un database **vuoto**: si riparte da zero (nessuna migrazione dei dati precedenti).
- In production `JWT_SECRET` (min 32 caratteri) e `CLIENT_URL` sono obbligatori, altrimenti l'avvio fallisce.
- Topologia: frontend Next su **Vercel**, backend su un host pubblico. Vercel inoltra `/api/*` a `<backend>/sub/api/*` aggiungendo l'header `x-origin-secret`.
  - `ORIGIN_SECRET` (min 32 caratteri casuali, obbligatorio in production): ogni richiesta (qualunque path, anche le rotte inesistenti) senza `x-origin-secret` uguale riceve 403 `{ "code": "ORIGIN_FORBIDDEN" }`. È ciò che rende il backend raggiungibile solo passando da Vercel. Stesso valore nelle variabili del progetto Vercel. Assente (sviluppo, e2e) = controllo spento.
  - `CLIENT_URL` = dominio pubblico del frontend (es. `https://cinetable.example`): serve per CORS e per i link nelle email.
  - Tutte le risposte hanno `Cache-Control: no-store`.
  - **Una sola istanza** del backend: il cron dei promemoria gira nel processo, con più istanze le email partirebbero doppie.
- Rate limit per IP e proxy (`TRUST_PROXY`):
  - `TRUST_PROXY` è il **numero di proxy fidati** davanti al backend (hop count), non `true`. Con Vercel davanti vale `1`: l'edge di Vercel **sovrascrive** `x-forwarded-for` con l'IP reale del client e lo inoltra, il backend prende l'ultima voce. Ogni altro proxy fra Vercel e il backend che *aggiunge* il proprio peer a `X-Forwarded-For` vale un hop in più. `false` (o assente) = nessun proxy: tutti i client avrebbero lo stesso IP. `TRUST_PROXY=true` non è valido: in production l'avvio fallisce.
  - Il backend è pubblico, ma chi non conosce `ORIGIN_SECRET` non raggiunge nessuna rotta: un `X-Forwarded-For` falso inviato direttamente si ferma al 403. Verificare con una richiesta di prova quale IP vede il backend prima di affidarsi ai rate limit.
  - Senza Vercel (es. nginx davanti a Next): il proxy di bordo deve sovrascrivere `X-Forwarded-For` (`proxy_set_header X-Forwarded-For $remote_addr;`) e aggiungere `x-origin-secret`.
- Email (verifica, reset password, inviti): configurare `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`. Se l'SMTP non risponde le richieste riescono comunque e l'errore viene solo registrato nei log.
