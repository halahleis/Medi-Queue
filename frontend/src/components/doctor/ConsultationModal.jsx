import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import Modal from '../Modal.jsx';

/**
 * The doctor's consultation drawer.
 * Shows: patient profile, recent visit history with this doctor,
 * editable consultation notes, prescriptions, and (when applicable) a
 * Complete Visit button.
 */
export default function ConsultationModal({ entry, onClose, onCompleted }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Editable consultation form state.
  const [form, setForm] = useState({
    symptoms: '', diagnosis: '', treatmentPlan: '', recommendations: '',
    followupRecommended: false, followupByDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Prescription state
  const [rxForm, setRxForm] = useState({ medicationName: '', dosage: '', instructions: '', validUntil: '' });
  const [rxBusy, setRxBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/doctor/appointments/${entry.appointment_id}/patient`);
      setData(data);
      const c = data.consultation;
      if (c) {
        setForm({
          symptoms: c.symptoms || '',
          diagnosis: c.diagnosis || '',
          treatmentPlan: c.treatment_plan || '',
          recommendations: c.recommendations || '',
          followupRecommended: !!c.followup_recommended,
          followupByDate: c.followup_by_date || '',
        });
      } else {
        setForm({
          symptoms: '', diagnosis: '', treatmentPlan: '', recommendations: '',
          followupRecommended: false, followupByDate: '',
        });
      }
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load patient info.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (entry) load(); /* eslint-disable-next-line */ }, [entry?.id]);

  if (!entry) return null;

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const saveNotes = async () => {
    if (form.followupRecommended && !form.followupByDate) {
      toast.error('Please specify a follow-up date.');
      return;
    }
    setSaving(true);
    try {
      const { data: out } = await api.post(
        `/doctor/appointments/${entry.appointment_id}/consultation`,
        form
      );
      toast.success('Consultation saved.');
      // Reload to pull the prescription list (consultation_id may have just been created).
      await load();
      return out.consultationId;
    } catch (err) {
      toast.error(err.displayMessage || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const addPrescription = async () => {
    if (!rxForm.medicationName.trim() || !rxForm.dosage.trim()) {
      toast.error('Medication name and dosage are required.');
      return;
    }
    // Make sure a consultation record exists first.
    let consId = data?.consultation?.id;
    if (!consId) {
      consId = await saveNotes();
      if (!consId) return;
    }
    setRxBusy(true);
    try {
      await api.post(`/doctor/consultations/${consId}/prescriptions`, rxForm);
      setRxForm({ medicationName: '', dosage: '', instructions: '', validUntil: '' });
      toast.success('Prescription added.');
      await load();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not add prescription.');
    } finally {
      setRxBusy(false);
    }
  };

  const removePrescription = async (id) => {
    try {
      await api.delete(`/doctor/prescriptions/${id}`);
      await load();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not remove prescription.');
    }
  };

  const completeVisit = async () => {
    // Save notes first so nothing is lost.
    await saveNotes();
    setCompleting(true);
    try {
      await api.post(`/doctor/entries/${entry.id}/complete`, { notes: form.diagnosis || null });
      toast.success('Visit completed.');
      onCompleted?.();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not complete visit.');
    } finally {
      setCompleting(false);
    }
  };

  const isInConsult = entry.kanban_status === 'in_consultation';
  const isCompleted = entry.kanban_status === 'completed';

  return (
    <Modal
      open
      onClose={onClose}
      title={`${data?.profile?.full_name || entry.patient_name} — visit details`}
      width={840}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {!isCompleted && (
            <button className="btn btn-outline" disabled={saving} onClick={saveNotes}>
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          )}
          {isInConsult && (
            <button className="btn btn-primary" disabled={completing} onClick={completeVisit}>
              {completing ? 'Completing…' : 'Complete visit'}
            </button>
          )}
        </>
      }
    >
      {loading || !data ? (
        <div className="empty">Loading patient info…</div>
      ) : (
        <div className="consult-grid">
          {/* Left column: patient profile + history */}
          <div>
            <div className="profile-section">
              <h4>Contact</h4>
              <dl>
                <dt>Email</dt><dd>{data.profile?.email || '—'}</dd>
                <dt>Phone</dt><dd>{data.profile?.phone || '—'}</dd>
                <dt>Blood type</dt><dd>{data.profile?.blood_type || '—'}</dd>
              </dl>
            </div>

            <div className="profile-section">
              <h4>Medical info</h4>
              <dl>
                <dt>Allergies</dt>
                <dd>{data.profile?.allergies || '—'}</dd>
                <dt>Conditions</dt>
                <dd>{data.profile?.chronic_conditions || '—'}</dd>
                <dt>Medications</dt>
                <dd>{data.profile?.current_medications || '—'}</dd>
              </dl>
            </div>

            <div className="profile-section">
              <h4>Recent visits with you</h4>
              {data.history.length === 0
                ? <div className="muted" style={{ fontSize: 12 }}>No prior visits.</div>
                : data.history.map((h) => (
                    <div key={h.id} className="history-row">
                      <div className="when">
                        {h.slot_date} at {h.start_time?.slice(0, 5)} · {h.visit_type === 'follow_up' ? 'follow-up' : 'consultation'}
                      </div>
                      {h.diagnosis && <div><strong>Dx:</strong> {h.diagnosis}</div>}
                      {h.treatment_plan && <div className="muted" style={{ fontSize: 12 }}>{h.treatment_plan}</div>}
                    </div>
                  ))}
            </div>
          </div>

          {/* Right column: consultation form + prescriptions */}
          <div>
            <div className="profile-section">
              <h4>Consultation notes</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field label="Symptoms" k="symptoms" form={form} upd={upd} disabled={isCompleted} />
                <Field label="Diagnosis" k="diagnosis" form={form} upd={upd} disabled={isCompleted} />
                <Field label="Treatment plan" k="treatmentPlan" form={form} upd={upd} disabled={isCompleted} />
                <Field label="Recommendations" k="recommendations" form={form} upd={upd} disabled={isCompleted} />

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={form.followupRecommended}
                    disabled={isCompleted}
                    onChange={(e) => upd('followupRecommended', e.target.checked)}
                  />
                  Recommend follow-up
                </label>
                {form.followupRecommended && (
                  <div>
                    <label className="label">Follow-up by</label>
                    <input
                      className="input"
                      type="date"
                      value={form.followupByDate || ''}
                      onChange={(e) => upd('followupByDate', e.target.value)}
                      disabled={isCompleted}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="profile-section">
              <h4>Prescriptions</h4>
              {data.prescriptions.length === 0 && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  No prescriptions yet.
                </div>
              )}
              {data.prescriptions.map((rx) => (
                <div key={rx.id} className="rx-chip">
                  <div>
                    <div className="rx-name">{rx.medication_name}</div>
                    <div className="rx-dose">{rx.dosage}</div>
                    {rx.instructions && <div className="rx-dose">{rx.instructions}</div>}
                  </div>
                  {!isCompleted && (
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => removePrescription(rx.id)}
                      title="Remove"
                    >×</button>
                  )}
                </div>
              ))}

              {!isCompleted && (
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  <input
                    className="input"
                    placeholder="Medication name"
                    value={rxForm.medicationName}
                    onChange={(e) => setRxForm({ ...rxForm, medicationName: e.target.value })}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <input
                      className="input"
                      placeholder="Dosage (e.g. 500mg twice daily)"
                      value={rxForm.dosage}
                      onChange={(e) => setRxForm({ ...rxForm, dosage: e.target.value })}
                    />
                    <input
                      className="input"
                      type="date"
                      value={rxForm.validUntil}
                      onChange={(e) => setRxForm({ ...rxForm, validUntil: e.target.value })}
                    />
                  </div>
                  <input
                    className="input"
                    placeholder="Instructions (optional)"
                    value={rxForm.instructions}
                    onChange={(e) => setRxForm({ ...rxForm, instructions: e.target.value })}
                  />
                  <button className="btn btn-outline btn-sm" disabled={rxBusy} onClick={addPrescription}>
                    {rxBusy ? 'Adding…' : 'Add prescription'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, k, form, upd, disabled }) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="input"
        rows={2}
        value={form[k] || ''}
        onChange={(e) => upd(k, e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
