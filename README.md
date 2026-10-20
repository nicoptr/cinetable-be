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
Gli e2e di `cinofili-fe` (`npm run e2e`) avviano questo backend sulla porta 5055 con `.env.e2e` (`TRUST_PROXY=true`: ogni test manda un `X-Forwarded-For` diverso, così i rate limit per IP non si sommano) e chiamano `scripts/e2e-seed.js` prima di ogni test. Lo script rifiuta un `DATABASE_URL` il cui nome del database non finisca con `_e2e`, svuota tutte le tabelle e ricrea sempre gli stessi dati con gli stessi id; scenari, token fissi e voti attesi sono descritti in testa al file.

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
- Il backend gira dietro il frontend Next (che inoltra `/api/*` a `/sub/api/*`) con `TRUST_PROXY=true`, altrimenti i rate limit per IP vedono solo l'IP del proxy. Con `TRUST_PROXY=true` il backend **non deve essere raggiungibile direttamente** da Internet: chiunque potrebbe inviare un `X-Forwarded-For` falso e aggirare i rate limit. Esporre solo il frontend (rete privata, firewall o bind su localhost).
- Email (verifica, reset password, inviti): configurare `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`. Se l'SMTP non risponde le richieste riescono comunque e l'errore viene solo registrato nei log.
