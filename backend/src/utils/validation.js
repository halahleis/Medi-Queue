const PASSWORD_RULES = [
  { test: (value) => value.length >= 8, message: 'at least 8 characters' },
  { test: (value) => /[A-Z]/.test(value), message: 'one uppercase letter' },
  { test: (value) => /[a-z]/.test(value), message: 'one lowercase letter' },
  { test: (value) => /\d/.test(value), message: 'one number' },
  { test: (value) => /[^A-Za-z0-9]/.test(value), message: 'one special character' },
];

const getPasswordIssues = (password = '') =>
  PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.message);

const validatePassword = (password = '') => {
  const issues = getPasswordIssues(password);
  if (issues.length > 0) {
    return `Password must contain ${issues.join(', ')}.`;
  }
  return null;
};

const validatePhone = (phone) => {
  if (!phone) return null;
  const cleaned = String(phone).trim();
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return 'Phone number must include a country code and contain 8 to 15 digits, for example +96170123456.';
  }
  return null;
};

module.exports = {
  PASSWORD_RULES,
  getPasswordIssues,
  validatePassword,
  validatePhone,
};
