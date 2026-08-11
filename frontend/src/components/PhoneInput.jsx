import {
  PHONE_COUNTRIES,
  digitsOnly,
  findCountry,
  formatInternationalPhone,
  parseInternationalPhone,
  validateNationalPhone,
} from '../utils/formValidation';

export default function PhoneInput({
  label = 'Phone',
  value = '',
  onChange,
  disabled = false,
  required = false,
}) {
  const parsed = parseInternationalPhone(value);
  const country = findCountry(parsed.countryCode);
  const error = validateNationalPhone(country, parsed.nationalNumber);

  const setCountry = (countryCode) => {
    const nextCountry = findCountry(countryCode);
    onChange(formatInternationalPhone(nextCountry, parsed.nationalNumber));
  };

  const setNumber = (nextValue) => {
    onChange(formatInternationalPhone(country, digitsOnly(nextValue)));
  };

  return (
    <div>
      <label className="label">{label}{required ? ' *' : ''}</label>
      <div className="phone-input-row">
        <select
          className="select phone-country-select"
          value={country.code}
          onChange={(e) => setCountry(e.target.value)}
          disabled={disabled}
        >
          {PHONE_COUNTRIES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name} {item.dialCode}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={parsed.nationalNumber}
          onChange={(e) => setNumber(e.target.value)}
          disabled={disabled}
          required={required}
          inputMode="tel"
          placeholder={country.placeholder}
        />
      </div>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
