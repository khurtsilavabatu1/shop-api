# Cyber Storefront API — Authentication

ავტორიზაციის ბექენდი პრაქტიკული პროექტისთვის.
Express + Prisma + SQLite. ბაზა ფაილშია — არავითარი გარე სერვისი არ სჭირდება.

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

## ენდპოინტები

| მეთოდი | გზა | აღწერა |
|---|---|---|
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
