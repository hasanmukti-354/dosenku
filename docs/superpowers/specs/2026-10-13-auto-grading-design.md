# Dosenku — Auto-Grading & Rekap Nilai (MVP) — Design Spec

Tanggal: 2026-10-13
Status: Disetujui saat brainstorming, menunggu review spec

## 1. Ringkasan

Dosenku adalah SaaS berbayar untuk dosen yang mengotomatiskan tugas administrasi.
MVP fokus pada satu alur: **mahasiswa mengumpulkan tugas → AI menilai berdasarkan
rubrik → dosen review & publish → nilai akhir terhitung otomatis → export Excel**.

Model bisnis: **bayar per kredit** (top-up via Xendit). 1 kredit = 1 submission
(individu atau kelompok) yang berhasil dinilai AI.

### Tujuan MVP
- Dosen dapat membuat kelas, import mahasiswa, membuat tugas dengan rubrik.
- Mahasiswa mengumpulkan tugas lewat link tanpa akun (NIM + OTP email).
- AI menilai esai/laporan, slide, jawaban hitungan, dan kode (review teks saja).
- Dosen wajib approve sebelum nilai terlihat mahasiswa.
- Gradebook berbobot + skala huruf + export Excel.
- Tugas individu dan tugas kelompok.

### Di luar MVP (fase 2+)
- Eksekusi test case untuk tugas kode (sandbox).
- OCR untuk PDF hasil scan.
- Peer assessment kontribusi anggota kelompok.
- Integrasi LMS (Google Classroom) / SIAKAD / PDDikti.
- Modul lain: presensi, RPS, berita acara, bank soal, BKD/angka kredit, bimbingan skripsi, pengumuman kelas.
- Level prodi/kampus (admin, multi-dosen per MK, kelas paralel terpusat).

## 2. Stack

- **Next.js** (App Router, TypeScript) di **Vercel**.
- **Supabase**: Postgres (+ Row-Level Security), Storage (file tugas), Auth (dosen: email+password / Google).
- **LLM** via klien OpenAI-compatible (provider dapat diganti lewat env), output JSON terstruktur.
- **Xendit** Invoice API untuk pembelian kredit.
- Email transaksional (OTP, notifikasi nilai) via provider email (mis. Resend).
- Testing: Vitest, Supabase lokal, Playwright.

## 3. Arsitektur

```
┌───────────── Next.js (Vercel) ─────────────┐
│  /dosen/*     dashboard dosen (Supabase Auth)
│  /t/[kode]    halaman mahasiswa (NIM + OTP email, tanpa akun)
│  /api/*       route handlers
└──────┬──────────────────────────┬──────────┘
       │                          │
  Supabase                   Grading worker
  ├ Postgres (+RLS per dosen) (Vercel Function dipicu antrean;
  ├ Storage (file tugas)       1 submission = 1 eksekusi)
  └ Auth (dosen)                   │
                                   ├ Ekstraktor teks (PDF/DOCX/PPTX/kode)
                                   └ AI client (JSON per kriteria)
  Xendit ──webhook invoice.paid──▶ /api/billing/xendit-webhook
```

### Unit

| Unit | Tanggung jawab |
|---|---|
| `courses` | Kelas, daftar mahasiswa (import CSV: nim, nama, email) |
| `assignments` | Tugas, deadline, tipe, mode individu/kelompok, rubrik, kunci jawaban opsional |
| `groups` | Kelompok per tugas: import CSV, manual, atau acak ukuran N |
| `submissions` | Upload mahasiswa/kelompok, versi, status keterlambatan |
| `extraction` | File → teks (PDF, DOCX, PPTX, file kode sebagai teks) |
| `grading` | Teks + rubrik → skor per kriteria, alasan, feedback, flag |
| `similarity` | Cek kemiripan antar submission dalam satu tugas (shingling n-gram) |
| `review` | Dosen edit/approve/publish draf nilai |
| `gradebook` | Komponen berbobot, nilai manual (UTS/UAS), skala huruf, export Excel |
| `credits` | Saldo, ledger, konsumsi per penilaian, top-up |
| `billing` | Integrasi Xendit Invoice + webhook |
| `student-auth` | OTP email untuk mahasiswa berbasis NIM terdaftar |

Setiap unit berupa modul di `src/lib/<unit>/` dengan fungsi murni dipisahkan dari akses DB/IO agar mudah diuji.

### Aturan inti
1. Kredit dipotong **hanya** saat penilaian AI sukses; gagal → tidak dipotong.
2. Nilai **tidak pernah** terlihat mahasiswa sebelum dosen publish.
3. Semua data dosen terisolasi via RLS (`lecturer_id`).
4. Teks submission selalu diperlakukan sebagai data, bukan instruksi bagi AI.

## 4. Model Data (Postgres)

```
lecturers            id (= auth.users.id), nama, institusi, credit_balance int >= 0
courses              id, lecturer_id, nama, kode_mk, semester, tahun_ajaran
students             id, course_id, nim, nama, email        UNIQUE(course_id, nim)
assignments          id, course_id, judul, instruksi,
                     tipe (esai|kode|hitungan|slide), mode (individu|kelompok),
                     deadline, terima_terlambat bool, penalti_terlambat_persen,
                     kode_akses UNIQUE, kunci_jawaban text NULL,
                     gradebook_component_id, auto_grade_after_deadline bool
rubric_criteria      id, assignment_id, nama, bobot, deskripsi,
                     level_deskriptor jsonb   -- [{skor, deskripsi}]
groups               id, assignment_id, nama
group_members        group_id, student_id, assignment_id
                     UNIQUE(assignment_id, student_id)
submissions          id, assignment_id, submitter_student_id, group_id NULL,
                     file_path, file_type, extracted_text NULL,
                     submitted_at, terlambat bool, versi int,
                     status (diterima|antre|menilai|siap_review|gagal|dipublish),
                     alasan_gagal NULL, is_latest bool
grades               id, submission_id UNIQUE, sumber (ai|manual),
                     skor_per_kriteria jsonb, skor_total numeric, feedback text,
                     perlu_perhatian bool, alasan_flag text[],
                     penyesuaian_individu jsonb  -- {student_id: {delta, alasan}}
                     approved_at, published_at, updated_at
gradebook_components id, course_id, nama, bobot_persen
manual_scores        id, component_id, student_id, skor   UNIQUE(component_id, student_id)
grade_scale          id, course_id, huruf, min_skor
credit_ledger        id, lecturer_id, delta int, alasan (topup|grading|refund|bonus),
                     ref_id, created_at
payments             id, lecturer_id, xendit_invoice_id, external_id UNIQUE,
                     paket, jumlah_kredit, nominal, status (pending|paid|expired)
otp_codes            id, email, kode_hash, expires_at, attempts, used_at
```

### Catatan
- `credit_balance` hanya diubah lewat fungsi Postgres `consume_credit(lecturer_id, ref_id)`
  dan `add_credit(lecturer_id, delta, alasan, ref_id)` yang menulis ledger dalam transaksi
  yang sama. `consume_credit` gagal jika saldo 0.
- Submission ulang membuat baris baru dengan `versi+1` dan `is_latest=true` (versi lama di-set false).
  Untuk tugas kelompok, versi dihitung per `group_id`.
- Skor tugas kelompok untuk tiap anggota = `skor_total + penyesuaian_individu[student_id].delta` (dibatasi 0–100).
- Skala huruf default: A≥85, AB≥80, B≥70, BC≥65, C≥60, D≥50, E<50 (dapat diubah per kelas).

### RLS
- Tabel milik dosen: akses hanya jika `lecturer_id = auth.uid()` (langsung atau via join ke `courses`).
- Endpoint mahasiswa memakai service role di server, dengan aksi sempit:
  upload untuk dirinya/kelompoknya, lihat status & nilai miliknya yang sudah dipublish.
  Sesi mahasiswa = cookie bertanda tangan berisi `{student_id, assignment_id}` setelah OTP valid.

## 5. Alur Utama

### 5.1 Pengumpulan (mahasiswa)
1. Buka `/t/[kode_akses]`, masukkan NIM.
2. Jika NIM terdaftar di kelas: OTP 6 digit dikirim ke email terdaftar (berlaku 10 menit, maks 5 percobaan, rate limit kirim 1/menit).
3. Setelah OTP valid: tampil info tugas (dan kelompok + anggota bila mode kelompok), status, upload.
4. Validasi file: tipe sesuai `tipe` tugas, ≤ 20 MB. Simpan ke Storage `submissions/{assignment_id}/{owner_id}/{versi}`.
5. Status `diterima`; `terlambat=true` jika lewat deadline (ditolak jika `terima_terlambat=false`).

### 5.2 Penilaian
1. Dipicu oleh dosen ("Nilai semua yang belum dinilai") atau cron setelah deadline jika `auto_grade_after_deadline`.
2. Cek saldo ≥ jumlah submission `is_latest` yang belum dinilai. Jika kurang: tawarkan top-up atau nilai sebagian (urut waktu submit).
3. Set status `antre`. Worker mengambil job dengan `FOR UPDATE SKIP LOCKED`, konkurensi maks 5.
4. Ekstraksi teks → simpan `extracted_text`. Teks kosong → `gagal` ("tidak ada teks, kemungkinan PDF scan").
5. Panggil AI dengan: instruksi tugas, rubrik, kunci jawaban (bila ada), teks submission dibungkus delimiter dan ditandai sebagai data.
6. Validasi output terhadap skema (semua kriteria ada, skor dalam rentang level). Tidak valid → retry 1x.
7. Hitung `skor_total` = Σ(skor_kriteria/skor_maks_kriteria × bobot) dinormalisasi ke 0–100, lalu terapkan penalti terlambat.
8. Dalam satu transaksi: simpan `grades` (sumber=ai) + `consume_credit`. Status `siap_review`.

### 5.3 Flag "perlu perhatian"
- Teks sangat pendek (< 50 kata untuk esai) atau dinilai AI tidak relevan dengan instruksi.
- Kemiripan Jaccard shingle ≥ 0.6 dengan submission lain di tugas yang sama (dihitung setelah batch).
- Indikasi prompt injection terdeteksi AI di teks submission.
Flag tidak mengubah skor; hanya ditampilkan ke dosen.

### 5.4 Review & publish
- Layar review: preview file kiri, skor per kriteria + alasan AI + feedback kanan, dapat diedit; navigasi next/prev; filter "perlu perhatian".
- Approve satu per satu atau massal; Publish → `published_at`, status `dipublish`, email notifikasi ke mahasiswa (semua anggota kelompok).
- Untuk kelompok: dosen dapat menambah penyesuaian per anggota (delta + alasan).
- Edit setelah publish diizinkan; `updated_at` diperbarui dan mahasiswa diberi notifikasi perubahan.
- Submission `gagal` atau tanpa kredit dapat dinilai manual (sumber=manual, tanpa kredit).

### 5.5 Gradebook
- Komponen + bobot (validasi total = 100%), skala huruf per kelas.
- Nilai komponen tugas = rata-rata skor tugas yang dipublish dalam komponen tersebut; mahasiswa yang tidak mengumpulkan = 0 dan ditandai.
- Nilai manual (UTS/UAS/kuis) diinput di tabel atau import Excel (NIM, skor).
- Nilai akhir = Σ(nilai_komponen × bobot/100), dibulatkan 2 desimal, dikonversi ke huruf.
- Export `.xlsx`: NIM, Nama, kolom per komponen, Nilai Akhir, Huruf.

### 5.6 Kredit & pembayaran (Xendit)
- Halaman `/dosen/kredit`: saldo, riwayat ledger, pilihan paket (dikonfigurasi di kode, mis. 50/200/500 kredit).
- Beli → buat `payments` (pending, `external_id` unik) → Xendit Create Invoice → redirect ke `invoice_url`.
- Webhook `/api/billing/xendit-webhook`: verifikasi header `x-callback-token`; jika status PAID dan payment masih pending → `add_credit` + set paid (idempotent via `external_id`); EXPIRED → set expired.
- Dosen baru mendapat bonus kredit awal (mis. 10) via ledger `bonus`.

## 6. Halaman

| Route | Isi |
|---|---|
| `/` | Landing page + harga |
| `/masuk`, `/daftar` | Auth dosen (Supabase) |
| `/dosen` | Ringkasan: saldo, tugas menunggu review, deadline terdekat |
| `/dosen/kelas/[id]` | Tab Mahasiswa (import CSV), Tugas, Gradebook |
| `/dosen/tugas/baru` | Form tugas, editor rubrik (opsi "buatkan rubrik dengan AI", gratis, rate-limited), mode & pengaturan kelompok |
| `/dosen/tugas/[id]` | Daftar submission & status, "Nilai semua", link + QR pengumpulan |
| `/dosen/tugas/[id]/review/[submissionId]` | Layar review |
| `/dosen/kredit` | Saldo, ledger, beli paket |
| `/t/[kode]` | Mahasiswa: login NIM+OTP, upload/status, lihat nilai & feedback |

## 7. Penanganan Error

| Kasus | Perilaku |
|---|---|
| AI timeout/error | Retry 2x dengan backoff; tetap gagal → `gagal`, kredit tidak dipotong |
| Output AI tidak valid | Retry 1x; tetap gagal → `gagal` |
| File rusak / format tak didukung / teks kosong | `gagal` + alasan, tanpa potong kredit |
| Saldo habis di tengah batch | Sisa job kembali ke `diterima`, dosen diberi tahu |
| Webhook Xendit ganda / token salah | Idempotent via `external_id`; token salah → 401 |
| NIM tidak terdaftar | Pesan generik "NIM tidak terdaftar di kelas ini", tanpa kirim OTP |
| OTP salah berulang | Kunci setelah 5 percobaan, minta OTP baru |

## 8. Testing

- **Unit (Vitest):** kalkulasi skor rubrik, penalti terlambat, gradebook & konversi huruf, penyesuaian individu kelompok, validasi skema output AI, similarity shingling, pembentukan kelompok acak.
- **Integration (Supabase lokal):** RLS antar dosen, `consume_credit`/`add_credit` (tak bisa minus, ledger konsisten), idempotensi webhook Xendit, alur OTP mahasiswa.
- **AI di-mock** dalam test otomatis; set kecil *golden submissions* (contoh dengan nilai dosen asli) untuk evaluasi manual saat prompt berubah.
- **E2E (Playwright):** buat kelas & tugas → mahasiswa upload → nilai → review → publish → mahasiswa melihat nilai; plus satu skenario tugas kelompok.
