import { PASSWORD_RULES } from '../utils/formValidation';

export default function PasswordRules({ password = '' }) {
  return (
    <div className="password-rules" aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <div key={rule.key} className={met ? 'met' : ''}>
            <span>{met ? 'OK' : '-'}</span>
            {rule.label}
          </div>
        );
      })}
    </div>
  );
}
