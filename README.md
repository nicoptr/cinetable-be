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

Swagger documentation is available at `http://localhost:5000/docs`

## Build

```
yarn build
```
Build output will be available at `/dist/`

## Deploy

- Questa versione richiede un database **vuoto**: si riparte da zero (nessuna migrazione dei dati precedenti).
- In production `JWT_SECRET` (min 32 caratteri) e `CLIENT_URL` sono obbligatori, altrimenti l'avvio fallisce.
- Dietro un reverse proxy impostare `TRUST_PROXY=true`, altrimenti i rate limit per IP vedono solo l'IP del proxy.
- Email (verifica, reset password, inviti): configurare `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`. Se l'SMTP non risponde le richieste riescono comunque e l'errore viene solo registrato nei log.
