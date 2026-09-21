# დეპლოი — როგორ გავიტანოთ საჯარო URL-ზე

სტუდენტებს სჭირდებათ **ერთი საჯარო `baseURL`**, რომელსაც დაუძახებენ
ლოკალური dev-სერვერიდანაც და დეპლოიმენტიდანაც.

## ⚠️ მთავარი შეზღუდვა: SQLite-ს მუდმივი დისკი სჭირდება

უფასო hosting-ებზე ფაილური სისტემა **დროებითია** — გადატვირთვაზე ბაზა იშლება
და სტუდენტების ანგარიშები ქრება შუა კვირაში. ამიტომ უფასო ვარიანტში
SQLite-ს ვცვლით **Postgres-ით** (Neon, უფასო tier).

| ვარიანტი | ფასი | ბაზა | ცივი სტარტი |
|---|---|---|---|
| **A — Render + Neon** ✅ **უფასო** | 0 ₾ | Neon Postgres | ~50 წმ — **მოგვარებადია ping-ით** |
| B — Railway + SQLite volume | ~$5/თვე | SQLite volume-ზე | არა |

**რეკომენდაცია: ვარიანტი A.** ცივი სტარტი ერთადერთი მინუსია და ის
უფასო pinger-ით სრულად იხსნება.

---

## ვარიანტი A — Render + Neon (უფასო) ✅

### 1. ბაზა — Neon (უფასო, ბარათის გარეშე)

[neon.tech](https://neon.tech) → **New Project** → დააკოპირე **pooled**
connection string:
```
postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```
> აიღე **pooler**-იანი მისამართი, არა პირდაპირი — serverless-თან ის სწორია.

Neon-ის უფასო tier: 0.5 GB, პროექტი არ იშლება. ჩვენი ბაზა რამდენიმე მეგაბაიტია.

### 2. GitHub

ატვირთე `shop-api` ცალკე რეპოზიტორიად. **კოდში არაფრის შეცვლა არ გჭირდება** —
`prisma/schema.postgres.prisma` უკვე მომზადებულია.

### 3. Render

[render.com](https://render.com) → **New → Web Service** → აირჩიე რეპო

| ველი | მნიშვნელობა |
|---|---|
| Runtime | Node |
| Build Command | `npm install && npm run generate:pg` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instance Type | **Free** |

**Environment Variables:**
```
DATABASE_URL=<Neon pooled connection string>
JWT_SECRET=<გრძელი შემთხვევითი სტრიქონი>
ACCESS_TOKEN_TTL=30m
RESET_TOKEN_TTL=10m
DEV_EXPOSE_RESET_CODE=true
ARTIFICIAL_LATENCY_MS=0
```

`JWT_SECRET`-ის გენერაცია:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> რეპოში დევს `render.yaml` — შეგიძლია **Blueprint**-ითაც შექმნა,
> მაშინ ყველა პარამეტრი ავტომატურად შეივსება (`DATABASE_URL`-ის გარდა).

`npm start` ავტომატურად გაუშვებს `prisma db push`-ს Postgres-ის სქემით —
ცხრილები თავად შეიქმნება.

### 4. 🔑 ცივი სტარტის მოგვარება — სავალდებულო ნაბიჯი

Render-ის უფასო tier **15 წუთის უმოქმედობის შემდეგ იძინებს**. პირველი
მოთხოვნა ~50 წამია — ლექციის შუაში ეს მთელ ჯგუფს აჩერებს.

**გამოსავალი: უფასო pinger, რომელიც 10 წუთში ერთხელ აღვიძებს.**

[uptimerobot.com](https://uptimerobot.com) (უფასო, 50 მონიტორი):
- **New Monitor** → HTTP(s)
- URL: `https://<შენი-დომენი>/api/health`
- Interval: **5 წუთი**

ალტერნატივა: [cron-job.org](https://cron-job.org) — ასევე უფასო.

ამის შემდეგ სერვისი მუდმივად ფხიზლადაა და ცივი სტარტი აღარ გაქვს.

> **შენიშვნა:** Render-ის უფასო tier იძლევა 750 instance-საათს თვეში.
> მუდმივად ფხიზელი სერვისი ~720 საათია — ზუსტად ჯდება, ერთი სერვისისთვის.

### 5. შემოწმება

```bash
curl https://<შენი-დომენი>/api/health
open https://<შენი-დომენი>/docs
```

---

## ვარიანტი B — Railway + SQLite volume (~$5/თვე)

თუ ფულის დახარჯვა შეგიძლია და მაქსიმალური სიმარტივე გინდა:

1. [railway.app](https://railway.app) → **Deploy from GitHub repo**
2. **Variables:**
   ```
   DATABASE_URL=file:/data/dev.db
   JWT_SECRET=<შემთხვევითი სტრიქონი>
   ACCESS_TOKEN_TTL=30m
   RESET_TOKEN_TTL=10m
   DEV_EXPOSE_RESET_CODE=true
   ```
3. **Settings → Volumes → Add Volume**, mount path: `/data`
   *(კრიტიკულია — მის გარეშე ბაზა ყოველ დეპლოიზე იშლება)*
4. Start Command გადააწერე: `npx prisma db push && node src/server.js`
   *(SQLite-ის სქემით, არა Postgres-ის)*
5. **Settings → Networking → Generate Domain**

სპინ-დაუნი არ აქვს, pinger არ სჭირდება.

---

## ლოკალური გაშვება (შენთვის)

ლოკალურად **SQLite რჩება** — Neon-ის გარეშე, ერთი წამში:

```bash
npm install
cp .env.example .env
npx prisma db push
npm run dev
```

ორი სქემა თანაარსებობს:
- `prisma/schema.prisma` — SQLite, ლოკალური
- `prisma/schema.postgres.prisma` — Postgres, დეპლოი

`npm start` (დეპლოი) იყენებს მეორეს, `npm run dev` (ლოკალი) — პირველს.
**მოდელები იდენტურია** — თუ სქემას შეცვლი, ორივეში შეცვალე.

---

## CORS

ნაგულისხმევად ყველა origin დაშვებულია — სასწავლო API-სთვის ეს სწორია
(გუნდებს სხვადასხვა preview-დომენი აქვთ და ისინი მუდმივად იცვლება).

შეზღუდვა საჭიროებისამებრ:
```
CORS_ORIGINS=https://team-alpha.vercel.app,https://team-beta.netlify.app
```

---

## რას აძლევ სტუდენტებს

ლექცია 3-ზე — მხოლოდ ეს სამი ხაზი:

```
API:     https://<შენი-დომენი>/api
Swagger: https://<შენი-დომენი>/docs
OpenAPI: https://<შენი-დომენი>/openapi.yaml
```

მათ `.env`-ში:
```
VITE_API_URL=https://<შენი-დომენი>/api
VITE_USE_MSW=false
```

**`.env` არასდროს შედის git-ში.** რეპოში მხოლოდ `.env.example`.

---

## თუ სერვისი ჩავარდა

გუნდები `VITE_USE_MSW=true`-ზე გადადიან და აგრძელებენ MSW-მოკებით.
**ამიტომაა MSW სავალდებულო სპრინტ 1-იდან** — არავინ ბლოკდება.

ასევე: `shop-api` რეპო სტუდენტებისთვის **read-only** ხელმისაწვდომია, ანუ
შეუძლიათ ლოკალურად გაუშვან (`npm i && npx prisma db push && npm run dev`).
მაგრამ **ჭეშმარიტების წყარო დეპლოიმენტია** — განსაკუთრებით ლექცია 13-ის
breaking change-ისთვის, რომელიც ყველას ერთდროულად უნდა მოხვდეს.

---

## მონაცემების იზოლაცია გუნდებს შორის

ერთი ბაზაა ყველასთვის, მაგრამ:
- პროდუქტები/კატეგორიები — **მხოლოდ GET**, ჩაწერა არ არის გამოქვეყნებული
- მომხმარებლები, კალათა, შეკვეთები — **ყოველთვის ტოკენის `userId`-ით**

ერთადერთი შეხება — ელფოსტის უნიკალურობა. თუ ერთი გუნდი `test@test.com`-ს
დაიკავებს, მეორეს `409 EMAIL_TAKEN` დახვდება. **ეს კარგია** — ამ შეცდომის
დამუშავება ისედაც დავალების ნაწილია.

თუ სრული იზოლაცია გინდა: ურჩიე გუნდს პრეფიქსი — `alpha+nino@example.com`.
