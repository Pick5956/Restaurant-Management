# คู่มือรัน Dishy ด้วยตนเอง

รวมคำสั่งทั้งหมดที่ใช้รัน ทดสอบ และดูแลโปรเจกต์นี้บน Windows (PowerShell) ทุกคำสั่งในนี้ดึงมาจากสคริปต์และ `package.json` ในรีโปจริง ถ้าสคริปต์เปลี่ยนให้แก้ที่นี่ด้วย

> **PowerShell 5.1 ไม่รู้จัก `&&`** — ถ้าเห็นคำสั่ง `cd x && y` จากที่อื่น ให้พิมพ์แยกคนละบรรทัด หรือใช้ `npm --prefix <โฟลเดอร์> run ...` แทน

---

## 1. ภาพรวม

| ส่วน | เทคโนโลยี | พอร์ต | โฟลเดอร์ |
| --- | --- | --- | --- |
| Backend API | Go 1.24 + PostgreSQL 16 | `8080` | `backend/` |
| Web | Next.js | `3000` | `frontend/` |
| Mobile | Expo SDK 57 / React Native | Metro `8081` | `mobile/` |
| ฐานข้อมูล | PostgreSQL | ตาม `backend/.env` (`DB_PORT`) | — |

Log ของทุกตัวเขียนลงไฟล์ ไม่ทับของเก่า:

- backend → `logs/backend/current/*-backend-local.{out,err}.log`
- frontend → `logs/frontend/current/*-frontend-local.{out,err}.log`
- mobile (โหมด Expo Go) → `logs/mobile/expo/*-expo-go-lan.{out,err}.log`

---

## 2. ติดตั้งครั้งแรก

### 2.1 เครื่องมือ

- Go 1.24+
- Node.js 20+ (ทีมใช้ 22)
- PostgreSQL 16 (ติดตั้งเอง หรือ Docker — ดู `README.md` หัวข้อ "Start PostgreSQL")
- มือถือ Android: APK dev-client (ข้อ 5.4) หรือ Expo Go · iOS: Expo Go จาก App Store
- (ถ้าจะ build APK) บัญชี Expo และ `npx eas-cli login`

### 2.2 ติดตั้ง dependencies

```powershell
cd backend
go mod download
```

```powershell
npm --prefix frontend install
```

```powershell
npm --prefix mobile install
```

> **หลัง `git pull` ทุกครั้ง** ให้รัน `npm install` ของ `mobile/` และ `frontend/` ซ้ำ ถ้ามีคน เพิ่ม dependency แล้วเราไม่ติดตั้ง Metro จะตายด้วย `PluginError: Failed to resolve plugin for module "expo-xxx"`

### 2.3 ไฟล์ environment (ทุกไฟล์ถูก gitignore ห้ามคอมมิต)

**`backend/.env`** — คีย์หลัก (ดูตัวอย่างเต็มใน `README.md` "Configure the backend")

```env
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=...
DB_NAME=Project_M
JWT_SECRET=...(อย่างน้อย 32 ตัวอักษร)
SERVER_HOST=localhost
SERVER_PORT=8080
FRONTEND_URL=http://localhost:3000
CORS_ALLOWED_ORIGINS=http://localhost:3000
GOOGLE_CLIENT_ID=
GROQ_API_KEYS=...
GEMINI_API_KEYS=...
AI_PROVIDER=...
```

**`frontend/.env.local`**

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

**`mobile/.env.local`** — ปกติมีแค่บรรทัดเดียว สคริปต์ `start:*` จะเขียนทับ `EXPO_PUBLIC_API_URL` ให้เป็น IP ในวง LAN เองตอนรัน

```env
EXPO_PUBLIC_API_URL=http://localhost:8080
```

---

## 3. รันประจำวัน (backend + web)

### วิธีที่ 1 — ดับเบิลคลิก (ง่ายสุด)

`start-dishy.bat` ที่ root ของรีโป → เปิด 2 หน้าต่าง (backend :8080 รัน migration ก่อน, frontend :3000) แล้วเปิดเบราว์เซอร์ที่ `http://localhost:3000` ให้เอง ปิดหน้าต่างไหน = หยุดตัวนั้น

### วิธีที่ 2 — สคริปต์เดียวจาก PowerShell

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

รัน backend แล้วรอจน :8080 พร้อม ค่อยรัน frontend รอ :3000 พิมพ์ URL + PID ออกมา ถ้ามีอะไรฟัง :3000/:8080 อยู่แล้วจะหยุดพร้อมบอก PID

### วิธีที่ 3 — แยกตัว

Backend (รัน `go run ./cmd/migrate` ก่อนเสมอ แล้วค่อย start):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
```

Frontend (มี Hot Reload):

```powershell
npm --prefix frontend run dev
```

เช็คว่า backend ขึ้น: เปิด `http://localhost:8080/health`

---

## 4. ฐานข้อมูล

รันทุกคำสั่งในหัวข้อนี้จากโฟลเดอร์ `backend/` เพราะมันอ่าน `.env` จากตรงนั้น

| คำสั่ง | ทำอะไร |
| --- | --- |
| `go run ./cmd/migrate` | รัน migration ที่ยังไม่ได้รัน (สคริปต์ start ทำให้อยู่แล้ว) |
| `go run ./cmd/resetdb --mode=data --yes` | ล้างออเดอร์/การจอง ปล่อยโต๊ะว่างทั้งหมด **เก็บ** ผู้ใช้ ร้าน เมนู วัตถุดิบ โต๊ะ โซน (สต็อกที่ถูกหักไปแล้วไม่คืน) |
| `go run ./cmd/resetdb --mode=full --yes` | DROP schema ทั้งหมดแล้ว migrate + seed role ใหม่ = ฐานข้อมูลเปล่า **ต้องปิด backend ก่อน** และต้องสร้างร้านใหม่หลังจากนั้น |
| `go run ./cmd/seed_demo_menu --restaurant-id=1` | ใส่เมนูตัวอย่างให้ร้าน |
| `go run ./cmd/seed_demo_ingredients --restaurant-id=1` | ใส่วัตถุดิบตัวอย่างให้ร้าน |
| `go run ./cmd/seed_daily_activity --restaurant-id=1` | จำลองกิจกรรม 1 วัน (ออเดอร์จ่ายแล้ว ต้นทุน ค่าใช้จ่าย) เพื่อให้รายงานมีข้อมูล |
| ↳ `--date=YYYY-MM-DD` | เลือกวัน (ค่าเริ่มต้น = วันนี้ เวลาไทย) |
| ↳ `--force` / `--purge` | seed ซ้ำวันเดิม / ลบที่ seed ไว้ของวันนั้น |
| ↳ `--restock` / `--calibrate` | เติมวัตถุดิบที่ต่ำกว่าขั้นต่ำ / คำนวณขั้นต่ำใหม่จากอัตราใช้จริงแล้วเติม |
| `go run ./cmd/devlocalowner --email=x@x.com --password=12345678 --restaurant=1` | เพิ่มบัญชี owner แบบรหัสผ่านให้ร้าน ใช้ล็อกอินจาก Expo Go ที่ Google sign-in ใช้ไม่ได้ |

`resetdb` ปฏิเสธถ้าไม่มี `--yes` และปฏิเสธฐานข้อมูลที่ชื่อเหมือน production

### สำรอง / กู้คืน (ต้องมี `pg_dump` / `pg_restore` ใน PATH)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-database.ps1
```

ได้ไฟล์ `backups/restaurant-hub-<db>-<เวลา>.dump` และตรวจไฟล์ให้ด้วยว่ากู้ได้

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore-database.ps1 -BackupFile .\backups\<ไฟล์>.dump -ConfirmTarget <ชื่อฐานข้อมูล> -ConfirmRestore
```

การกู้คืนทำลายข้อมูลปัจจุบัน สคริปต์บังคับให้พิมพ์ชื่อฐานข้อมูลให้ตรงและใส่ `-ConfirmRestore` ถึงจะทำ

---

## 5. Mobile

**กฎ 3 ข้อที่ทำให้เสียเวลามากที่สุด**

1. **Metro ถือพอร์ต 8081 ได้ทีละโหมด** — จะสลับ Expo Go ↔ dev-client ต้องปิดตัวเก่าก่อน
2. **สลับ Wi-Fi แล้วต้องรีสตาร์ต Metro** — สคริปต์ฝัง IP ของคอมลง bundle ตอนเริ่ม แค่ reload แอปไม่พอ อาการคือแอปเปิดได้แต่ขึ้น "เชื่อมต่อไม่ได้"
3. **backend ต้องรันอยู่ที่ :8080 ก่อน** — สคริปต์ mobile ทุกตัวเช็คแล้วหยุดถ้าไม่เจอ

ทุกสคริปต์ด้านล่างจับ IP ในวง LAN ของคอมให้เอง (10.x / 172.16–31.x / 192.168.x) และชี้ `EXPO_PUBLIC_API_URL` ไปที่ `http://<IP>:8080` มือถือต้องอยู่ Wi-Fi วงเดียวกัน — Wi-Fi มหาวิทยาลัยมักเปิด client isolation คุยกันไม่ได้ ให้ปล่อยฮอตสปอตจากมือถือแล้วให้คอมต่อเข้าแทน

### 5.1 Android — dev-client APK (ใช้เป็นหลัก รองรับพิมพ์ใบเสร็จ Bluetooth)

```powershell
npm --prefix mobile run start:dev-client:local
```

เปิดแอป Dishy (dev build) แล้วใส่ `http://<IP คอม>:8081`

### 5.2 Android — Expo Go

```powershell
npm --prefix mobile run start:go:lan
```

สแกน QR หรือใส่ `exp://<IP คอม>:8081` ใน Expo Go — พิมพ์ใบเสร็จ Bluetooth และ Google login ใช้ไม่ได้ในโหมดนี้

### 5.3 iOS — Expo Go เท่านั้น (ไม่มี dev build)

ใช้คำสั่งเดียวกับ 5.2 แล้วเปิด `exp://<IP คอม>:8081` ใน Safari บน iPhone/iPad → เลือกเปิดด้วย Expo Go

**ตั้งแต่ SDK 57 iOS บังคับล็อกอินทั้งสองฝั่งด้วยบัญชี Expo เดียวกัน:**

- คอม: `npx eas-cli login` (บัญชีต้องมีสิทธิ์ใน project `restaurant-hub-mobile`)
- Expo Go บนเครื่อง: Log in — ถ้าบัญชีสร้างด้วย Google ไม่มีรหัสผ่าน ให้ไปหน้า **Sign up → Continue with Google** มันจะจับคู่บัญชีเดิมให้

ข้อความ error บอกได้ว่าขาดข้อไหน:

| ข้อความบน iOS | แปลว่า |
| --- | --- |
| *You're signed in to Expo CLI as X, but not signed in to Expo Go* | Expo Go ยังไม่ล็อกอิน หรือคนละบัญชี |
| *You need to be signed in to Expo Go and Expo CLI* | คอมไม่ได้ล็อกอิน หรือ `app.json` ไม่มี `extra.eas.projectId` (อย่าเอาออก) |

รายละเอียดเพิ่มเติม: `mobile/README.md` หัวข้อ "On iOS, stay on Expo Go"

### 5.4 Build APK ใหม่ (EAS cloud, free tier ต่อคิว ~1 ชม.)

```powershell
npm --prefix mobile run build:android:development
```

ต้อง build ใหม่เมื่อ: เพิ่ม/ลบ native dependency, แก้ `app.json` ส่วน native (permission, plugin, icon), อัป Expo SDK แก้ UI/logic/API ปกติ **ไม่ต้อง** build — Fast Refresh พอ

ลิงก์ดาวน์โหลดจะอยู่ในหน้า build บน expo.dev; APK ติดตั้งทับตัวเดิมได้ถ้า build จาก project เดียวกัน (keystore เดียวกัน)

### 5.5 อื่น ๆ

| คำสั่ง | ทำอะไร |
| --- | --- |
| `npm --prefix mobile run start:dev-client` | dev-client แบบไม่เช็ค backend/ไม่ตั้ง API URL ให้ (ใช้ค่าจาก `.env.local`) |
| `npm --prefix mobile run tunnel:backend` | เปิด Cloudflare quick tunnel ชี้ไป :8080 สำหรับมือถือที่อยู่นอกวง LAN แล้วเอา URL ไปใส่ `EXPO_PUBLIC_API_URL` (ต้องติดตั้ง `cloudflared`) |
| `npm --prefix mobile run generate:brand-assets` | สร้างไอคอน/splash ใหม่จากต้นฉบับ |

---

## 6. ทดสอบ / ตรวจก่อนคอมมิต

| ส่วน | คำสั่ง (รันจาก root) | หมายเหตุ |
| --- | --- | --- |
| backend | `go build ./...` · `go vet ./...` · `go test ./...` | รันใน `backend/` |
| frontend | `npm --prefix frontend run lint` | ESLint |
| frontend | `npm --prefix frontend run test:agent` | Vitest |
| frontend | `cd frontend` แล้ว `npx tsc --noEmit` | ถ้า error อยู่ใน `.next/dev/types/*` ทั้งหมด = cache เก่า ลบ `frontend/.next` แล้วรัน dev ใหม่ |
| mobile | `npm --prefix mobile run typecheck` | `tsc --noEmit` |
| mobile | `npm --prefix mobile test` | `node --test` ไฟล์ `src/lib/*.test.mjs` — เพิ่มไฟล์เทสต์ใหม่ต้องไปเติมชื่อใน `scripts.test` ของ `mobile/package.json` ด้วย |
| frontend | `npm --prefix frontend run build` | build production เพื่อจับ error ที่ dev ไม่เจอ |

---

## 7. โหมดสาธารณะ (Cloudflare `dishy.pro`)

ใช้ตอนโชว์งาน ไม่ใช่ตอนพัฒนา

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Mode public
```

```powershell
npm --prefix frontend run build:public
```

```powershell
npm --prefix frontend run start:public
```

```powershell
npm --prefix frontend run tunnel:public
```

- เว็บ: `https://dishy.pro` · API: `https://api.dishy.pro`
- `start:public` เป็น `next start` ไม่มี Hot Reload — แก้โค้ดแล้วต้อง `build:public` และรัน `start:public` ใหม่ทุกครั้ง ถ้าอยากได้ Hot Reload ชั่วคราวใช้ `npm --prefix frontend run dev:public`
- `npm --prefix frontend run deploy:public` = สคริปต์ deploy ครบชุด (หยุดตัวเก่า → build → start ทั้ง 3 ตัวแบบซ่อนหน้าต่าง → ตรวจความพร้อม) เหมาะกับรันแบบไม่มีคนเฝ้า ถ้ามีคนดูอยู่ให้ใช้ `-BuildOnly` แล้วเปิด 3 คำสั่งด้านบนเอง จากนั้น `-VerifyOnly` เพื่อตรวจ (อ่านหัวไฟล์ `scripts/deploy-public.ps1`)

---

## 8. แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
| --- | --- |
| `PluginError: Failed to resolve plugin for module "expo-xxx"` ตอนเปิด Metro | มีคนเพิ่ม dependency แล้วเรายังไม่ `npm --prefix mobile install` |
| แอปเปิดได้แต่ "เชื่อมต่อไม่ได้ / ตรวจสอบอินเทอร์เน็ต" | IP คอมเปลี่ยนหลัง Metro เริ่ม → ปิด Metro แล้วเปิดใหม่ |
| มือถือเข้า `http://<IP>:8081` ไม่ได้เลย แต่คอมเข้าตัวเองได้ | Wi-Fi มี client isolation (มหาวิทยาลัย) → ใช้ฮอตสปอตมือถือ |
| `Cannot find native module 'ExpoAudio'` (หรือโมดูลอื่น) บน APK | APK build ก่อนที่ native module นั้นจะเข้าโปรเจกต์ → build ใหม่ (5.4) หน้าอื่นยังใช้ได้ |
| `Local app is already running on: 3000/8080 (PID …)` | มีตัวเก่ารันอยู่ → ปิดหน้าต่างนั้น หรือ `Stop-Process -Id <PID>` |
| `The token '&&' is not a valid statement separator` | PowerShell 5.1 → แยกบรรทัด หรือใช้ `npm --prefix` |
| EAS: `Entity not authorized: AppEntity[…]` | `projectId` ใน `app.json` ชี้ project ที่ไม่มี/ไม่ใช่ของบัญชีที่ล็อกอิน → เช็ค `npx eas-cli whoami` และ project บน expo.dev |
| Expo Go iOS ขึ้นให้ล็อกอิน | ดู 5.3 |
| `Metro waiting` แต่ log ไม่มี `Bundled` เลย | เครื่องยังไม่ถึง Metro — ลองเปิด `http://<IP>:8081` ใน Safari/Chrome บนมือถือ ถ้าเห็น JSON = เครือข่ายผ่าน ปัญหาอยู่ที่แอป |
| เว็บ (localhost:3000) refresh ไม่หยุด / console ขึ้น `adapterFn is not a function` + `webpack-hmr ... failed` | `.next` cache ค้างข้ามเวอร์ชัน Next (มักหลัง pull/merge ที่ Next ขยับเวอร์ชัน) → ปิด dev server, ลบ `frontend/.next`, รัน `npm --prefix frontend run dev` ใหม่ แล้ว **hard refresh เบราว์เซอร์** (`Ctrl+Shift+R`) |
| backend สตาร์ตไม่ขึ้น: `database has N applied schema migrations; application requires M` หรือ `migration <v> name changed from "…" to "…"` | รัน `go run ./cmd/migrate` บนแบรนช์ตัวเอง**ก่อน** merge แล้วตอน merge มี migration ถูกแทรก/เรียงเลขใหม่ → ledger ใน DB (ตาราง `schema_migrations`) เลข/ชื่อไม่ตรงกับโค้ด · **เก็บข้อมูลไว้:** ลบแถวที่ชนออก (`DELETE FROM schema_migrations WHERE version IN (<เลขที่ชน>)` ผ่าน psql/ตัวจัดการ DB) แล้ว `go run ./cmd/migrate` ใหม่ (apply ตามลำดับที่ถูก) · **ล้างเลย:** ปิด backend แล้ว `go run ./cmd/resetdb --mode=full --yes` (ต้องสร้างร้านใหม่) · **กันไว้:** อย่ารัน migrate จนกว่าเลข migration จะนิ่งหลัง merge |

---

## 9. เอกสารอื่นในรีโป

- `README.md` — ภาพรวมระบบ สถาปัตยกรรม ตั้งค่า PostgreSQL/Docker, API surface (อังกฤษ)
- `mobile/README.md` — Expo Go vs dev build, Google login, iOS, เมื่อไหร่ต้อง build ใหม่ (อังกฤษ)
- `mobile/bluetoothreceiptprinting.md` — พิมพ์ใบเสร็จผ่าน Bluetooth ทั้งระบบ (ไทย)
- `frontend/README.md` — Next.js พื้นฐาน + public tunnel
