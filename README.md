# CINOFILI API

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
Nel `DATABASE_URL` non usare `connection_limit=1`: le operazioni del gioco tengono un lock sulla rassegna dentro una transazione e, con una sola connessione, le richieste concorrenti restano in coda fino al timeout. L'esempio usa `connection_limit=5`.
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
# creare il database `cinofili_test` (es. createdb cinofili_test)
yarn test
```
`yarn test` resetta il DB `cinofili_test`, compila ed esegue i test.

7) E2E del frontend
```
cp .env.e2e.example .env.e2e     # poi inserire le credenziali del DB locale
# creare il database `cinofili_e2e` (es. createdb cinofili_e2e)
yarn build
node scripts/e2e-seed.js base    # base | open | screening | final | done
```
Gli e2e di `cinofili-fe` (`npm run e2e`) avviano questo backend sulla porta 5055 con `.env.e2e` (`TRUST_PROXY=1`: Next è l'unico hop e inoltra così com'è l'`X-Forwarded-For` diverso che ogni test manda, così i rate limit per IP non si sommano) e chiamano `scripts/e2e-seed.js` prima di ogni test. Lo script rifiuta un `DATABASE_URL` il cui nome del database non finisca con `_e2e`, svuota tutte le tabelle e ricrea sempre gli stessi dati con gli stessi id; scenari, token fissi e voti attesi sono descritti in testa al file.

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
- Rate limit per IP e proxy (`TRUST_PROXY`):
  - Catena fidata obbligatoria: **reverse proxy di bordo** che **sovrascrive** `X-Forwarded-For` con l'indirizzo reale del client (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`) → frontend Next (inoltra `/api/*` a `/sub/api/*`) → backend. Next non aggiunge voci: inoltra l'`X-Forwarded-For` ricevuto così com'è, quindi senza un bordo che lo sovrascrive il client può scriverci quello che vuole.
  - `TRUST_PROXY` è il **numero di proxy fidati** davanti al backend (hop count), non `true`. Con la catena sopra vale `1`: il backend fida solo il socket di Next e prende l'ultima voce di `X-Forwarded-For`, cioè quella scritta dal bordo. Ogni altro proxy fra Next e il backend che *aggiunge* il proprio peer a `X-Forwarded-For` vale un hop in più. `false` (o assente) = nessun proxy: tutti i client avrebbero l'IP di Next. `TRUST_PROXY=true` non è più valido: in production l'avvio fallisce.
  - Il backend **non deve mai essere raggiungibile pubblicamente** (rete privata, firewall o bind su localhost): chi lo raggiunge direttamente sceglie il proprio IP con un `X-Forwarded-For` falso.
  - Vercel: il suo edge imposta `x-forwarded-for` con l'IP reale del client, quindi fa da proxy di bordo; resta da contare gli hop fra Vercel e il backend e verificare con una richiesta di prova quale IP vede il backend prima di affidarsi ai rate limit.
- Email (verifica, reset password, inviti): configurare `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`. Se l'SMTP non risponde le richieste riescono comunque e l'errore viene solo registrato nei log.
