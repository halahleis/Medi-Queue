export const PASSWORD_RULES = [
  { key: 'length', label: 'At least 8 characters', test: (value) => value.length >= 8 },
  { key: 'upper', label: 'One uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { key: 'lower', label: 'One lowercase letter', test: (value) => /[a-z]/.test(value) },
  { key: 'number', label: 'One number', test: (value) => /\d/.test(value) },
  { key: 'special', label: 'One special character', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export const passwordIssues = (password = '') =>
  PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label);

export const passwordMessage = (password = '') => {
  const issues = passwordIssues(password);
  return issues.length > 0 ? `Password must include: ${issues.join(', ')}.` : '';
};

export const PHONE_COUNTRIES = [
  { code: 'LB', name: 'Lebanon', dialCode: '+961', nationalDigits: [7, 8], placeholder: '70 123 456' },
  { code: 'SY', name: 'Syria', dialCode: '+963', nationalDigits: [9], placeholder: '944 123 456' },
  { code: 'JO', name: 'Jordan', dialCode: '+962', nationalDigits: [9], placeholder: '79 123 4567' },
  { code: 'IQ', name: 'Iraq', dialCode: '+964', nationalDigits: [10], placeholder: '770 123 4567' },
  { code: 'PS', name: 'Palestine', dialCode: '+970', nationalDigits: [9], placeholder: '59 123 4567' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', nationalDigits: [10], placeholder: '532 123 4567' },
  { code: 'CY', name: 'Cyprus', dialCode: '+357', nationalDigits: [8], placeholder: '96 123456' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', nationalDigits: [9], placeholder: '50 123 4567' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', nationalDigits: [9], placeholder: '50 123 4567' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', nationalDigits: [8], placeholder: '3312 3456' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965', nationalDigits: [8], placeholder: '5123 4567' },
  { code: 'BH', name: 'Bahrain', dialCode: '+973', nationalDigits: [8], placeholder: '3600 1234' },
  { code: 'OM', name: 'Oman', dialCode: '+968', nationalDigits: [8], placeholder: '9123 4567' },
  { code: 'YE', name: 'Yemen', dialCode: '+967', nationalDigits: [9], placeholder: '712 345 678' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', nationalDigits: [10], placeholder: '100 123 4567' },
  { code: 'IR', name: 'Iran', dialCode: '+98', nationalDigits: [10], placeholder: '912 123 4567' },
  { code: 'US', name: 'United States', dialCode: '+1', nationalDigits: [10], placeholder: '202 555 0198' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', nationalDigits: [10], placeholder: '7400 123456' },
  { code: 'FR', name: 'France', dialCode: '+33', nationalDigits: [9], placeholder: '6 12 34 56 78' },
];

export const DEFAULT_COUNTRY = PHONE_COUNTRIES[0];

export const digitsOnly = (value = '') => String(value).replace(/\D/g, '');

export const formatInternationalPhone = (country, nationalNumber) => {
  const digits = digitsOnly(nationalNumber);
  if (!digits) return '';
  return `${country.dialCode}${digits}`;
};

export const parseInternationalPhone = (phone = '') => {
  const trimmed = String(phone || '').trim();
  const country = PHONE_COUNTRIES.find((item) => trimmed.startsWith(item.dialCode)) || DEFAULT_COUNTRY;
  const nationalNumber = trimmed.startsWith(country.dialCode)
    ? trimmed.slice(country.dialCode.length)
    : trimmed.replace(/^\+/, '');
  return { countryCode: country.code, nationalNumber };
};

export const validateNationalPhone = (country, nationalNumber) => {
  const digits = digitsOnly(nationalNumber);
  if (!digits) return '';
  if (!country.nationalDigits.includes(digits.length)) {
    const lengths = country.nationalDigits.join(' or ');
    return `${country.name} numbers must have ${lengths} digits after ${country.dialCode}.`;
  }
  return '';
};

export const findCountry = (code) =>
  PHONE_COUNTRIES.find((country) => country.code === code) || DEFAULT_COUNTRY;
