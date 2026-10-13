# Dosenku Fase 1 — Fondasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dosen bisa mendaftar, konfirmasi email, masuk, membuat kelas, dan mengelola daftar mahasiswa (import CSV, tambah, hapus) dengan data terisolasi per dosen.

**Architecture:** Next.js 16 App Router dengan Server Actions; Supabase (Postgres + Auth) diakses dari server lewat `@supabase/ssr` memakai publishable key sehingga semua akses data melewati RLS. Skema ditulis sebagai file migrasi SQL yang juga dijalankan di PGlite (Postgres in-process) untuk test RLS tanpa Docker. Logika murni (validasi, parsing CSV, kalkulasi periode akademik) dipisah dari IO agar bisa diuji dengan Vitest.

**Tech Stack:** Next.js 16.3.1, React 19, TypeScript (strict), Tailwind CSS (default create-next-app), Supabase (`@supabase/supabase-js` v2, `@supabase/ssr`), PapaParse, Vitest 3, PGlite 0.3.

**Spec:** `docs/superpowers/specs/2026-10-13-auto-grading-design.md` (roadmap: `docs/superpowers/plans/2026-10-13-roadmap.md`)

## Global Constraints

- Semua teks UI dan pesan error dalam Bahasa Indonesia.
- Node.js 24, npm. Tidak ada Docker di mesin dev → test database memakai PGlite, aplikasi memakai project Supabase hosted.
- Setiap tabel milik dosen WAJIB `enable row level security`; akses hanya via `auth.uid()`.
- Kode aplikasi hanya memakai publishable key (bukan secret/service role) di fase ini.
- Migrasi di `supabase/migrations/*.sql` harus jalan di Supabase **dan** di harness PGlite (`tests/db/harness.ts`); jangan memakai objek Supabase yang tidak di-stub di `tests/db/supabase-stub.sql`.
- `credit_balance` tidak boleh bisa diubah oleh dosen (hanya fungsi kredit di fase 4).
- Rahasia tidak pernah di-commit: `.env.local` di-ignore, `.env.example` di-commit.
- Modul domain di `src/lib/<unit>/`; test unit diletakkan bersebelahan (`*.test.ts`), test database di `tests/db/`.
- Setiap commit diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure (hasil akhir Fase 1)

```
.env.example                         env yang dibutuhkan
.gitattributes                       paksa LF
next.config.ts                       turbopack root (repo ini bersarang di folder lain)
vitest.config.ts
public/template-mahasiswa.csv        contoh CSV import
supabase/migrations/20261013000100_core_schema.sql
tests/db/supabase-stub.sql           stub auth schema + role Supabase untuk PGlite
tests/db/harness.ts                  createTestDb / createUser / asUser / asAnon
tests/db/core-schema.test.ts         test RLS & constraint
src/proxy.ts                         refresh sesi + guard /dosen
src/test/form-data.ts                helper test
src/lib/env.ts                       baca env Supabase
src/lib/validation.ts                FormState, readString, isValidEmail, isUuid, ...
src/lib/db/types.ts                  tipe baris tabel
src/lib/supabase/server.ts           client Supabase untuk Server Component/Action
src/lib/supabase/proxy-session.ts    updateSession untuk proxy
src/lib/auth/paths.ts                aturan redirect auth
src/lib/auth/validation.ts           validasi daftar/masuk + terjemahan error
src/lib/auth/actions.ts              signUp/signIn/signOut
src/lib/auth/session.ts              getCurrentLecturer
src/lib/courses/validation.ts        validasi kelas + periode akademik
src/lib/courses/queries.ts           listCourses / getCourse
src/lib/courses/actions.ts           createCourseAction
src/lib/students/validation.ts       validasi satu mahasiswa
src/lib/students/csv.ts              parseStudentCsv
src/lib/students/import-file.ts      readStudentCsvFile
src/lib/students/queries.ts          listStudents
src/lib/students/actions.ts          import/add/delete
src/components/ui/{field,submit-button,form-alert}.tsx
src/components/auth/{auth-card,sign-in-form,sign-up-form}.tsx
src/components/courses/{course-list,create-course-form}.tsx
src/components/students/{import-students-form,add-student-form,student-table,delete-student-button}.tsx
src/app/{layout,page}.tsx, globals.css
src/app/masuk/page.tsx, src/app/daftar/page.tsx, src/app/auth/confirm/route.ts
src/app/dosen/{layout,page}.tsx, src/app/dosen/kelas/[id]/page.tsx
```

---

### Task 1: Scaffold project + tooling + pembaca env

**Files:**
- Create (generator): seluruh scaffold create-next-app di root repo
- Create: `vitest.config.ts`, `.env.example`, `.gitattributes`, `src/lib/env.ts`, `src/lib/env.test.ts`
- Modify: `next.config.ts`, `.gitignore`, `package.json` (scripts), `src/app/globals.css`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: —
- Produces: `readSupabasePublicEnv(env?): { url: string; publishableKey: string }` dari `@/lib/env`; perintah `npm test` (Vitest, include `src/**/*.test.ts` dan `tests/**/*.test.ts`).

- [ ] **Step 1: Generate Next.js di root repo**

Root repo (`C:\Users\mma\claude\Dosenku`) saat ini hanya berisi `.git/` dan `docs/` — keduanya diizinkan create-next-app.

Run:
```bash
npx create-next-app@16.3.1 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes
```
Expected: selesai tanpa error, ada `package.json`, `src/app/page.tsx`, `next.config.ts`.

- [ ] **Step 2: Pasang Vitest**

Run:
```bash
npm i -D vitest@3.2.4 vite-tsconfig-paths@5.1.4
npm pkg set scripts.test="vitest run" scripts.test:watch="vitest"
```

Create `vitest.config.ts`:
```ts
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Konfigurasi repo**

Folder ini bersarang di dalam project Next.js lain (`C:\Users\mma\claude`), jadi root Turbopack harus dikunci ke folder ini. Ganti isi `next.config.ts`:
```ts
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
```

Create `.gitattributes`:
```
* text=auto eol=lf
```

create-next-app menambahkan `.env*` ke `.gitignore`, yang juga mengabaikan `.env.example`. Tambahkan baris berikut di akhir `.gitignore`:
```
!.env.example
```

Create `.env.example`:
```
# Supabase Dashboard → Project Settings → API Keys / Data API
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxx
```

Ganti seluruh isi `src/app/globals.css` (hapus warna dark-mode bawaan template):
```css
@import "tailwindcss";
```

Di `src/app/layout.tsx`, ubah objek `metadata` dan atribut `lang` (biarkan font Geist apa adanya):
```tsx
export const metadata: Metadata = {
  title: "Dosenku",
  description: "Kumpulkan tugas, nilai otomatis dengan AI berdasarkan rubrik, dan rekap nilai akhir.",
};
```
```tsx
<html lang="id">
```

- [ ] **Step 4: Tulis test pembaca env (gagal)**

Create `src/lib/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readSupabasePublicEnv } from "./env";

describe("readSupabasePublicEnv", () => {
  it("mengembalikan url dan key yang sudah di-trim", () => {
    expect(
      readSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: " https://abc.supabase.co ",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      }),
    ).toEqual({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_x" });
  });

  it("menyebut semua env yang belum diisi", () => {
    expect(() => readSupabasePublicEnv({})).toThrow(
      "Env belum diisi: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("menganggap string berisi spasi sebagai belum diisi", () => {
    expect(() =>
      readSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   ",
      }),
    ).toThrow("Env belum diisi: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  });
});
```

- [ ] **Step 5: Jalankan test, pastikan gagal**

Run: `npx vitest run src/lib/env.test.ts`
Expected: FAIL — `Failed to resolve import "./env"`.

- [ ] **Step 6: Implementasi**

Create `src/lib/env.ts`:
```ts
/**
 * Env publik Supabase. Default-nya membaca `process.env.NEXT_PUBLIC_*` dengan
 * nama literal supaya Next.js bisa meng-inline-nya; parameter `env` untuk test.
 */
export interface SupabasePublicEnv {
  url: string;
  publishableKey: string;
}

type EnvSource = Record<string, string | undefined>;

export function readSupabasePublicEnv(
  env: EnvSource = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): SupabasePublicEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ].filter(Boolean);
    throw new Error(
      `Env belum diisi: ${missing.join(", ")}. Salin .env.example ke .env.local lalu isi nilainya.`,
    );
  }

  return { url, publishableKey };
}
```

- [ ] **Step 7: Verifikasi**

Run: `npm test`
Expected: PASS, 3 test.

Run: `npm run lint`
Expected: tanpa error.

Run: `npm run build`
Expected: build sukses, tanpa peringatan "multiple lockfiles" / salah root workspace.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and env reader" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Skema inti + RLS + harness test PGlite

**Files:**
- Create: `supabase/migrations/20261013000100_core_schema.sql`
- Create: `tests/db/supabase-stub.sql`, `tests/db/harness.ts`, `tests/db/core-schema.test.ts`

**Interfaces:**
- Consumes: `npm test` (Task 1)
- Produces:
  - Tabel `public.lecturers(id, nama, institusi, credit_balance, created_at)`, `public.courses(id, lecturer_id default auth.uid(), nama, kode_mk, semester ∈ {ganjil,genap,pendek}, tahun_ajaran 'YYYY/YYYY', created_at)`, `public.students(id, course_id, nim, nama, email, created_at, UNIQUE(course_id, nim))`.
  - Trigger `on_auth_user_created` membuat baris `lecturers` dari `raw_user_meta_data.nama/institusi`.
  - Harness: `createTestDb(): Promise<PGlite>`, `createUser(db, meta?): Promise<string>`, `asUser(db, userId, fn)`, `asAnon(db, fn)` — dipakai test DB di fase-fase berikutnya.

- [ ] **Step 1: Pasang PGlite**

Run: `npm i -D @electric-sql/pglite@0.3.16`

- [ ] **Step 2: Buat stub Supabase untuk PGlite**

Create `tests/db/supabase-stub.sql`:
```sql
-- Stub minimal objek Supabase supaya migrasi bisa dijalankan di PGlite.
-- Meniru: skema auth, auth.users, auth.uid(), role bawaan, dan default
-- privileges Supabase (tabel public di-grant ke anon/authenticated; yang
-- membatasi akses adalah RLS).
create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
```

- [ ] **Step 3: Buat harness**

Create `tests/db/harness.ts`:
```ts
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const STUB_FILE = path.join(process.cwd(), "tests", "db", "supabase-stub.sql");

/** Postgres in-memory baru: stub Supabase + semua migrasi (urut nama file). */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(STUB_FILE, "utf8"));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** Daftarkan user di auth.users (trigger membuat profil dosen); kembalikan id-nya. */
export async function createUser(db: PGlite, meta: Record<string, string> = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
    [`${crypto.randomUUID()}@test.local`, JSON.stringify(meta)],
  );
  return rows[0].id;
}

/** Jalankan `fn` sebagai dosen `userId` (role authenticated, RLS berlaku). */
export function asUser<T>(
  db: PGlite,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

/** Jalankan `fn` sebagai pengunjung tanpa login (role anon). */
export function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return fn(tx);
  });
}
```

- [ ] **Step 4: Tulis test skema (gagal)**

Create `tests/db/core-schema.test.ts`:
```ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser } from "./harness";

let db: PGlite;
let dosenA: string;
let dosenB: string;

beforeEach(async () => {
  db = await createTestDb();
  dosenA = await createUser(db, { nama: "Dr. Ani", institusi: "Univ A" });
  dosenB = await createUser(db, { nama: "Dr. Budi", institusi: "Univ B" });
});

function createCourse(userId: string, nama = "Algoritma"): Promise<string> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      "insert into public.courses (nama, semester, tahun_ajaran) values ($1, 'ganjil', '2026/2027') returning id",
      [nama],
    );
    return rows[0].id;
  });
}

function addStudent(userId: string, courseId: string, nim: string) {
  return asUser(db, userId, (tx) =>
    tx.query("insert into public.students (course_id, nim, nama, email) values ($1, $2, 'Mhs', 'mhs@kampus.ac.id')", [
      courseId,
      nim,
    ]),
  );
}

describe("lecturers", () => {
  it("profil dosen dibuat otomatis dari metadata pendaftaran", async () => {
    const rows = await asUser(db, dosenA, async (tx) =>
      (await tx.query("select nama, institusi, credit_balance from public.lecturers")).rows,
    );
    expect(rows).toEqual([{ nama: "Dr. Ani", institusi: "Univ A", credit_balance: 0 }]);
  });

  it("dosen boleh mengubah nama tapi tidak boleh mengubah saldo kredit", async () => {
    const updated = await asUser(db, dosenA, (tx) =>
      tx.query("update public.lecturers set nama = 'Dr. Ani, M.Kom'"),
    );
    expect(updated.affectedRows).toBe(1);
    await expect(
      asUser(db, dosenA, (tx) => tx.query("update public.lecturers set credit_balance = 999")),
    ).rejects.toThrow("permission denied");
  });
});

describe("courses", () => {
  it("kelas otomatis milik pembuatnya dan tidak terlihat dosen lain", async () => {
    await createCourse(dosenA);
    const milikA = await asUser(db, dosenA, async (tx) =>
      (await tx.query("select lecturer_id from public.courses")).rows,
    );
    const terlihatB = await asUser(db, dosenB, async (tx) =>
      (await tx.query("select id from public.courses")).rows,
    );
    expect(milikA).toEqual([{ lecturer_id: dosenA }]);
    expect(terlihatB).toEqual([]);
  });

  it("dosen tidak bisa membuat kelas atas nama dosen lain", async () => {
    await expect(
      asUser(db, dosenB, (tx) =>
        tx.query(
          "insert into public.courses (lecturer_id, nama, semester, tahun_ajaran) values ($1, 'X', 'ganjil', '2026/2027')",
          [dosenA],
        ),
      ),
    ).rejects.toThrow("row-level security");
  });

  it("dosen lain tidak bisa mengubah atau menghapus kelas", async () => {
    const id = await createCourse(dosenA);
    const updated = await asUser(db, dosenB, (tx) =>
      tx.query("update public.courses set nama = 'Dibajak' where id = $1", [id]),
    );
    const deleted = await asUser(db, dosenB, (tx) =>
      tx.query("delete from public.courses where id = $1", [id]),
    );
    expect(updated.affectedRows).toBe(0);
    expect(deleted.affectedRows).toBe(0);
  });

  it("menolak format tahun ajaran yang salah", async () => {
    await expect(
      asUser(db, dosenA, (tx) =>
        tx.query("insert into public.courses (nama, semester, tahun_ajaran) values ('X', 'ganjil', '2026')"),
      ),
    ).rejects.toThrow("courses_tahun_ajaran_check");
  });

  it("pengunjung tanpa login tidak melihat kelas apa pun", async () => {
    await createCourse(dosenA);
    const rows = await asAnon(db, async (tx) => (await tx.query("select id from public.courses")).rows);
    expect(rows).toEqual([]);
  });
});

describe("students", () => {
  it("dosen menambah dan melihat mahasiswa di kelasnya sendiri", async () => {
    const courseId = await createCourse(dosenA);
    await addStudent(dosenA, courseId, "2201001");
    const rows = await asUser(db, dosenA, async (tx) =>
      (await tx.query("select nim from public.students")).rows,
    );
    expect(rows).toEqual([{ nim: "2201001" }]);
  });

  it("dosen lain tidak bisa melihat atau menambah mahasiswa di kelas itu", async () => {
    const courseId = await createCourse(dosenA);
    await addStudent(dosenA, courseId, "2201001");
    const terlihatB = await asUser(db, dosenB, async (tx) =>
      (await tx.query("select id from public.students")).rows,
    );
    expect(terlihatB).toEqual([]);
    await expect(addStudent(dosenB, courseId, "2201002")).rejects.toThrow("row-level security");
  });

  it("NIM unik per kelas, tapi boleh sama di kelas berbeda", async () => {
    const kelas1 = await createCourse(dosenA, "Algoritma");
    const kelas2 = await createCourse(dosenA, "Basis Data");
    await addStudent(dosenA, kelas1, "2201001");
    await expect(addStudent(dosenA, kelas1, "2201001")).rejects.toThrow("students_course_id_nim_key");
    await expect(addStudent(dosenA, kelas2, "2201001")).resolves.toBeDefined();
  });

  it("menghapus kelas ikut menghapus mahasiswanya", async () => {
    const courseId = await createCourse(dosenA);
    await addStudent(dosenA, courseId, "2201001");
    await asUser(db, dosenA, (tx) => tx.query("delete from public.courses where id = $1", [courseId]));
    const { rows } = await db.query("select id from public.students");
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 5: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/db/core-schema.test.ts`
Expected: FAIL — `ENOENT ... supabase/migrations` (folder migrasi belum ada).

- [ ] **Step 6: Tulis migrasi**

Create `supabase/migrations/20261013000100_core_schema.sql`:
```sql
-- Fase 1 — tabel inti: profil dosen, kelas, mahasiswa, beserta RLS.
-- File ini juga dijalankan di test PGlite (tests/db/harness.ts), jadi hanya
-- boleh bergantung pada objek Supabase yang di-stub di tests/db/supabase-stub.sql.

create table public.lecturers (
  id uuid primary key references auth.users (id) on delete cascade,
  nama text not null default '',
  institusi text not null default '',
  credit_balance integer not null default 0 check (credit_balance >= 0),
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  lecturer_id uuid not null default auth.uid() references public.lecturers (id) on delete cascade,
  nama text not null check (length(trim(nama)) > 0),
  kode_mk text not null default '',
  semester text not null check (semester in ('ganjil', 'genap', 'pendek')),
  tahun_ajaran text not null check (tahun_ajaran ~ '^[0-9]{4}/[0-9]{4}$'),
  created_at timestamptz not null default now()
);
create index courses_lecturer_id_idx on public.courses (lecturer_id);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  nim text not null check (length(trim(nim)) > 0),
  nama text not null check (length(trim(nama)) > 0),
  email text not null check (email like '%_@_%'),
  created_at timestamptz not null default now(),
  unique (course_id, nim)
);

-- Profil dosen dibuat otomatis saat akun Supabase Auth terdaftar.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lecturers (id, nama, institusi)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nama', ''),
    coalesce(new.raw_user_meta_data ->> 'institusi', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- credit_balance hanya boleh berubah lewat fungsi kredit (fase 4), jadi dosen
-- cuma mendapat hak UPDATE pada kolom profil; baris dibuat oleh trigger.
revoke insert, update, delete on public.lecturers from anon, authenticated;
grant update (nama, institusi) on public.lecturers to authenticated;

alter table public.lecturers enable row level security;
alter table public.courses enable row level security;
alter table public.students enable row level security;

create policy "dosen membaca profil sendiri" on public.lecturers
  for select to authenticated
  using (id = (select auth.uid()));

create policy "dosen mengubah profil sendiri" on public.lecturers
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "dosen mengelola kelas sendiri" on public.courses
  for all to authenticated
  using (lecturer_id = (select auth.uid()))
  with check (lecturer_id = (select auth.uid()));

create policy "dosen mengelola mahasiswa di kelas sendiri" on public.students
  for all to authenticated
  using (exists (
    select 1 from public.courses c
    where c.id = students.course_id and c.lecturer_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.courses c
    where c.id = students.course_id and c.lecturer_id = (select auth.uid())
  ));
```

- [ ] **Step 7: Jalankan test, pastikan lulus**

Run: `npx vitest run tests/db/core-schema.test.ts`
Expected: PASS, 11 test.

- [ ] **Step 8: Commit**

```bash
git add supabase tests package.json package-lock.json
git commit -m "feat(db): add core schema with RLS and PGlite test harness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Utilitas validasi + parser CSV mahasiswa

**Files:**
- Create: `src/test/form-data.ts`
- Create: `src/lib/validation.ts`, `src/lib/validation.test.ts`
- Create: `src/lib/students/validation.ts`, `src/lib/students/validation.test.ts`
- Create: `src/lib/students/csv.ts`, `src/lib/students/csv.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `@/lib/validation`: `FieldErrors<K>`, `ValidationResult<T>` (`{ok:true; data:T} | {ok:false; errors:FieldErrors}`), `FormState { error?; fieldErrors?; message?; values? }`, `isValidEmail(v): boolean`, `isUuid(v): boolean`, `readString(form, key): string`, `readValues(form, keys): Record<K,string>`.
  - `@/lib/students/validation`: `StudentInput { nim; nama; email }`, `validateStudentFields(raw): ValidationResult<StudentInput>` (NIM → huruf besar, email → huruf kecil, spasi nama dirapikan).
  - `@/lib/students/csv`: `CsvRowError { baris; pesan }`, `parseStudentCsv(text): { students: StudentInput[]; errors: CsvRowError[] }`.
  - `@/test/form-data`: `formData(fields): FormData`.

- [ ] **Step 1: Pasang PapaParse**

Run:
```bash
npm i papaparse@5.5.3
npm i -D @types/papaparse@5.3.16
```

- [ ] **Step 2: Helper test**

Create `src/test/form-data.ts`:
```ts
/** Bangun FormData dari objek biasa, untuk test. */
export function formData(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}
```

- [ ] **Step 3: Tulis test utilitas validasi (gagal)**

Create `src/lib/validation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formData } from "@/test/form-data";
import { isUuid, isValidEmail, readString, readValues } from "./validation";

describe("isValidEmail", () => {
  it.each(["ani@kampus.ac.id", "a.b+c@x.co"])("menerima %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });
  it.each(["", "ani", "ani@", "ani@kampus", "a ni@kampus.ac.id"])("menolak %j", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe("isUuid", () => {
  it("menerima UUID dan menolak string lain", () => {
    expect(isUuid("3f1c2b9e-8a4d-4c6e-9b1a-2d3e4f5a6b7c")).toBe(true);
    expect(isUuid("abc")).toBe(false);
  });
});

describe("readString / readValues", () => {
  it("men-trim nilai teks dan menganggap field kosong/non-teks sebagai string kosong", () => {
    const form = formData({ nama: "  Ani  " });
    form.set("file", new File(["x"], "a.csv"));
    expect(readString(form, "nama")).toBe("Ani");
    expect(readString(form, "tidak-ada")).toBe("");
    expect(readString(form, "file")).toBe("");
  });

  it("membaca beberapa field sekaligus", () => {
    expect(readValues(formData({ a: " 1 ", b: "2" }), ["a", "b", "c"])).toEqual({ a: "1", b: "2", c: "" });
  });
});
```

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/validation.test.ts`
Expected: FAIL — `Failed to resolve import "./validation"`.

- [ ] **Step 5: Implementasi utilitas validasi**

Create `src/lib/validation.ts`:
```ts
/** Utilitas validasi form yang dipakai lintas modul. */

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors<Extract<keyof T, string>> };

/** State yang dikembalikan server action ke form (dipakai dengan useActionState). */
export interface FormState {
  error?: string;
  fieldErrors?: FieldErrors;
  message?: string;
  /** Nilai yang dikirim, untuk mengisi ulang form saat validasi gagal (jangan isi kata sandi). */
  values?: Record<string, string>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Nilai teks dari FormData, sudah di-trim; field kosong atau berupa file → "". */
export function readString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function readValues<K extends string>(form: FormData, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((key) => [key, readString(form, key)])) as Record<K, string>;
}
```

- [ ] **Step 6: Jalankan, pastikan lulus**

Run: `npx vitest run src/lib/validation.test.ts`
Expected: PASS.

- [ ] **Step 7: Tulis test validasi mahasiswa (gagal)**

Create `src/lib/students/validation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateStudentFields } from "./validation";

describe("validateStudentFields", () => {
  it("menormalkan NIM, nama, dan email", () => {
    expect(validateStudentFields({ nim: " a22.01-7 ", nama: "  Budi   Santoso ", email: " BUDI@Kampus.AC.ID " })).toEqual({
      ok: true,
      data: { nim: "A22.01-7", nama: "Budi Santoso", email: "budi@kampus.ac.id" },
    });
  });

  it("melaporkan field kosong", () => {
    expect(validateStudentFields({})).toEqual({
      ok: false,
      errors: { nim: "NIM wajib diisi.", nama: "Nama wajib diisi.", email: "Email wajib diisi." },
    });
  });

  it("menolak NIM berisi spasi dan email tidak valid", () => {
    expect(validateStudentFields({ nim: "22 01", nama: "Budi", email: "budi@" })).toEqual({
      ok: false,
      errors: {
        nim: "NIM hanya boleh berisi huruf, angka, titik, garis miring, atau tanda hubung.",
        email: "Format email tidak valid.",
      },
    });
  });
});
```

- [ ] **Step 8: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/students/validation.test.ts`
Expected: FAIL — `Failed to resolve import "./validation"`.

- [ ] **Step 9: Implementasi validasi mahasiswa**

Create `src/lib/students/validation.ts`:
```ts
import { isValidEmail, type FieldErrors, type ValidationResult } from "@/lib/validation";

export interface StudentInput {
  nim: string;
  nama: string;
  email: string;
}

const NIM_RE = /^[A-Z0-9./-]+$/;

/**
 * Validasi satu mahasiswa. NIM disimpan huruf besar dan email huruf kecil
 * supaya pencocokan login mahasiswa (fase 3) tidak peka huruf.
 */
export function validateStudentFields(raw: {
  nim?: string;
  nama?: string;
  email?: string;
}): ValidationResult<StudentInput> {
  const nim = (raw.nim ?? "").trim().toUpperCase();
  const nama = (raw.nama ?? "").trim().replace(/\s+/g, " ");
  const email = (raw.email ?? "").trim().toLowerCase();
  const errors: FieldErrors<keyof StudentInput> = {};

  if (!nim) errors.nim = "NIM wajib diisi.";
  else if (!NIM_RE.test(nim)) {
    errors.nim = "NIM hanya boleh berisi huruf, angka, titik, garis miring, atau tanda hubung.";
  }
  if (!nama) errors.nama = "Nama wajib diisi.";
  if (!email) errors.email = "Email wajib diisi.";
  else if (!isValidEmail(email)) errors.email = "Format email tidak valid.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { nim, nama, email } };
}
```

- [ ] **Step 10: Jalankan, pastikan lulus**

Run: `npx vitest run src/lib/students/validation.test.ts`
Expected: PASS.

- [ ] **Step 11: Tulis test parser CSV (gagal)**

Create `src/lib/students/csv.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseStudentCsv } from "./csv";

describe("parseStudentCsv", () => {
  it("membaca CSV berpemisah koma", () => {
    const result = parseStudentCsv(
      "nim,nama,email\n2201001,Budi Santoso,budi@kampus.ac.id\n2201002,Siti Aminah,SITI@kampus.ac.id\n",
    );
    expect(result).toEqual({
      students: [
        { nim: "2201001", nama: "Budi Santoso", email: "budi@kampus.ac.id" },
        { nim: "2201002", nama: "Siti Aminah", email: "siti@kampus.ac.id" },
      ],
      errors: [],
    });
  });

  it("membaca ekspor Excel: pemisah titik koma, BOM, CRLF, header tidak rapi", () => {
    const result = parseStudentCsv("\uFEFF NIM ;Nama;Email\r\n2201001;Budi;budi@kampus.ac.id\r\n");
    expect(result).toEqual({
      students: [{ nim: "2201001", nama: "Budi", email: "budi@kampus.ac.id" }],
      errors: [],
    });
  });

  it("urutan kolom bebas, kolom tambahan diabaikan, nama berkoma dalam kutip", () => {
    const result = parseStudentCsv('email,kelas,nama,nim\nbudi@x.id,A,"Budi, S.Kom",2201001\n');
    expect(result.students).toEqual([{ nim: "2201001", nama: "Budi, S.Kom", email: "budi@x.id" }]);
  });

  it("mengabaikan baris kosong", () => {
    const result = parseStudentCsv("nim,nama,email\n\n2201001,Budi,budi@x.id\n,,\n");
    expect(result).toEqual({
      students: [{ nim: "2201001", nama: "Budi", email: "budi@x.id" }],
      errors: [],
    });
  });

  it("melaporkan kolom wajib yang hilang", () => {
    expect(parseStudentCsv("nim,nama\n2201001,Budi\n")).toEqual({
      students: [],
      errors: [{ baris: 1, pesan: "Kolom wajib tidak ditemukan: email." }],
    });
  });

  it("melaporkan baris tidak valid beserta nomor barisnya", () => {
    const result = parseStudentCsv(
      "nim,nama,email\n2201001,Budi,budi@x.id\n,Tanpa NIM,a@x.id\n2201003,Cici,bukan-email\n",
    );
    expect(result.students).toEqual([{ nim: "2201001", nama: "Budi", email: "budi@x.id" }]);
    expect(result.errors).toEqual([
      { baris: 3, pesan: "NIM wajib diisi." },
      { baris: 4, pesan: "Format email tidak valid." },
    ]);
  });

  it("menolak NIM duplikat di dalam file", () => {
    const result = parseStudentCsv("nim,nama,email\n2201001,Budi,budi@x.id\n2201001,Budi Lagi,b2@x.id\n");
    expect(result.errors).toEqual([{ baris: 3, pesan: "NIM 2201001 duplikat (sudah ada di baris 2)." }]);
  });
});
```

- [ ] **Step 12: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/students/csv.test.ts`
Expected: FAIL — `Failed to resolve import "./csv"`.

- [ ] **Step 13: Implementasi parser**

Create `src/lib/students/csv.ts`:
```ts
import Papa from "papaparse";
import { validateStudentFields, type StudentInput } from "./validation";

export interface CsvRowError {
  baris: number;
  pesan: string;
}

export interface ParseStudentCsvResult {
  students: StudentInput[];
  errors: CsvRowError[];
}

const REQUIRED_COLUMNS = ["nim", "nama", "email"] as const;

/**
 * Parse CSV daftar mahasiswa. Kolom wajib: nim, nama, email (urutan bebas,
 * huruf besar/kecil bebas). Pemisah koma atau titik koma dideteksi otomatis —
 * ekspor Excel berbahasa Indonesia memakai `;`. Nomor `baris` menghitung header
 * sebagai baris 1 dan tidak menghitung baris kosong.
 */
export function parseStudentCsv(text: string): ParseStudentCsvResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  const columns = parsed.meta.fields ?? [];
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    return {
      students: [],
      errors: [{ baris: 1, pesan: `Kolom wajib tidak ditemukan: ${missing.join(", ")}.` }],
    };
  }

  const students: StudentInput[] = [];
  const errors: CsvRowError[] = [];
  const firstRowByNim = new Map<string, number>();

  parsed.data.forEach((row, index) => {
    const baris = index + 2;
    const result = validateStudentFields(row);
    if (!result.ok) {
      errors.push({ baris, pesan: Object.values(result.errors).join(" ") });
      return;
    }
    const firstRow = firstRowByNim.get(result.data.nim);
    if (firstRow !== undefined) {
      errors.push({ baris, pesan: `NIM ${result.data.nim} duplikat (sudah ada di baris ${firstRow}).` });
      return;
    }
    firstRowByNim.set(result.data.nim, baris);
    students.push(result.data);
  });

  return { students, errors };
}
```

- [ ] **Step 14: Jalankan semua test**

Run: `npm test`
Expected: PASS (env, db, validation, students).

- [ ] **Step 15: Commit**

```bash
git add src/test src/lib/validation.ts src/lib/validation.test.ts src/lib/students package.json package-lock.json
git commit -m "feat(students): add validation utilities and student CSV parser" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Auth dosen (Supabase) — daftar, konfirmasi, masuk, keluar, guard `/dosen`

**Files:**
- Create: `src/lib/db/types.ts`
- Create: `src/lib/supabase/server.ts`, `src/lib/supabase/proxy-session.ts`, `src/proxy.ts`
- Create: `src/lib/auth/paths.ts`, `src/lib/auth/paths.test.ts`
- Create: `src/lib/auth/validation.ts`, `src/lib/auth/validation.test.ts`
- Create: `src/lib/auth/actions.ts`, `src/lib/auth/session.ts`
- Create: `src/components/ui/field.tsx`, `src/components/ui/submit-button.tsx`, `src/components/ui/form-alert.tsx`
- Create: `src/components/auth/auth-card.tsx`, `src/components/auth/sign-in-form.tsx`, `src/components/auth/sign-up-form.tsx`
- Create: `src/app/masuk/page.tsx`, `src/app/daftar/page.tsx`, `src/app/auth/confirm/route.ts`
- Create: `src/app/dosen/layout.tsx`, `src/app/dosen/page.tsx`
- Modify: `src/app/page.tsx` (ganti total), `README.md` (ganti total)

**Interfaces:**
- Consumes: `readSupabasePublicEnv` (Task 1); `FormState`, `ValidationResult`, `isValidEmail`, `readString`, `readValues`, `formData` (Task 3); tabel `lecturers` + trigger (Task 2).
- Produces:
  - `createSupabaseServerClient(): Promise<SupabaseClient>` dari `@/lib/supabase/server` — dipakai semua query/action berikutnya.
  - `getCurrentLecturer(): Promise<CurrentLecturer | null>` dari `@/lib/auth/session`, `CurrentLecturer { id; email; nama; institusi; creditBalance }`.
  - `@/lib/db/types`: `SEMESTERS`, `Semester`, `LecturerRow`, `CourseRow`, `StudentRow`.
  - Komponen UI: `Field`, `SubmitButton`, `FormAlert` dari `@/components/ui/*`.
  - Layout `/dosen` (header + tombol Keluar) yang membungkus semua halaman dosen.

- [ ] **Step 1: Pasang Supabase**

Run: `npm i @supabase/supabase-js@2 @supabase/ssr@0`

- [ ] **Step 2: Tulis test aturan redirect (gagal)**

Create `src/lib/auth/paths.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveAuthRedirect } from "./paths";

describe("resolveAuthRedirect", () => {
  it.each([
    ["/dosen", false, "/masuk"],
    ["/dosen/kelas/123", false, "/masuk"],
    ["/dosen", true, null],
    ["/masuk", true, "/dosen"],
    ["/daftar", true, "/dosen"],
    ["/masuk", false, null],
    ["/", false, null],
    ["/dosenku-lain", false, null],
  ] as const)("%s (login=%s) → %s", (pathname, loggedIn, expected) => {
    expect(resolveAuthRedirect(pathname, loggedIn)).toBe(expected);
  });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/auth/paths.test.ts`
Expected: FAIL — `Failed to resolve import "./paths"`.

- [ ] **Step 4: Implementasi aturan redirect**

Create `src/lib/auth/paths.ts`:
```ts
const PROTECTED_PREFIX = "/dosen";
const GUEST_ONLY_PATHS = ["/masuk", "/daftar"];

/** Tujuan redirect berdasarkan path & status login; `null` = tidak perlu redirect. */
export function resolveAuthRedirect(pathname: string, isLoggedIn: boolean): string | null {
  const isProtected = pathname === PROTECTED_PREFIX || pathname.startsWith(`${PROTECTED_PREFIX}/`);
  if (isProtected && !isLoggedIn) return "/masuk";
  if (GUEST_ONLY_PATHS.includes(pathname) && isLoggedIn) return "/dosen";
  return null;
}
```

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `npx vitest run src/lib/auth/paths.test.ts`
Expected: PASS.

- [ ] **Step 6: Tulis test validasi auth (gagal)**

Create `src/lib/auth/validation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formData } from "@/test/form-data";
import { authErrorMessage, validateSignIn, validateSignUp } from "./validation";

describe("validateSignUp", () => {
  it("menerima input valid, men-trim teks dan menormalkan email", () => {
    expect(
      validateSignUp(
        formData({ nama: " Dr. Ani ", institusi: "Univ A", email: "ANI@Kampus.ac.id", password: " rahasia1 " }),
      ),
    ).toEqual({
      ok: true,
      data: { nama: "Dr. Ani", institusi: "Univ A", email: "ani@kampus.ac.id", password: " rahasia1 " },
    });
  });

  it("mengumpulkan semua error field", () => {
    expect(validateSignUp(formData({ nama: "", institusi: "", email: "bukan-email", password: "pendek" }))).toEqual({
      ok: false,
      errors: {
        nama: "Nama wajib diisi.",
        institusi: "Institusi wajib diisi.",
        email: "Format email tidak valid.",
        password: "Kata sandi minimal 8 karakter.",
      },
    });
  });
});

describe("validateSignIn", () => {
  it("mewajibkan email dan kata sandi", () => {
    expect(validateSignIn(formData({}))).toEqual({
      ok: false,
      errors: { email: "Email wajib diisi.", password: "Kata sandi wajib diisi." },
    });
  });

  it("menerima input valid", () => {
    expect(validateSignIn(formData({ email: "Ani@Kampus.ac.id", password: "x" }))).toEqual({
      ok: true,
      data: { email: "ani@kampus.ac.id", password: "x" },
    });
  });
});

describe("authErrorMessage", () => {
  it("menerjemahkan kode error Supabase yang dikenal", () => {
    expect(authErrorMessage("invalid_credentials")).toBe("Email atau kata sandi salah.");
    expect(authErrorMessage("email_not_confirmed")).toBe("Email belum dikonfirmasi. Cek kotak masuk kamu.");
  });

  it("memberi pesan umum untuk kode lain", () => {
    expect(authErrorMessage("unexpected_failure")).toBe("Terjadi kesalahan. Coba lagi.");
    expect(authErrorMessage(undefined)).toBe("Terjadi kesalahan. Coba lagi.");
  });
});
```

- [ ] **Step 7: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/auth/validation.test.ts`
Expected: FAIL — `Failed to resolve import "./validation"`.

- [ ] **Step 8: Implementasi validasi auth**

Create `src/lib/auth/validation.ts`:
```ts
import { isValidEmail, readString, type FieldErrors, type ValidationResult } from "@/lib/validation";

export interface SignUpInput {
  nama: string;
  institusi: string;
  email: string;
  password: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export const MIN_PASSWORD_LENGTH = 8;

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email atau kata sandi salah.",
  email_not_confirmed: "Email belum dikonfirmasi. Cek kotak masuk kamu.",
  user_already_exists: "Email sudah terdaftar. Silakan masuk.",
  weak_password: `Kata sandi terlalu lemah. Gunakan minimal ${MIN_PASSWORD_LENGTH} karakter.`,
  over_email_send_rate_limit: "Terlalu banyak permintaan email. Coba lagi beberapa menit lagi.",
};

/** Pesan Bahasa Indonesia untuk `AuthError.code` dari Supabase. */
export function authErrorMessage(code: string | undefined): string {
  return (code && AUTH_ERROR_MESSAGES[code]) || "Terjadi kesalahan. Coba lagi.";
}

function readPassword(form: FormData): string {
  const value = form.get("password");
  return typeof value === "string" ? value : "";
}

function emailError(email: string): string | undefined {
  if (!email) return "Email wajib diisi.";
  if (!isValidEmail(email)) return "Format email tidak valid.";
  return undefined;
}

function result<T>(data: T, errors: FieldErrors<Extract<keyof T, string>>): ValidationResult<T> {
  const cleaned = Object.fromEntries(Object.entries(errors).filter(([, message]) => message)) as FieldErrors<
    Extract<keyof T, string>
  >;
  return Object.keys(cleaned).length > 0 ? { ok: false, errors: cleaned } : { ok: true, data };
}

export function validateSignUp(form: FormData): ValidationResult<SignUpInput> {
  const data: SignUpInput = {
    nama: readString(form, "nama"),
    institusi: readString(form, "institusi"),
    email: readString(form, "email").toLowerCase(),
    password: readPassword(form),
  };
  return result(data, {
    nama: data.nama ? undefined : "Nama wajib diisi.",
    institusi: data.institusi ? undefined : "Institusi wajib diisi.",
    email: emailError(data.email),
    password:
      data.password.length >= MIN_PASSWORD_LENGTH
        ? undefined
        : `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`,
  });
}

export function validateSignIn(form: FormData): ValidationResult<SignInInput> {
  const data: SignInInput = {
    email: readString(form, "email").toLowerCase(),
    password: readPassword(form),
  };
  return result(data, {
    email: emailError(data.email),
    password: data.password ? undefined : "Kata sandi wajib diisi.",
  });
}
```

- [ ] **Step 9: Jalankan, pastikan lulus**

Run: `npx vitest run src/lib/auth/validation.test.ts`
Expected: PASS.

- [ ] **Step 10: Tipe baris tabel + client Supabase**

Create `src/lib/db/types.ts`:
```ts
/** Bentuk baris tabel Postgres (snake_case), sesuai supabase/migrations. */

export const SEMESTERS = ["ganjil", "genap", "pendek"] as const;
export type Semester = (typeof SEMESTERS)[number];

export interface LecturerRow {
  id: string;
  nama: string;
  institusi: string;
  credit_balance: number;
  created_at: string;
}

export interface CourseRow {
  id: string;
  lecturer_id: string;
  nama: string;
  kode_mk: string;
  semester: Semester;
  tahun_ajaran: string;
  created_at: string;
}

export interface StudentRow {
  id: string;
  course_id: string;
  nim: string;
  nama: string;
  email: string;
  created_at: string;
}
```

Create `src/lib/supabase/server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabasePublicEnv } from "@/lib/env";

/** Client Supabase untuk Server Component, Server Action, dan Route Handler. */
export async function createSupabaseServerClient() {
  // cookies() dipanggil lebih dulu supaya route ditandai dinamis sebelum env
  // dibaca — `next build` tanpa .env.local tidak ikut gagal saat prerender.
  const cookieStore = await cookies();
  const { url, publishableKey } = readSupabasePublicEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component tidak boleh menulis cookie; sesi disegarkan oleh proxy.ts.
        }
      },
    },
  });
}
```

Create `src/lib/supabase/proxy-session.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthRedirect } from "@/lib/auth/paths";
import { readSupabasePublicEnv } from "@/lib/env";

/** Segarkan cookie sesi Supabase dan terapkan redirect auth. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = readSupabasePublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Jangan sisipkan kode di antara createServerClient dan getUser (panduan @supabase/ssr).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectPath = resolveAuthRedirect(request.nextUrl.pathname, Boolean(user));
  if (!redirectPath) return response;

  const target = request.nextUrl.clone();
  target.pathname = redirectPath;
  target.search = "";
  const redirect = NextResponse.redirect(target);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
```

Create `src/proxy.ts`:
```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|csv)$).*)"],
};
```

- [ ] **Step 11: Server actions + sesi**

Create `src/lib/auth/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readValues, type FormState } from "@/lib/validation";
import { authErrorMessage, validateSignIn, validateSignUp } from "./validation";

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = readValues(form, ["nama", "institusi", "email"]);
  const parsed = validateSignUp(form);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };

  const { nama, institusi, email, password } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nama, institusi } },
  });
  if (error) return { error: authErrorMessage(error.code), values };

  return { message: "Akun dibuat. Cek email kamu dan klik tautan konfirmasi, lalu masuk." };
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = readValues(form, ["email"]);
  const parsed = validateSignIn(form);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authErrorMessage(error.code), values };

  redirect("/dosen");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/masuk");
}
```

Create `src/lib/auth/session.ts`:
```ts
import { cache } from "react";
import type { LecturerRow } from "@/lib/db/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CurrentLecturer {
  id: string;
  email: string;
  nama: string;
  institusi: string;
  creditBalance: number;
}

/** Dosen yang sedang login (di-cache per request), atau null. */
export const getCurrentLecturer = cache(async (): Promise<CurrentLecturer | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("lecturers")
    .select("nama, institusi, credit_balance")
    .eq("id", user.id)
    .maybeSingle();
  const row = data as Pick<LecturerRow, "nama" | "institusi" | "credit_balance"> | null;
  if (!row) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    nama: row.nama,
    institusi: row.institusi,
    creditBalance: row.credit_balance,
  };
});
```

Create `src/app/auth/confirm/route.ts`:
```ts
import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Tujuan tautan di email konfirmasi Supabase (template memakai token_hash). */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect("/dosen");
  }

  redirect("/masuk?error=konfirmasi");
}
```

- [ ] **Step 12: Komponen UI**

Create `src/components/ui/field.tsx`:
```tsx
interface FieldProps {
  label: string;
  name: string;
  type?: string;
  error?: string;
  defaultValue?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}

export function Field({ label, name, type = "text", error, ...inputProps }: FieldProps) {
  const errorId = `${name}-error`;
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        {...inputProps}
      />
      {error && (
        <span id={errorId} className="block text-sm text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}
```

Create `src/components/ui/submit-button.tsx`:
```tsx
"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText = "Memproses..." }: { children: ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}
```

Create `src/components/ui/form-alert.tsx`:
```tsx
import type { FormState } from "@/lib/validation";

export function FormAlert({ state }: { state: Pick<FormState, "error" | "message"> }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return null;
}
```

- [ ] **Step 13: Halaman auth**

Create `src/components/auth/auth-card.tsx`:
```tsx
import type { ReactNode } from "react";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}
```

Create `src/components/auth/sign-in-form.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInAction } from "@/lib/auth/actions";

export function SignInForm({ initialError }: { initialError?: string }) {
  const [state, formAction] = useActionState(signInAction, { error: initialError });

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
        required
      />
      <Field
        label="Kata sandi"
        name="password"
        type="password"
        autoComplete="current-password"
        error={state.fieldErrors?.password}
        required
      />
      <SubmitButton pendingText="Masuk...">Masuk</SubmitButton>
      <p className="text-center text-sm text-slate-600">
        Belum punya akun?{" "}
        <Link href="/daftar" className="font-medium text-indigo-600 hover:underline">
          Daftar
        </Link>
      </p>
    </form>
  );
}
```

Create `src/components/auth/sign-up-form.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signUpAction } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/validation";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, {});

  if (state.message) {
    return (
      <div className="space-y-4">
        <FormAlert state={state} />
        <Link href="/masuk" className="block text-center text-sm font-medium text-indigo-600 hover:underline">
          Ke halaman masuk
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />
      <Field label="Nama lengkap & gelar" name="nama" autoComplete="name" defaultValue={state.values?.nama} error={state.fieldErrors?.nama} required />
      <Field label="Institusi" name="institusi" autoComplete="organization" defaultValue={state.values?.institusi} error={state.fieldErrors?.institusi} required />
      <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} error={state.fieldErrors?.email} required />
      <Field
        label={`Kata sandi (min. ${MIN_PASSWORD_LENGTH} karakter)`}
        name="password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.password}
        required
      />
      <SubmitButton pendingText="Mendaftar...">Daftar</SubmitButton>
      <p className="text-center text-sm text-slate-600">
        Sudah punya akun?{" "}
        <Link href="/masuk" className="font-medium text-indigo-600 hover:underline">
          Masuk
        </Link>
      </p>
    </form>
  );
}
```

Create `src/app/masuk/page.tsx`:
```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Masuk — Dosenku" };

const QUERY_ERRORS: Record<string, string> = {
  konfirmasi: "Tautan konfirmasi tidak valid atau sudah kedaluwarsa. Coba masuk, atau daftar ulang.",
};

export default async function MasukPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthCard title="Masuk ke Dosenku">
      <SignInForm initialError={error ? QUERY_ERRORS[error] : undefined} />
    </AuthCard>
  );
}
```

Create `src/app/daftar/page.tsx`:
```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Daftar — Dosenku" };

export default function DaftarPage() {
  return (
    <AuthCard title="Buat akun dosen">
      <SignUpForm />
    </AuthCard>
  );
}
```

- [ ] **Step 14: Layout dosen, halaman awal, landing**

Create `src/app/dosen/layout.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { getCurrentLecturer } from "@/lib/auth/session";

export default async function DosenLayout({ children }: { children: ReactNode }) {
  const lecturer = await getCurrentLecturer();
  if (!lecturer) redirect("/masuk");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dosen" className="font-semibold text-indigo-700">
            Dosenku
          </Link>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{lecturer.nama || lecturer.email}</span>
            <form action={signOutAction}>
              <button type="submit" className="rounded-md px-2 py-1 hover:bg-slate-100">
                Keluar
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
```

Create `src/app/dosen/page.tsx` (sementara; diganti di Task 5):
```tsx
import { getCurrentLecturer } from "@/lib/auth/session";

export default async function DosenHomePage() {
  const lecturer = await getCurrentLecturer();
  return <h1 className="text-2xl font-semibold text-slate-900">Halo, {lecturer?.nama}</h1>;
}
```

Ganti seluruh isi `src/app/page.tsx`:
```tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4 text-center">
      <h1 className="text-4xl font-bold text-slate-900">Dosenku</h1>
      <p className="max-w-md text-slate-600">
        Kumpulkan tugas, nilai otomatis dengan AI berdasarkan rubrikmu, dan rekap nilai akhir tanpa ribet.
      </p>
      <div className="flex gap-3">
        <Link href="/daftar" className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500">
          Daftar
        </Link>
        <Link href="/masuk" className="rounded-md px-4 py-2 font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
          Masuk
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 15: README setup**

Ganti seluruh isi `README.md`:
````markdown
# Dosenku

Asisten administrasi dosen: kumpulkan tugas, nilai otomatis dengan AI, rekap nilai.

## Setup lokal

1. `npm install`
2. Buat project di https://supabase.com (region Singapore).
3. Salin `.env.example` ke `.env.local`, isi dari **Project Settings → API Keys** (Publishable key) dan **Data API** (Project URL).
4. **Authentication → URL Configuration**: Site URL = `http://localhost:3000`.
5. **Authentication → Emails → Confirm signup**: ganti tautan di template menjadi
   `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Konfirmasi email</a>`
6. **SQL Editor**: jalankan setiap file di `supabase/migrations/` berurutan (yang belum pernah dijalankan).
7. `npm run dev` → http://localhost:3000

## Perintah

- `npm test` — unit test + test database (PGlite, tanpa Docker)
- `npm run lint`
- `npm run build`
````

- [ ] **Step 16: Verifikasi otomatis**

Run: `npm test && npm run lint && npm run build`
Expected: semua PASS / sukses.

- [ ] **Step 17: Setup Supabase (manual — oleh pemilik project)**

PAUSE: minta pemilik project menjalankan langkah 2–6 di README (membuat project Supabase, mengisi `.env.local`, Site URL, template email, menjalankan migrasi `20261013000100_core_schema.sql` di SQL Editor). Agen tidak membuat akun atau memasukkan kredensial.

- [ ] **Step 18: Verifikasi manual alur auth**

Run: `npm run dev`, lalu di browser:
1. Buka `/dosen` → dialihkan ke `/masuk`.
2. `/daftar` → isi form dengan password 7 karakter → muncul "Kata sandi minimal 8 karakter.", nama/email tetap terisi.
3. Daftar dengan data valid → muncul pesan cek email.
4. Klik tautan di email → masuk ke `/dosen`, tampil "Halo, <nama>".
5. Supabase Table Editor → tabel `lecturers` punya baris dengan nama & institusi.
6. Buka `/masuk` saat login → dialihkan ke `/dosen`.
7. Klik Keluar → ke `/masuk`; masuk dengan password salah → "Email atau kata sandi salah."

- [ ] **Step 19: Commit**

```bash
git add -A
git commit -m "feat(auth): add lecturer sign-up, email confirmation, sign-in and /dosen guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Kelola kelas — buat kelas & daftar kelas

**Files:**
- Create: `src/lib/courses/validation.ts`, `src/lib/courses/validation.test.ts`
- Create: `src/lib/courses/queries.ts`, `src/lib/courses/actions.ts`
- Create: `src/components/courses/course-list.tsx`, `src/components/courses/create-course-form.tsx`
- Modify: `src/app/dosen/page.tsx` (ganti total)

**Interfaces:**
- Consumes: `createSupabaseServerClient` (Task 4), `SEMESTERS`/`Semester`/`CourseRow` (Task 4), `FormState`, `readString`, `readValues`, `isUuid`, `formData` (Task 3), `Field`, `SubmitButton`, `FormAlert` (Task 4).
- Produces:
  - `@/lib/courses/validation`: `CourseInput { nama; kodeMk; semester; tahunAjaran }`, `validateCourse(form)`, `isValidTahunAjaran(v)`, `currentAcademicPeriod(now): { semester; tahunAjaran }`, `SEMESTER_LABELS`, `formatPeriod(semester, tahunAjaran): string`.
  - `@/lib/courses/queries`: `CourseSummary` (`id, nama, kode_mk, semester, tahun_ajaran, studentCount`), `listCourses()`, `getCourse(id): Promise<CourseRow | null>` (null untuk id bukan UUID atau bukan milik dosen).
  - `createCourseAction(prev, form)` → redirect ke `/dosen/kelas/{id}`.

- [ ] **Step 1: Tulis test validasi kelas (gagal)**

Create `src/lib/courses/validation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formData } from "@/test/form-data";
import { currentAcademicPeriod, formatPeriod, isValidTahunAjaran, validateCourse } from "./validation";

describe("validateCourse", () => {
  it("menerima input valid dan menjadikan kode MK huruf besar", () => {
    expect(
      validateCourse(formData({ nama: " Algoritma ", kodeMk: "if201", semester: "ganjil", tahunAjaran: "2026/2027" })),
    ).toEqual({
      ok: true,
      data: { nama: "Algoritma", kodeMk: "IF201", semester: "ganjil", tahunAjaran: "2026/2027" },
    });
  });

  it("kode MK boleh kosong", () => {
    const result = validateCourse(formData({ nama: "Algoritma", semester: "genap", tahunAjaran: "2026/2027" }));
    expect(result.ok && result.data.kodeMk).toBe("");
  });

  it("melaporkan field yang salah", () => {
    expect(validateCourse(formData({ nama: "", semester: "musim-panas", tahunAjaran: "2026/2028" }))).toEqual({
      ok: false,
      errors: {
        nama: "Nama mata kuliah wajib diisi.",
        semester: "Pilih semester.",
        tahunAjaran: "Format tahun ajaran: 2026/2027.",
      },
    });
  });
});

describe("isValidTahunAjaran", () => {
  it.each([
    ["2026/2027", true],
    ["2026/2028", false],
    ["2026", false],
    ["26/27", false],
  ] as const)("%s → %s", (value, expected) => {
    expect(isValidTahunAjaran(value)).toBe(expected);
  });
});

describe("currentAcademicPeriod", () => {
  it.each([
    [new Date(2026, 9, 13), "ganjil", "2026/2027"],
    [new Date(2027, 0, 15), "ganjil", "2026/2027"],
    [new Date(2027, 1, 1), "genap", "2026/2027"],
    [new Date(2027, 6, 31), "genap", "2026/2027"],
    [new Date(2027, 7, 1), "ganjil", "2027/2028"],
  ])("%s → %s %s", (date, semester, tahunAjaran) => {
    expect(currentAcademicPeriod(date)).toEqual({ semester, tahunAjaran });
  });
});

describe("formatPeriod", () => {
  it("menampilkan label semester dan tahun ajaran", () => {
    expect(formatPeriod("ganjil", "2026/2027")).toBe("Ganjil 2026/2027");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/courses/validation.test.ts`
Expected: FAIL — `Failed to resolve import "./validation"`.

- [ ] **Step 3: Implementasi validasi kelas**

Create `src/lib/courses/validation.ts`:
```ts
import { SEMESTERS, type Semester } from "@/lib/db/types";
import { readString, type FieldErrors, type ValidationResult } from "@/lib/validation";

export interface CourseInput {
  nama: string;
  kodeMk: string;
  semester: Semester;
  tahunAjaran: string;
}

export const SEMESTER_LABELS: Record<Semester, string> = {
  ganjil: "Ganjil",
  genap: "Genap",
  pendek: "Pendek",
};

function isSemester(value: string): value is Semester {
  return (SEMESTERS as readonly string[]).includes(value);
}

export function isValidTahunAjaran(value: string): boolean {
  const match = /^(\d{4})\/(\d{4})$/.exec(value);
  return match !== null && Number(match[2]) === Number(match[1]) + 1;
}

export function validateCourse(form: FormData): ValidationResult<CourseInput> {
  const nama = readString(form, "nama");
  const kodeMk = readString(form, "kodeMk").toUpperCase();
  const semester = readString(form, "semester");
  const tahunAjaran = readString(form, "tahunAjaran");
  const errors: FieldErrors<keyof CourseInput> = {};

  if (!nama) errors.nama = "Nama mata kuliah wajib diisi.";
  if (!isSemester(semester)) errors.semester = "Pilih semester.";
  if (!isValidTahunAjaran(tahunAjaran)) errors.tahunAjaran = "Format tahun ajaran: 2026/2027.";

  if (Object.keys(errors).length > 0 || !isSemester(semester)) return { ok: false, errors };
  return { ok: true, data: { nama, kodeMk, semester, tahunAjaran } };
}

/** Periode berjalan: Agustus–Januari = ganjil, Februari–Juli = genap. */
export function currentAcademicPeriod(now: Date): { semester: Semester; tahunAjaran: string } {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0 = Januari
  if (month >= 7) return { semester: "ganjil", tahunAjaran: `${year}/${year + 1}` };
  if (month === 0) return { semester: "ganjil", tahunAjaran: `${year - 1}/${year}` };
  return { semester: "genap", tahunAjaran: `${year - 1}/${year}` };
}

export function formatPeriod(semester: Semester, tahunAjaran: string): string {
  return `${SEMESTER_LABELS[semester]} ${tahunAjaran}`;
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npx vitest run src/lib/courses/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Query & action kelas**

Create `src/lib/courses/queries.ts`:
```ts
import type { CourseRow } from "@/lib/db/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

export interface CourseSummary extends Pick<CourseRow, "id" | "nama" | "kode_mk" | "semester" | "tahun_ajaran"> {
  studentCount: number;
}

/** Kelas milik dosen yang login (RLS), terbaru dulu. */
export async function listCourses(): Promise<CourseSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id, nama, kode_mk, semester, tahun_ajaran, students(count)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Gagal memuat kelas: ${error.message}`);

  return (data ?? []).map(({ students, ...course }) => ({
    ...(course as Omit<CourseSummary, "studentCount">),
    studentCount: (students as { count: number }[])[0]?.count ?? 0,
  }));
}

/** Kelas milik dosen yang login; null jika id tidak valid, tidak ada, atau milik dosen lain. */
export async function getCourse(id: string): Promise<CourseRow | null> {
  if (!isUuid(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("courses").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Gagal memuat kelas: ${error.message}`);
  return data as CourseRow | null;
}
```

Create `src/lib/courses/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readValues, type FormState } from "@/lib/validation";
import { validateCourse } from "./validation";

export async function createCourseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = readValues(form, ["nama", "kodeMk", "semester", "tahunAjaran"]);
  const parsed = validateCourse(form);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };

  const { nama, kodeMk, semester, tahunAjaran } = parsed.data;
  const supabase = await createSupabaseServerClient();
  // lecturer_id diisi default auth.uid() di database.
  const { data, error } = await supabase
    .from("courses")
    .insert({ nama, kode_mk: kodeMk, semester, tahun_ajaran: tahunAjaran })
    .select("id")
    .single();
  if (error || !data) return { error: "Gagal membuat kelas. Coba lagi.", values };

  revalidatePath("/dosen");
  redirect(`/dosen/kelas/${data.id}`);
}
```

- [ ] **Step 6: Komponen kelas**

Create `src/components/courses/course-list.tsx`:
```tsx
import Link from "next/link";
import type { CourseSummary } from "@/lib/courses/queries";
import { formatPeriod } from "@/lib/courses/validation";

export function CourseList({ courses }: { courses: CourseSummary[] }) {
  if (courses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Belum ada kelas. Buat kelas pertamamu lewat form &ldquo;Kelas baru&rdquo;.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {courses.map((course) => (
        <li key={course.id}>
          <Link
            href={`/dosen/kelas/${course.id}`}
            className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300"
          >
            <p className="font-semibold text-slate-900">{course.nama}</p>
            <p className="text-sm text-slate-500">
              {[course.kode_mk, formatPeriod(course.semester, course.tahun_ajaran)].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 text-sm text-slate-600">{course.studentCount} mahasiswa</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

Create `src/components/courses/create-course-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { createCourseAction } from "@/lib/courses/actions";
import { SEMESTER_LABELS } from "@/lib/courses/validation";
import { SEMESTERS, type Semester } from "@/lib/db/types";

interface Props {
  defaultSemester: Semester;
  defaultTahunAjaran: string;
}

export function CreateCourseForm({ defaultSemester, defaultTahunAjaran }: Props) {
  const [state, formAction] = useActionState(createCourseAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />
      <Field label="Nama mata kuliah" name="nama" defaultValue={state.values?.nama} error={state.fieldErrors?.nama} required />
      <Field label="Kode MK (opsional)" name="kodeMk" defaultValue={state.values?.kodeMk} error={state.fieldErrors?.kodeMk} />
      <label className="block space-y-1">
        <span className="text-sm font-medium text-slate-700">Semester</span>
        <select
          name="semester"
          defaultValue={state.values?.semester ?? defaultSemester}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        >
          {SEMESTERS.map((semester) => (
            <option key={semester} value={semester}>
              {SEMESTER_LABELS[semester]}
            </option>
          ))}
        </select>
        {state.fieldErrors?.semester && (
          <span className="block text-sm text-red-600">{state.fieldErrors.semester}</span>
        )}
      </label>
      <Field
        label="Tahun ajaran"
        name="tahunAjaran"
        placeholder="2026/2027"
        defaultValue={state.values?.tahunAjaran ?? defaultTahunAjaran}
        error={state.fieldErrors?.tahunAjaran}
        required
      />
      <SubmitButton pendingText="Menyimpan...">Buat kelas</SubmitButton>
    </form>
  );
}
```

Ganti seluruh isi `src/app/dosen/page.tsx`:
```tsx
import { CourseList } from "@/components/courses/course-list";
import { CreateCourseForm } from "@/components/courses/create-course-form";
import { listCourses } from "@/lib/courses/queries";
import { currentAcademicPeriod } from "@/lib/courses/validation";

export default async function DosenHomePage() {
  const courses = await listCourses();
  const period = currentAcademicPeriod(new Date());

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Kelas saya</h1>
        <CourseList courses={courses} />
      </section>
      <aside className="h-fit rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-4 font-semibold text-slate-900">Kelas baru</h2>
        <CreateCourseForm defaultSemester={period.semester} defaultTahunAjaran={period.tahunAjaran} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 7: Halaman detail kelas minimal (agar redirect tidak 404)**

Create `src/app/dosen/kelas/[id]/page.tsx` (dilengkapi di Task 6):
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/courses/queries";
import { formatPeriod } from "@/lib/courses/validation";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await getCourse(id);
  if (!course) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href="/dosen" className="text-sm text-indigo-600 hover:underline">
          ← Kelas saya
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">{course.nama}</h1>
        <p className="text-sm text-slate-600">
          {[course.kode_mk, formatPeriod(course.semester, course.tahun_ajaran)].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verifikasi**

Run: `npm test && npm run lint && npm run build`
Expected: semua sukses.

Manual (`npm run dev`, login sebagai dosen):
1. `/dosen` menampilkan "Belum ada kelas"; form terisi default periode berjalan (Oktober 2026 → Ganjil 2026/2027).
2. Submit dengan tahun ajaran `2026/2028` → error tampil, nilai lain tetap terisi.
3. Buat kelas valid → dialihkan ke `/dosen/kelas/<id>` dengan judul kelas; kembali ke `/dosen` → kartu kelas tampil "0 mahasiswa".
4. Buka `/dosen/kelas/bukan-uuid` → halaman 404.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "feat(courses): create and list courses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Kelola mahasiswa — import CSV, tambah, hapus

**Files:**
- Create: `src/lib/students/import-file.ts`, `src/lib/students/import-file.test.ts`
- Create: `src/lib/students/queries.ts`, `src/lib/students/actions.ts`
- Create: `src/components/students/import-students-form.tsx`, `src/components/students/add-student-form.tsx`, `src/components/students/student-table.tsx`, `src/components/students/delete-student-button.tsx`
- Create: `public/template-mahasiswa.csv`
- Modify: `src/app/dosen/kelas/[id]/page.tsx` (ganti total)

**Interfaces:**
- Consumes: `parseStudentCsv`, `CsvRowError`, `validateStudentFields`, `StudentInput` (Task 3); `getCourse`, `formatPeriod` (Task 5); `createSupabaseServerClient`, `StudentRow`, komponen UI (Task 4).
- Produces:
  - `readStudentCsvFile(entry): Promise<{ok:true; students} | {ok:false; error; rowErrors}>`, `MAX_CSV_BYTES = 1_000_000`.
  - `listStudents(courseId): Promise<StudentRow[]>` (urut NIM) — dipakai fase 2 (kelompok) dan fase 6 (gradebook).
  - Actions: `importStudentsAction(courseId, prev, form)`, `addStudentAction(courseId, prev, form)`, `deleteStudentAction(courseId, studentId)`; `StudentImportState extends FormState { rowErrors?: CsvRowError[] }`.

- [ ] **Step 1: Tulis test pembaca file CSV (gagal)**

Create `src/lib/students/import-file.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MAX_CSV_BYTES, readStudentCsvFile } from "./import-file";

const csvFile = (content: string) => new File([content], "mahasiswa.csv", { type: "text/csv" });

describe("readStudentCsvFile", () => {
  it("menolak jika tidak ada file atau file kosong", async () => {
    const expected = { ok: false, error: "Pilih file CSV terlebih dahulu.", rowErrors: [] };
    await expect(readStudentCsvFile(null)).resolves.toEqual(expected);
    await expect(readStudentCsvFile("teks")).resolves.toEqual(expected);
    await expect(readStudentCsvFile(csvFile(""))).resolves.toEqual(expected);
  });

  it("menolak file lebih dari 1 MB", async () => {
    await expect(readStudentCsvFile(csvFile("a".repeat(MAX_CSV_BYTES + 1)))).resolves.toEqual({
      ok: false,
      error: "Ukuran file maksimal 1 MB.",
      rowErrors: [],
    });
  });

  it("mengembalikan daftar mahasiswa dari CSV valid", async () => {
    await expect(readStudentCsvFile(csvFile("nim,nama,email\n2201001,Budi,budi@x.id\n"))).resolves.toEqual({
      ok: true,
      students: [{ nim: "2201001", nama: "Budi", email: "budi@x.id" }],
    });
  });

  it("menolak seluruh file jika ada baris bermasalah", async () => {
    const result = await readStudentCsvFile(csvFile("nim,nama,email\n2201001,Budi,budi@x.id\n2201002,Cici,salah\n"));
    expect(result).toEqual({
      ok: false,
      error: "Ada 1 baris bermasalah. Perbaiki lalu unggah ulang — belum ada data yang disimpan.",
      rowErrors: [{ baris: 3, pesan: "Format email tidak valid." }],
    });
  });

  it("menolak CSV yang hanya berisi header", async () => {
    await expect(readStudentCsvFile(csvFile("nim,nama,email\n"))).resolves.toEqual({
      ok: false,
      error: "File tidak berisi data mahasiswa.",
      rowErrors: [],
    });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/students/import-file.test.ts`
Expected: FAIL — `Failed to resolve import "./import-file"`.

- [ ] **Step 3: Implementasi**

Create `src/lib/students/import-file.ts`:
```ts
import { parseStudentCsv, type CsvRowError } from "./csv";
import type { StudentInput } from "./validation";

export const MAX_CSV_BYTES = 1_000_000;

export type ReadStudentFileResult =
  | { ok: true; students: StudentInput[] }
  | { ok: false; error: string; rowErrors: CsvRowError[] };

/** Validasi file CSV dari form import. Semua-atau-tidak: satu baris salah → tidak ada yang disimpan. */
export async function readStudentCsvFile(entry: FormDataEntryValue | null): Promise<ReadStudentFileResult> {
  if (!(entry instanceof File) || entry.size === 0) {
    return { ok: false, error: "Pilih file CSV terlebih dahulu.", rowErrors: [] };
  }
  if (entry.size > MAX_CSV_BYTES) {
    return { ok: false, error: "Ukuran file maksimal 1 MB.", rowErrors: [] };
  }

  const { students, errors } = parseStudentCsv(await entry.text());
  if (errors.length > 0) {
    return {
      ok: false,
      error: `Ada ${errors.length} baris bermasalah. Perbaiki lalu unggah ulang — belum ada data yang disimpan.`,
      rowErrors: errors,
    };
  }
  if (students.length === 0) {
    return { ok: false, error: "File tidak berisi data mahasiswa.", rowErrors: [] };
  }
  return { ok: true, students };
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npx vitest run src/lib/students/import-file.test.ts`
Expected: PASS.

- [ ] **Step 5: Query & actions mahasiswa**

Create `src/lib/students/queries.ts`:
```ts
import type { StudentRow } from "@/lib/db/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Mahasiswa di kelas (RLS memastikan kelasnya milik dosen yang login), urut NIM. */
export async function listStudents(courseId: string): Promise<StudentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .eq("course_id", courseId)
    .order("nim");
  if (error) throw new Error(`Gagal memuat mahasiswa: ${error.message}`);
  return (data ?? []) as StudentRow[];
}
```

Create `src/lib/students/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readValues, type FormState } from "@/lib/validation";
import type { CsvRowError } from "./csv";
import { readStudentCsvFile } from "./import-file";
import { validateStudentFields } from "./validation";

// courseId berasal dari klien (bind) sehingga tidak dipercaya — RLS yang
// memastikan kelasnya milik dosen yang login.

const UNIQUE_VIOLATION = "23505";

export interface StudentImportState extends FormState {
  rowErrors?: CsvRowError[];
}

export async function importStudentsAction(
  courseId: string,
  _prev: StudentImportState,
  form: FormData,
): Promise<StudentImportState> {
  const result = await readStudentCsvFile(form.get("file"));
  if (!result.ok) return { error: result.error, rowErrors: result.rowErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("students")
    .upsert(
      result.students.map((student) => ({ course_id: courseId, ...student })),
      { onConflict: "course_id,nim" },
    );
  if (error) return { error: "Gagal menyimpan data mahasiswa. Coba lagi." };

  revalidatePath(`/dosen/kelas/${courseId}`);
  return {
    message: `${result.students.length} mahasiswa diimpor. Data dengan NIM yang sudah ada diperbarui.`,
  };
}

export async function addStudentAction(courseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = readValues(form, ["nim", "nama", "email"]);
  const parsed = validateStudentFields(values);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("students").insert({ course_id: courseId, ...parsed.data });
  if (error?.code === UNIQUE_VIOLATION) {
    return { fieldErrors: { nim: "NIM ini sudah terdaftar di kelas ini." }, values };
  }
  if (error) return { error: "Gagal menambah mahasiswa. Coba lagi.", values };

  revalidatePath(`/dosen/kelas/${courseId}`);
  return { message: `${parsed.data.nama} ditambahkan.` };
}

export async function deleteStudentAction(courseId: string, studentId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("students").delete().eq("id", studentId).eq("course_id", courseId);
  if (error) throw new Error("Gagal menghapus mahasiswa.");
  revalidatePath(`/dosen/kelas/${courseId}`);
}
```

- [ ] **Step 6: Template CSV**

Create `public/template-mahasiswa.csv`:
```
nim,nama,email
2201001,Budi Santoso,budi.santoso@kampus.ac.id
2201002,Siti Aminah,siti.aminah@kampus.ac.id
```

- [ ] **Step 7: Komponen mahasiswa**

Create `src/components/students/import-students-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { importStudentsAction, type StudentImportState } from "@/lib/students/actions";

const MAX_SHOWN_ERRORS = 20;

export function ImportStudentsForm({ courseId }: { courseId: string }) {
  const [state, formAction] = useActionState<StudentImportState, FormData>(
    importStudentsAction.bind(null, courseId),
    {},
  );
  const rowErrors = state.rowErrors ?? [];

  return (
    <form action={formAction} className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 className="font-semibold text-slate-900">Import dari CSV</h3>
      <p className="text-sm text-slate-600">
        Kolom: <code>nim</code>, <code>nama</code>, <code>email</code>. Pemisah koma atau titik koma.{" "}
        <a href="/template-mahasiswa.csv" download className="font-medium text-indigo-600 hover:underline">
          Unduh template
        </a>
      </p>
      <FormAlert state={state} />
      {rowErrors.length > 0 && (
        <ul className="max-h-40 list-inside list-disc overflow-y-auto text-sm text-red-700">
          {rowErrors.slice(0, MAX_SHOWN_ERRORS).map((rowError) => (
            <li key={rowError.baris}>
              Baris {rowError.baris}: {rowError.pesan}
            </li>
          ))}
          {rowErrors.length > MAX_SHOWN_ERRORS && <li>dan {rowErrors.length - MAX_SHOWN_ERRORS} baris lainnya</li>}
        </ul>
      )}
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-indigo-700"
      />
      <SubmitButton pendingText="Mengimpor...">Import</SubmitButton>
    </form>
  );
}
```

Create `src/components/students/add-student-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { addStudentAction } from "@/lib/students/actions";
import type { FormState } from "@/lib/validation";

export function AddStudentForm({ courseId }: { courseId: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(addStudentAction.bind(null, courseId), {});

  return (
    <form action={formAction} className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 className="font-semibold text-slate-900">Tambah satu mahasiswa</h3>
      <FormAlert state={state} />
      <Field label="NIM" name="nim" defaultValue={state.values?.nim} error={state.fieldErrors?.nim} required />
      <Field label="Nama" name="nama" defaultValue={state.values?.nama} error={state.fieldErrors?.nama} required />
      <Field
        label="Email"
        name="email"
        type="email"
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
        required
      />
      <SubmitButton pendingText="Menyimpan...">Tambah</SubmitButton>
    </form>
  );
}
```

Create `src/components/students/delete-student-button.tsx`:
```tsx
"use client";

import { deleteStudentAction } from "@/lib/students/actions";

export function DeleteStudentButton({ courseId, studentId, nama }: { courseId: string; studentId: string; nama: string }) {
  return (
    <form
      action={deleteStudentAction.bind(null, courseId, studentId)}
      onSubmit={(event) => {
        if (!window.confirm(`Hapus ${nama} dari kelas ini?`)) event.preventDefault();
      }}
    >
      <button type="submit" className="text-sm text-red-600 hover:underline">
        Hapus
      </button>
    </form>
  );
}
```

Create `src/components/students/student-table.tsx`:
```tsx
import type { StudentRow } from "@/lib/db/types";
import { DeleteStudentButton } from "./delete-student-button";

export function StudentTable({ courseId, students }: { courseId: string; students: StudentRow[] }) {
  if (students.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Belum ada mahasiswa. Import CSV atau tambahkan satu per satu.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-2 font-medium">NIM</th>
            <th className="px-4 py-2 font-medium">Nama</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-800">
          {students.map((student) => (
            <tr key={student.id}>
              <td className="px-4 py-2 font-mono">{student.nim}</td>
              <td className="px-4 py-2">{student.nama}</td>
              <td className="px-4 py-2 text-slate-600">{student.email}</td>
              <td className="px-4 py-2 text-right">
                <DeleteStudentButton courseId={courseId} studentId={student.id} nama={student.nama} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Lengkapi halaman detail kelas**

Ganti seluruh isi `src/app/dosen/kelas/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddStudentForm } from "@/components/students/add-student-form";
import { ImportStudentsForm } from "@/components/students/import-students-form";
import { StudentTable } from "@/components/students/student-table";
import { getCourse } from "@/lib/courses/queries";
import { formatPeriod } from "@/lib/courses/validation";
import { listStudents } from "@/lib/students/queries";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await getCourse(id);
  if (!course) notFound();
  const students = await listStudents(course.id);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href="/dosen" className="text-sm text-indigo-600 hover:underline">
          ← Kelas saya
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">{course.nama}</h1>
        <p className="text-sm text-slate-600">
          {[course.kode_mk, formatPeriod(course.semester, course.tahun_ajaran)].filter(Boolean).join(" · ")}
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Mahasiswa ({students.length})</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ImportStudentsForm courseId={course.id} />
          <AddStudentForm courseId={course.id} />
        </div>
        <StudentTable courseId={course.id} students={students} />
      </section>
    </div>
  );
}
```

- [ ] **Step 9: Verifikasi**

Run: `npm test && npm run lint && npm run build`
Expected: semua sukses.

Manual (`npm run dev`, login sebagai dosen A, buka kelas):
1. Unduh template → import → tabel menampilkan 2 mahasiswa urut NIM; kartu di `/dosen` menunjukkan "2 mahasiswa".
2. Import CSV berpemisah `;` hasil "Save As CSV" Excel → berhasil.
3. Import CSV dengan satu email salah → daftar error per baris tampil, jumlah mahasiswa tidak berubah.
4. Import ulang template dengan nama diubah → nama diperbarui, tidak ada duplikat.
5. Tambah satu mahasiswa dengan NIM yang sudah ada → "NIM ini sudah terdaftar di kelas ini."
6. Hapus mahasiswa → muncul konfirmasi, lalu hilang dari tabel.
7. Daftar/masuk sebagai dosen B, buka URL kelas milik dosen A → 404.

- [ ] **Step 10: Commit**

```bash
git add src public
git commit -m "feat(students): import students from CSV, add and delete students" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Verifikasi Akhir Fase 1

- [ ] `npm test` — semua test lulus (env, validasi, CSV, auth, kelas, import file, skema/RLS).
- [ ] `npm run lint` dan `npm run build` sukses.
- [ ] Alur lengkap manual: daftar → konfirmasi email → buat kelas → import mahasiswa → tambah/hapus → keluar; dosen lain tidak bisa melihat kelas tersebut.
- [ ] `git status` bersih; perbarui tabel di `docs/superpowers/plans/2026-10-13-roadmap.md` (Fase 1 = selesai).
