# MediQueue — Hospital Appointment & Queue System

A full-stack hospital appointment management platform with a real-time queue
board for clinic staff. Built with **Node.js + Express + Socket.IO** on the
backend and **React (Vite) + plain CSS** on the frontend, backed by
**PostgreSQL**.

> **Status of this build:** The **Staff Perspective** is fully implemented —
> live schedule with current-time delimiter, kanban board, all card actions,
> the push-down collision shifter, locking rules, doctor–staff chat, search,
> end-of-day summary, and dashboard. The Patient, Doctor and Admin perspectives
> reuse the same database schema and will be added in subsequent iterations.

---

## 1. Prerequisites

| Tool       | Version           |
| ---------- | ----------------- |
| Node.js    | ≥ 18              |
| npm        | ≥ 9               |
| PostgreSQL | ≥ 14 (with `pgcrypto` extension available) |

You should already have a database called `mediqueue_db` created in pgAdmin
with the schema from `hospital_appointment_schema.sql` applied to it.

---

## 2. Project layout

```
mediqueue/
├── backend/                  Node.js + Express API + Socket.IO
│   ├── scripts/seed.js       Demo data: doctors, staff, today's appointments
│   ├── src/
│   │   ├── config/db.js      pg pool
│   │   ├── controllers/      authController, staffController
│   │   ├── middleware/       auth (JWT + roles), errorHandler
│   │   ├── routes/           authRoutes, staffRoutes
│   │   ├── services/         queueService — the core business logic
│   │   ├── sockets/          io.js (singleton), init.js (server)
│   │   ├── utils/            time helpers, audit logger
│   │   └── server.js         entry point
│   └── .env.example          → copy to .env and fill in your password
└── frontend/                 React (Vite) SPA
    ├── index.html
    ├── vite.config.js        proxies /api and /socket.io to :5000
    └── src/
        ├── api/              axios client + socket.io client
        ├── components/       Modal, TopBar, ReferenceSidebar,
        │                     LiveTimeline, KanbanBoard, ChatPanel,
        │                     SearchPanel, EndOfDayPanel,
        │                     UpdateTimesModal
        ├── context/          AuthContext
        ├── pages/            LoginPage, StaffWorkspace
        ├── styles/           global.css, staff.css
        ├── utils/time.js     timeline math
        ├── App.jsx           router + role guard
        └── main.jsx          entry
```

---

## 3. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Open `backend/.env` and **fill in your PostgreSQL password**:

```dotenv
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=<your password here>
PGDATABASE=mediqueue_db

PORT=5000
JWT_SECRET=mediqueue_super_secret_dev_key_change_me_in_production
JWT_EXPIRES_IN=12h
CLIENT_URL=http://localhost:5173
```

Seed demo data (creates departments, two doctors, a staff account, six
patients, and today's appointments in mixed kanban states):

```bash
npm run seed
```

Run the dev server:

```bash
npm run dev    # nodemon, auto-restart
# or
npm start
```

The API listens on **`http://localhost:5000`**. Quick health check:

```bash
curl http://localhost:5000/api/health
```

---

## 4. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

The app is now at **`http://localhost:5173`**. Vite proxies `/api/*` and
`/socket.io/*` to the backend automatically — no extra config needed.

---

## 5. Demo credentials

After running `npm run seed`, the password for **all** demo accounts is
`password123`.

| Role   | Email                       | Notes                          |
| ------ | --------------------------- | ------------------------------ |
| Staff  | `maria@mediqueue.test`      | Maria Haddad (receptionist)    |
| Doctor | `khalil@mediqueue.test`     | Dr. Sami Khalil — Cardiology   |
| Doctor | `mansour@mediqueue.test`    | Dr. Omar Mansour — General Med |
| Admin  | `admin@mediqueue.test`      |                                |

The login page pre-fills Maria's credentials. Only the Staff dashboard is wired
up in this build — logging in as a doctor/admin/patient currently routes you
back to the login page.

---

## 6. Staff perspective — feature tour

After logging in as Maria, you land on the live workspace.

### Top bar
- Brand + nav tabs.
- User menu with avatar + logout.

### Selector strip
- **Doctor** dropdown — pick which doctor's board you're managing.
- **Date** picker — view today, the past, or upcoming days.
- **Search** — open a modal to find a patient/appointment by name, phone, or ID.
- **Apply delay** — propagate a global delay (e.g., doctor running 15 min late)
  to every still-pending entry for the selected doctor.
- **End-of-day** — operational summary modal.
- **Refresh** — manual refetch.

### Side dashboard (left column)
- Per-doctor status (in consultation / waiting / on schedule / idle).
- Waiting room totals across all doctors (early / late counts).
- Queue load indicator (Normal / High load).
- Alerts for patients waiting > 40 minutes.

### Reference Schedule (column 1 of the board)
Read-only view of the *original* scheduled order. Each row has a colored dot:
past (grey), current (indigo), future (green), late (red), completed (green).

### Live Timeline (column 2)
The visual centerpiece.
- Hour rows (1 minute = 1 px).
- A live **NOW** delimiter that ticks every 30 seconds.
- Doctor-unavailability blocks rendered as red striped bands.
- Cards positioned by `max(scheduled_start, now)` for non-active entries
  (per the spec — pending cards cannot remain stranded before now).
- In-consultation cards extend from their actual start time to the current time.
- Completed cards stay where they actually happened.
- Late-tagged cards get a red border accent.
- **Double-click** any pending/active card to open the **Update Times** modal,
  which triggers the push-down collision shifter on the backend.

### Kanban board (column 3)
Four primary columns plus two terminal trays:
- **Upcoming** — has *Check-in* and *No-show* actions on grey, dashed cards.
- **Waiting Room** — colored cards with arrival tag (early/on-time/late).
  After *Add to Live Schedule*, the card gains an "On live #N" badge and the
  *Admit* / *Action Required* / *Reject* buttons appear.
- **In Consultation** — locked start time, *Complete Visit* action.
- **Completed** — locked entirely (both times locked).
- **Rejected** + **No-show** trays at the bottom.

### Card actions
Every action triggers a server-side `audit_logs` entry attributable to the
logged-in staff member.

| Action            | Effect |
| ----------------- | ------ |
| Check-in          | Computes arrival tag (early/on-time/late) and moves card to Waiting Room. |
| Add to Live       | Validates the patient and assigns a queue position. |
| Admit             | Modal asks for actual start time + room. Locks the start time. |
| Complete Visit    | Modal asks for end time + optional notes. Locks both times. Marks the appointment `completed`. |
| Reject            | Modal with reason picker (clinic full / doctor unavailable / too late / other). Sends a push notification to the patient and cancels the appointment. |
| Action Required   | Sends a pre-written push notification (too late / too early / schedule disturbance). |
| No-show           | Marks the appointment `no_show`. |
| Update Times      | Updates one entry's scheduled times and pushes down any later overlapping entries. Respects locking rules. Validates against doctor blocked intervals. |

### Doctor–staff chat (floating panel, bottom-right)
- One channel per doctor per day.
- Real-time delivery via Socket.IO (`chat:new` events).
- Quick-action buttons for "Running Late", "Ready for Next", "Pause Queue",
  "Resume Queue".
- Short text only; no attachments; no medical info.

### Search
Look up by **patient name**, **phone**, or **appointment ID**, optionally
scoped to a date. Results show only operational data (status, arrival, doctor,
time) — never medical records.

### End-of-day summary
Counts of total appointments / completed / late / no-shows / rejected, plus
the average waiting time computed from `(admitted_at − arrived_at)`.

---

## 7. How the live timeline math works

The most subtle part of the spec is the visible-start rule. The server stores
`scheduled_start_time` and `actual_start_time` independently; the *visible*
position of a card is computed on the client as:

```
visibleStart =
  - actual_start_time              if completed or in_consultation
  - max(scheduled_start_time, now) otherwise
```

This guarantees the rule from the spec: *“completed cards stay where they
happened, in-consultation cards may begin in the past and extend to now, but
waiting/scheduled cards cannot remain stranded before now.”*

The push-down collision shifter on the server walks all later non-locked
entries in scheduled order: for each one whose start falls before the
preceding entry's end, it shifts that entry (and its end) forward by exactly
the overlap. Locked entries (`in_consultation`, `completed`) are never touched.

---

## 8. Real-time updates

Whenever any staff action changes the board, the controller emits
`board:update` to the room `board:<doctorId>:<date>`. The client subscribes to
this room on mount and refetches the board on every event, so multiple staff
members can manage the same doctor's board concurrently and stay in sync.

If sockets fail to connect, the client falls back to a 30-second polling loop
while the page is showing today's date, so things still work over a flaky
connection.

---

## 9. API surface (staff routes)

All staff routes live under `/api/staff/*` and require a Bearer JWT issued to
a user with `role = 'staff'`.

| Method | Path                                      | Description |
| ------ | ----------------------------------------- | ----------- |
| GET    | `/staff/doctors`                          | List active doctors for the selector. |
| GET    | `/staff/dashboard?date=YYYY-MM-DD`        | Sidebar summary. |
| GET    | `/staff/board/:doctorId?date=YYYY-MM-DD`  | Full board (entries, doctor info, working hours, blocked intervals). |
| POST   | `/staff/entries/:entryId/check-in`        | Manual check-in. |
| POST   | `/staff/entries/:entryId/add-to-live`     | Validate into live queue. |
| POST   | `/staff/entries/:entryId/admit`           | Body: `{ startTime }`. |
| POST   | `/staff/entries/:entryId/complete`        | Body: `{ endTime, notes? }`. |
| POST   | `/staff/entries/:entryId/reject`          | Body: `{ reason }`. |
| POST   | `/staff/entries/:entryId/no-show`         | |
| POST   | `/staff/entries/:entryId/update-times`    | Body: `{ startTime, endTime }`. Triggers push-down. |
| POST   | `/staff/entries/:entryId/action-required` | Body: `{ reason }`. Sends notification. |
| POST   | `/staff/board/:doctorId/global-delay`     | Body: `{ delayMinutes, date }`. |
| GET    | `/staff/search?q=&date=`                  | Operational search. |
| GET    | `/staff/chat/:doctorId?date=`             | Chat history. |
| POST   | `/staff/chat/:doctorId`                   | Body: `{ message, quickAction? }`. |
| GET    | `/staff/end-of-day?date=`                 | Day summary. |

---

## 10. Troubleshooting

**`❌ Failed to connect to PostgreSQL`** on backend start
→ Check your `backend/.env` values, especially `PGPASSWORD`. Make sure the
`mediqueue_db` database exists and the schema has been applied.

**`relation "users" does not exist`** when running the seed
→ The schema hasn't been applied yet. Run the `hospital_appointment_schema.sql`
file in pgAdmin against `mediqueue_db` first, then `npm run seed`.

**Login works but the board is empty**
→ Make sure you ran `npm run seed` and that the `Date` selector at the top of
the board is set to **today**. The seed only generates today's appointments.

**Socket disconnections / no real-time updates**
→ The 30-second polling fallback will keep the board fresh anyway, but check
your browser console for `socket.io` errors. The Vite dev server proxies
`/socket.io` automatically — if you change the backend port, update
`vite.config.js` too.

**“Start time cannot be in the future”** when admitting
→ The server enforces that admitted-at times are not in the future and not
before the latest completed visit. Pick a valid time in the modal.

---

## 11. Next steps

The same backend infrastructure (auth, DB, queue service, audit logging,
sockets) will support the remaining three perspectives in later iterations:

- **Patient** — registration, doctor browsing, slot booking with reservation
  hold, online payment, cancellation policy, follow-up rules, live status
  tracker.
- **Doctor** — own dashboard, schedule management, day-off controls, fee
  configuration, profile, consultation notes, prescriptions, follow-up
  recommendations, chat panel mirror.
- **Admin** — department + doctor + staff CRUD, system-wide reports.

Each will plug into the existing schema without changes.
