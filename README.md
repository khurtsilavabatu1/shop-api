# Cyber Storefront API — Authentication

ავტორიზაციის ბექენდი პრაქტიკული პროექტისთვის.
Express + Prisma + SQLite. ბაზა ფაილშია — არავითარი გარე სერვისი არ სჭირდება.

> 📖 **როგორ მუშაობს ეს API** — არქიტექტურა, JWT, პაროლის ჰეშირება, აღდგენის
> ფლოუ, დეპლოის პროცესი: [ARCHITECTURE.md](./ARCHITECTURE.md)
>
> 🔗 **ცოცხალი API:** https://shop-api-kbe6.onrender.com/api
> · [Swagger](https://shop-api-kbe6.onrender.com/docs)
> · [OpenAPI](https://shop-api-kbe6.onrender.com/openapi.yaml)

## გაშვება

```bash
npm install
cp .env.example .env
npx prisma db push
npm run dev
```

| მისამართი | რა არის |
|---|---|
| `http://localhost:4000/api` | API-ის base URL |
| `http://localhost:4000/docs` | **Swagger UI** — ინტერაქტიული დოკუმენტაცია |
| `http://localhost:4000/openapi.yaml` | OpenAPI სპეციფიკაცია (ტიპების გენერაციისთვის) |

## კატალოგი

**12 კატეგორია × 40 პროდუქტი = 480 პროდუქტი**, თითოს 5 სურათი.

| კატეგორია | slug |
|---|---|
| სმარტფონები | `smartphones` |
| ლეპტოპები | `laptops` |
| საყოფაცხოვრებო ტექნიკა | `home-appliances` |
| ავეჯი | `furniture` |
| სპორტი და ფიტნესი | `sports` |
| სილამაზე და მოვლა | `beauty` |
| წიგნები | `books` |
| სათამაშოები | `toys` |
| ტანსაცმელი და ფეხსაცმელი | `clothing` |
| სამზარეულო და ჭურჭელი | `kitchen` |
| ავტო-აქსესუარები | `auto` |
| ცხოველების საქონელი | `pets` |

თითო პროდუქტს აქვს **კატეგორიისთვის შესაბამისი მახასიათებლები** —
სმარტფონს პროცესორი და ბატარეა, წიგნს ავტორი და გვერდები, ავეჯს მასალა და ზომები.

კატალოგის ხელახლა გენერაცია:
```bash
npm run seed
```

გენერაცია **დეტერმინისტულია** — ერთი და იგივე პროდუქტები მიიღება ყოველ ჯერზე.
სურათები: `picsum.photos`, slug-ზე მიბმული seed-ით.

## ენდპოინტები

| მეთოდი | გზა | აღწერა |
|---|---|---|
| `GET` | `/api/categories` | კატეგორიები + ფილტრების განსაზღვრებები |
| `GET` | `/api/categories/:slug` | ერთი კატეგორია + ფასის დიაპაზონი + ბრენდები |
| `GET` | `/api/brands` | ბრენდების სია (`?category=`) |
| `GET` | `/api/products` | სია — ფილტრაცია, სორტირება, პაგინაცია, ძებნა |
| `GET` | `/api/products/:slug` | ერთი პროდუქტი + მსგავსი |
| `POST` | `/api/auth/register` | რეგისტრაცია → `{ user, accessToken }` |
| `POST` | `/api/auth/login` | შესვლა → `{ user, accessToken }` |
| `GET` | `/api/auth/me` | მიმდინარე მომხმარებელი (Bearer) |
| `POST` | `/api/auth/logout` | გასვლა (204) |
| `POST` | `/api/auth/forgot-password` | აღდგენა 1: კოდის მოთხოვნა |
| `POST` | `/api/auth/verify-reset-code` | აღდგენა 2: კოდის შემოწმება → `{ resetToken }` |
| `POST` | `/api/auth/reset-password` | აღდგენა 3: ახალი პაროლი |

## ავტორიზაცია

```
Authorization: Bearer <accessToken>
```

ტოკენის ვადა — **30 წუთი**. ვადის გასვლისას: `401` + `code: "TOKEN_EXPIRED"`.
დაამუშავეთ ეს შემთხვევა: მომხმარებელი უნდა გადამისამართდეს `/login`-ზე.

## პაროლის აღდგენის ფლოუ

```
1. POST /auth/forgot-password    { email }                → ყოველთვის 200
2. POST /auth/verify-reset-code  { email, code }          → { resetToken }
3. POST /auth/reset-password     { resetToken, password } → 200
```

- ნაბიჯი 1 **ყოველთვის** აბრუნებს 200-ს, არსებობს ანგარიში თუ არა —
  თორემ ფორმა ანგარიშების ჩამოთვლის ინსტრუმენტად იქცევა
- კოდი 6-ციფრიანია, ვადა **15 წუთი**
- 5 არასწორი მცდელობის შემდეგ კოდი იბლოკება (`429`)
- `resetToken` ერთჯერადია

**ელფოსტა არ იგზავნება.** კოდი იბეჭდება სერვერის კონსოლში და, როცა
`DEV_EXPOSE_RESET_CODE=true`, ბრუნდება პასუხის `devCode` ველში —
რომ ფრონტის ტესტირებას ელფოსტის სერვისი არ სჭირდებოდეს.

## ელფოსტის გაგზავნა (არასავალდებულო)

ნაგულისხმევად წერილი **არ იგზავნება** — კოდი კონსოლში იბეჭდება და `devCode`-ში ბრუნდება.

### ✅ რეკომენდებული: Brevo HTTP API

```
BREVO_API_KEY=xkeysib-...
MAIL_FROM=Cyber <დადასტურებული@sender.com>
```

ეს ერთადერთი ვარიანტია, რომელიც უფასო PaaS-ებზე მუშაობს.

### ⚠️ SMTP — Render-ის უფასო ინსტანსზე არ იმუშავებს

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

Render, Heroku და სხვა უფასო ჰოსტინგები **ბლოკავენ გამავალ SMTP-პორტებს**
(25 / 465 / 587) სპამის თავიდან ასაცილებლად. შედეგი: `Connection timeout`.
ეს კონფიგურაციით არ გვერდდება — HTTP API-ს პორტი 443 კი არასდროს იბლოკება.

### რეჟიმების პრიორიტეტი

```
BREVO_API_KEY არსებობს?  → HTTP API
SMTP_HOST არსებობს?      → SMTP
არც ერთი?                → კონსოლი + devCode
```

გაშვებისას სერვერი ბეჭდავს არჩეულ რეჟიმს: `ელფოსტა → api | smtp | console`.

გაგზავნის ჩავარდნისას მოთხოვნა მაინც `200`-ს აბრუნებს და კოდი ლოგში იწერება —
**მომხმარებელი არ იბლოკება ელფოსტის გამო.**

## შეცდომების ერთიანი ფორმატი

```json
{ "message": "Invalid email or password", "code": "INVALID_CREDENTIALS" }
```

ვალიდაციის შეცდომას (`422`) დამატებით აქვს `errors` — პირდაპირ ველზე მისაბმელი:

```json
{
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": {
    "email": "Enter a valid email address",
    "password": "Password must be at least 8 characters"
  }
}
```

**ფრონტზე გამოყენება:** გაიარეთ `errors`-ის გასაღებებზე და თითოეული
შეტყობინება დააყენეთ შესაბამის ველზე.

| კოდი | სტატუსი | როდის |
|---|---|---|
| `VALIDATION_ERROR` | 422 | ველები არავალიდურია |
| `EMAIL_TAKEN` | 409 | ელფოსტა უკვე რეგისტრირებულია |
| `INVALID_CREDENTIALS` | 401 | არასწორი ელფოსტა ან პაროლი |
| `UNAUTHORIZED` | 401 | ტოკენი არ არის |
| `TOKEN_EXPIRED` | 401 | ტოკენს ვადა გაუვიდა |
| `INVALID_RESET_CODE` | 400 | კოდი არასწორია ან ვადაგასულია |
| `TOO_MANY_ATTEMPTS` | 429 | 5+ არასწორი მცდელობა |
| `RESET_TOKEN_USED` | 400 | resetToken უკვე გამოყენებულია |

## ⚠️ ვალიდაცია: login ≠ register

`/auth/login`-ზე პაროლის **სირთულე არ მოწმდება** — მხოლოდ სავალდებულოობა.
მომხმარებლის არსებული პაროლი შეიძლება ძველი პოლიტიკით იყოს შექმნილი და
კლიენტის მხარეს მისი უარყოფა რეალური ბაგია.
სირთულის წესები (მინ. 8 სიმბოლო, 1 ასო, 1 ციფრი) მხოლოდ `/auth/register`-ს
და `/auth/reset-password`-ს ეხება. **იგივე წესი დაიცავით ფრონტზე.**

## ტიპების გენერაცია სპეციფიკაციიდან

ხელით ნუ დაწერთ ტიპებს — დააგენერირეთ:

```bash
npx openapi-typescript http://localhost:4000/openapi.yaml -o src/shared/api/schema.d.ts
```

მაშინ API-ის ცვლილება კომპილაციის დროს გამოჩნდება, არა მომხმარებელთან.

## ლექტორის პარამეტრები (`.env`)

| ცვლადი | დანიშნულება |
|---|---|
| `ARTIFICIAL_LATENCY_MS` | `800` → ყველა მოთხოვნა 800ms-ს აყოვნებს. **loading-მდგომარეობები აუცილებელი ხდება, არა სასურველი** |
| `DEV_EXPOSE_RESET_CODE` | `false` → `devCode` აღარ ბრუნდება; კოდი მხოლოდ სერვერის ლოგშია |
| `ACCESS_TOKEN_TTL` | `30m`. `1m`-ზე დაყენებით შეამოწმებ, როგორ ამუშავებენ ვადაგასულ სესიას |

## ბაზის გასუფთავება

```bash
rm prisma/dev.db && npx prisma db push
```
