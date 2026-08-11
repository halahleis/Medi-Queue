import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

const METHODS = [
  { id: 'card', label: 'Cards', detail: 'Visa, Mastercard, Amex' },
  { id: 'bank', label: 'Bank redirect', detail: 'Online banking' },
  { id: 'wallet', label: 'Wallet', detail: 'Apple Pay, Google Pay' },
  { id: 'later', label: 'Pay later', detail: 'Split payment' },
];

export default function PaymentModal({ appointment, amount, onClose, onPaid }) {
  const [method, setMethod] = useState('card');
  const [step, setStep] = useState('details');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(179);
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(30);
  const [card, setCard] = useState({
    number: '',
    expiry: '',
    cvv: '',
    name: '',
    otp: '',
  });

  const displayAmount = useMemo(() => formatMoney(amount), [amount]);
  const maskedCard = card.number.replace(/\D/g, '').slice(-4) || '4242';
  const paymentTimer = formatTimer(secondsLeft);

  useEffect(() => {
    if (step === 'success') return undefined;
    const timerId = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [step]);

  useEffect(() => {
    if (step !== 'otp') return undefined;
    setOtpSecondsLeft(30);
    const timerId = window.setInterval(() => {
      setOtpSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [step]);

  const updateCard = (key, value) => {
    setCard((prev) => ({ ...prev, [key]: value }));
  };

  const continuePayment = () => {
    if (method === 'card') {
      const digits = card.number.replace(/\D/g, '');
      if (digits.length < 12 || !card.expiry.trim() || !card.cvv.trim() || !card.name.trim()) {
        toast.error('Enter the card details to continue.');
        return;
      }
      setStep('otp');
      return;
    }

    setStep('confirming');
    window.setTimeout(() => submitPayment(), 900);
  };

  const submitPayment = async () => {
    if (!appointment?.id) return;
    setBusy(true);
    setStep('confirming');
    try {
      await api.post(`/patient/appointments/${appointment.id}/pay`);
      setStep('success');
      window.setTimeout(() => onPaid?.(), 1100);
    } catch (err) {
      toast.error(err.displayMessage || 'Payment failed.');
      setStep(method === 'card' ? 'otp' : 'details');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="payment-overlay" role="dialog" aria-modal="true">
      <div className="payment-shell">
        <aside className="payment-summary">
          <div className="payment-brand-mark">M</div>
          <div>
            <div className="payment-title">Appointment Payment</div>
            <div className="payment-subtitle">Secured payment session</div>
          </div>

          <div className="payment-price-card">
            <span>Price Summary</span>
            <strong>{displayAmount}</strong>
          </div>

          <div className="payment-account">
            <span className="payment-account-icon">ID</span>
            <span>Using saved patient profile</span>
            <span className="payment-chevron">&gt;</span>
          </div>

          <div className="payment-illustration">
            <div className="payment-cube" />
            <div className="payment-ring" />
            <div className="payment-terminal" />
          </div>

          <div className="payment-secured">Secured by <strong>Stripe</strong></div>
        </aside>

        <section className="payment-panel">
          <div className="payment-panel-header">
            <span />
            <div>
              <div className="payment-panel-title">Payment Options</div>
              {step !== 'success' && <div className="payment-timeout">Timeout in {paymentTimer} mins</div>}
            </div>
            <button type="button" className="payment-close" onClick={onClose} disabled={busy}>x</button>
          </div>

          {step === 'details' && (
            <div className="payment-content">
              <nav className="payment-methods" aria-label="Payment methods">
                {METHODS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`payment-method ${method === item.id ? 'active' : ''}`}
                    onClick={() => setMethod(item.id)}
                  >
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <PaymentLogos method={item.id} />
                  </button>
                ))}
              </nav>

              <div className="payment-form-area">
                {method === 'card' ? (
                  <CardForm card={card} updateCard={updateCard} onSubmit={continuePayment} />
                ) : (
                  <AlternativePayment method={method} amount={displayAmount} onSubmit={continuePayment} />
                )}
              </div>
            </div>
          )}

          {step === 'otp' && (
            <OtpStep
              card={card}
              maskedCard={maskedCard}
              busy={busy}
              otpSecondsLeft={otpSecondsLeft}
              onResendOtp={() => setOtpSecondsLeft(30)}
              updateCard={updateCard}
              onBack={() => setStep('details')}
              onSubmit={submitPayment}
            />
          )}

          {step === 'confirming' && <ConfirmingStep />}
          {step === 'success' && <SuccessStep amount={displayAmount} appointment={appointment} />}
        </section>
      </div>
    </div>
  );
}

function CardForm({ card, updateCard, onSubmit }) {
  return (
    <form className="stripe-card-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="payment-form-heading">
        <h3>Add a new card</h3>
        <span className="card-network">VISA</span>
      </div>
      <input
        className="payment-input"
        value={card.number}
        onChange={(e) => updateCard('number', formatCardNumber(e.target.value))}
        placeholder="Card Number"
        inputMode="numeric"
        maxLength={19}
      />
      <div className="payment-input-grid">
        <input
          className="payment-input"
          value={card.expiry}
          onChange={(e) => updateCard('expiry', formatExpiry(e.target.value))}
          placeholder="MM / YY"
          inputMode="numeric"
          maxLength={7}
        />
        <input
          className="payment-input"
          value={card.cvv}
          onChange={(e) => updateCard('cvv', e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="CVV"
          inputMode="numeric"
          maxLength={4}
        />
      </div>
      <input
        className="payment-input"
        value={card.name}
        onChange={(e) => updateCard('name', e.target.value)}
        placeholder="Enter name on card"
      />
      <label className="payment-save-row">
        <input type="checkbox" />
        <span>Save this card for future appointments</span>
      </label>
      <button type="submit" className="payment-primary">Continue</button>
    </form>
  );
}

function AlternativePayment({ method, amount, onSubmit }) {
  const copy = {
    bank: ['Bank redirect', 'Choose your bank and complete payment securely on the bank page.'],
    wallet: ['Wallet payment', 'Use Apple Pay or Google Pay for a fast checkout.'],
    later: ['Pay later', 'Split this appointment payment with an eligible provider.'],
  }[method];

  return (
    <div className="payment-alt">
      <h3>{copy[0]}</h3>
      <p>{copy[1]}</p>
      <div className="payment-alt-amount">
        <span>Appointment total</span>
        <strong>{amount}</strong>
      </div>
      <button type="button" className="payment-primary" onClick={onSubmit}>Continue</button>
    </div>
  );
}

function OtpStep({ card, maskedCard, busy, otpSecondsLeft, onResendOtp, updateCard, onBack, onSubmit }) {
  return (
    <div className="payment-otp-step">
      <div className="payment-card-preview">
        <span>VISA</span>
        <div className="payment-chip" />
        <strong>{card.number || '4242 4242 4242 4242'}</strong>
      </div>
      <div className="payment-otp-sheet">
        <h3>Enter OTP to complete payment</h3>
        <p>Enter OTP sent to the number linked to your card ending with {maskedCard}</p>
        <input
          className="payment-input otp"
          value={card.otp}
          onChange={(e) => updateCard('otp', e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Enter OTP"
          inputMode="numeric"
        />
        <div className="payment-otp-row">
          <button type="button" onClick={onBack}>Change method</button>
          {otpSecondsLeft > 0 ? (
            <span>Resend OTP in {otpSecondsLeft}s</span>
          ) : (
            <button type="button" onClick={onResendOtp}>Resend OTP</button>
          )}
        </div>
        <button
          type="button"
          className="payment-primary"
          disabled={busy || card.otp.length < 4}
          onClick={onSubmit}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function ConfirmingStep() {
  return (
    <div className="payment-state payment-confirming">
      <h3>Confirming Payment</h3>
      <p>This will only take a few seconds.</p>
      <div className="payment-spinner" />
      <div className="payment-secured dark">Secured by <strong>Stripe</strong></div>
    </div>
  );
}

function SuccessStep({ amount, appointment }) {
  return (
    <div className="payment-state payment-success">
      <p>You will be redirected shortly</p>
      <h3>Payment Successful</h3>
      <div className="payment-check">OK</div>
      <div className="payment-receipt">
        <span>Appointment Payment</span>
        <strong>{amount}</strong>
        <small>{new Date().toLocaleString()}</small>
        <code>pay_{String(appointment?.id || '').slice(0, 10)}</code>
      </div>
      <div className="payment-secured success">Secured by <strong>Stripe</strong></div>
    </div>
  );
}

function PaymentLogos({ method }) {
  const labels = {
    card: ['VISA', 'MC'],
    bank: ['ACH', 'BANK'],
    wallet: ['PAY', 'GPay'],
    later: ['Klarna', 'Affirm'],
  }[method];
  return (
    <span className="payment-logos">
      {labels.map((label) => <em key={label}>{label}</em>)}
    </span>
  );
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `$${number.toFixed(2)}`;
}

function formatTimer(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatCardNumber(value) {
  return value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}
