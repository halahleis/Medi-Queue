import { useEffect, useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';
import { getSocket, disconnectSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import { todayStr } from '../utils/time';

import TopBar from '../components/TopBar.jsx';
import ReferenceSidebar from '../components/ReferenceSidebar.jsx';
import LiveTimeline from '../components/LiveTimeline.jsx';
import KanbanBoard from '../components/KanbanBoard.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import SearchPanel from '../components/SearchPanel.jsx';
import EndOfDayPanel from '../components/EndOfDayPanel.jsx';
import Modal from '../components/Modal.jsx';

export default function StaffWorkspace() {
  const { logout } = useAuth();

  // ------- top-of-page selectors -------
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState(null);
  const [date, setDate] = useState(todayStr());

  // ------- main board data -------
  const [board, setBoard] = useState(null);   // { entries, doctor, workingHours, blockedIntervals }
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);

  // ------- modals -------
  const [searchOpen, setSearchOpen] = useState(false);
  const [eodOpen, setEodOpen] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);

  const isToday = date === todayStr();

  /* ---------- load doctors once ---------- */
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/staff/doctors');
        setDoctors(data.doctors || []);
        if (data.doctors?.length && !doctorId) {
          setDoctorId(data.doctors[0].id);
        }
      } catch (err) {
        // 401 → axios interceptor handles auto-logout. Other errors:
        if (err.response?.status !== 401) {
          toast.error(err.displayMessage || 'Could not load doctors.');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- fetch board + dashboard whenever doctor or date changes ---------- */
  const fetchAll = useCallback(async () => {
    if (!doctorId) return;
    setLoading(true);
    try {
      const [boardRes, dashRes] = await Promise.all([
        api.get(`/staff/board/${doctorId}`, { params: { date } }),
        api.get('/staff/dashboard', { params: { date } }),
      ]);
      setBoard(boardRes.data);
      setDashboard(dashRes.data);
    } catch (err) {
      if (err.response?.status !== 401) {
        toast.error(err.displayMessage || 'Could not load board.');
      }
    } finally {
      setLoading(false);
    }
  }, [doctorId, date]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ---------- socket: subscribe to live board updates ---------- */
  // Track current subscription so we can cleanly unsubscribe on change.
  const subRef = useRef({ doctorId: null, date: null });

  useEffect(() => {
    const sock = getSocket();
    if (!sock || !doctorId) return;

    // Unsubscribe from previous room if any.
    if (subRef.current.doctorId && subRef.current.date) {
      sock.emit('board:unsubscribe', subRef.current);
    }

    sock.emit('board:subscribe', { doctorId, date });
    subRef.current = { doctorId, date };

    const handler = (payload) => {
      if (payload.doctorId === doctorId && payload.date === date) {
        fetchAll();
      }
    };
    sock.on('board:update', handler);

    return () => {
      sock.off('board:update', handler);
      sock.emit('board:unsubscribe', { doctorId, date });
    };
  }, [doctorId, date, fetchAll]);

  /* ---------- light auto-refresh fallback so the NOW line/data stays fresh ---------- */
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(fetchAll, 30 * 1000);
    return () => clearInterval(id);
  }, [isToday, fetchAll]);

  /* ---------- disconnect socket on full logout ---------- */
  useEffect(() => () => disconnectSocket(), []);

  /* ---------- update times handler (passed to LiveTimeline) ---------- */
  const handleTimesUpdate = async (entryId, startTime, endTime) => {
    await api.post(`/staff/entries/${entryId}/update-times`, { startTime, endTime });
    await fetchAll();
  };

  /* ---------- global delay handler ---------- */
  const handleGlobalDelay = async (minutes) => {
    if (!doctorId) return;
    try {
      await api.post(`/staff/board/${doctorId}/global-delay`, {
        delayMinutes: minutes,
        date,
      });
      toast.success(`Shifted upcoming patients by ${minutes} min.`);
      setDelayOpen(false);
      await fetchAll();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not apply delay.');
    }
  };

  const currentDoctor = doctors.find((d) => d.id === doctorId);

  return (
    <div className="app-shell">
      <TopBar
        tabs={[{ key: 'board', label: 'Live Board' }]}
        activeTab="board"
        onTabChange={() => {}}
      />

      {/* Selector + actions bar */}
      <div className="staff-page" style={{ paddingBottom: 0 }}>
        <div />{/* sidebar gutter */}
        <div className="selector-bar">
          <div>
            <label className="label" style={{ marginBottom: 2 }}>Doctor</label>
            <select
              className="select"
              value={doctorId || ''}
              onChange={(e) => setDoctorId(e.target.value)}
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} — {d.specialty}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" style={{ marginBottom: 2 }}>Date</label>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="spacer" />

          <button className="btn btn-outline btn-sm" onClick={() => setSearchOpen(true)}>
            🔍 Search
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setDelayOpen(true)}>
            ⏱ Apply delay
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setEodOpen(true)}>
            📊 End-of-day
          </button>
          <button className="btn btn-outline btn-sm" onClick={fetchAll}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Main grid: side dashboard + 3-col board */}
      <div className="staff-page" style={{ paddingTop: 0 }}>
        <SidePanel dashboard={dashboard} doctorId={doctorId} />

        <div className="workarea">
          {loading && !board && <div className="empty">Loading board…</div>}

          {board && (
            <>
              {/* Doctor header card */}
              <div className="card" style={{ padding: '14px 18px' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="bold tight" style={{ fontSize: 16 }}>
                      {board.doctor?.full_name}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {board.doctor?.specialty} · {board.doctor?.department_name || '—'}
                      {board.workingHours?.length > 0 && (
                        <>
                          {' · Working hours: '}
                          {board.workingHours
                            .map((w) => `${w.start_time.slice(0, 5)}–${w.end_time.slice(0, 5)}`)
                            .join(', ')}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {board.entries.length} appointments today
                  </div>
                </div>
              </div>

              {/* The big 3-column board */}
              <div className="board">
                <ReferenceSidebar
                  entries={board.entries}
                  nowMin={isToday ? minutesNow() : 0}
                />
                <LiveTimeline
                  entries={board.entries}
                  workingHours={board.workingHours}
                  blockedIntervals={board.blockedIntervals}
                  onTimesUpdate={handleTimesUpdate}
                  onCardClick={() => {}}
                  isToday={isToday}
                />
                <KanbanBoard entries={board.entries} onChange={fetchAll} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating chat */}
      {doctorId && currentDoctor && (
        <ChatPanel
          doctorId={doctorId}
          doctorName={currentDoctor.full_name}
          date={date}
        />
      )}

      {/* Modals */}
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
      <EndOfDayPanel open={eodOpen} onClose={() => setEodOpen(false)} date={date} />
      <DelayModal
        open={delayOpen}
        onClose={() => setDelayOpen(false)}
        onApply={handleGlobalDelay}
      />
    </div>
  );
}

/* --------------------------------- Side panel --------------------------------- */
function SidePanel({ dashboard, doctorId }) {
  if (!dashboard) {
    return (
      <aside className="side">
        <div className="side-card empty">Loading dashboard…</div>
      </aside>
    );
  }

  const wr = dashboard.waitingRoom || {};
  const docState = dashboard.doctors?.find((d) => d.id === doctorId);

  return (
    <aside className="side">
      <div className="side-card">
        <h3>Doctor status</h3>
        {dashboard.doctors?.length === 0 && <div className="empty">No active doctors.</div>}
        {dashboard.doctors?.map((d) => (
          <div key={d.id} className="side-stat">
            <span className="label">{d.full_name}</span>
            <span className="value">
              {Number(d.in_consult) > 0
                ? <span className="badge badge-success">In consult</span>
                : Number(d.waiting) > 0
                ? <span className="badge badge-info">{d.waiting} waiting</span>
                : Number(d.upcoming) > 0
                ? <span className="badge badge-muted">On schedule</span>
                : <span className="badge badge-muted">Idle</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="side-card">
        <h3>Waiting room (all doctors)</h3>
        <div className="side-stat">
          <span className="label">Patients waiting</span>
          <span className="value">{wr.waiting_total || 0}</span>
        </div>
        <div className="side-stat">
          <span className="label">Early arrivals</span>
          <span className="value">{wr.early || 0}</span>
        </div>
        <div className="side-stat">
          <span className="label">Late arrivals</span>
          <span className="value">{wr.late || 0}</span>
        </div>
      </div>

      <div className="side-card">
        <h3>Queue load</h3>
        {Number(wr.waiting_total) > 6 ? (
          <div className="badge badge-warning">⚠ High load – risk of overrun</div>
        ) : (
          <div className="badge badge-success">Normal</div>
        )}
        {docState && Number(docState.waiting) > 0 && Number(docState.in_consult) === 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {docState.waiting} patient(s) waiting for {docState.full_name}.
          </div>
        )}
      </div>

      {dashboard.alerts?.length > 0 && (
        <div className="side-card">
          <h3>Alerts</h3>
          {dashboard.alerts.map((a) => (
            <div key={a.id} className="alert-row">
              <span>⚠</span>
              <span>
                <strong>{a.patient_name}</strong> waiting {Math.round(a.waiting_minutes)} min.
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

/* --------------------------------- Delay modal --------------------------------- */
function DelayModal({ open, onClose, onApply }) {
  const [minutes, setMinutes] = useState(10);

  useEffect(() => {
    if (open) setMinutes(10);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply global delay"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onApply(minutes)}>
            Shift upcoming patients by {minutes}m
          </button>
        </>
      }
    >
      <div className="col">
        <div>
          <label className="label">Minutes to delay</label>
          <input
            className="input"
            type="number"
            min={1}
            max={180}
            value={minutes}
            onChange={(e) => setMinutes(parseInt(e.target.value, 10) || 0)}
          />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          All upcoming and waiting (not-yet-admitted) entries for this doctor on this date will
          shift forward by this many minutes. In-consultation and completed entries are not
          affected.
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------- helper --------------------------------- */
function minutesNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
