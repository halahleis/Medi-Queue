/**
 * Convert a "HH:MM" or "HH:MM:SS" string to minutes from midnight.
 */
const timeToMinutes = (timeStr) => {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Convert minutes from midnight to "HH:MM:SS".
 */
const minutesToTime = (minutes) => {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
};

/**
 * Get the day_of_week enum value for a Date or YYYY-MM-DD string.
 */
const getDayOfWeek = (dateInput) => {
  const date = typeof dateInput === 'string' ? new Date(dateInput + 'T00:00:00') : dateInput;
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
};

/**
 * Today's date as YYYY-MM-DD (local time).
 */
const todayDateStr = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Current local time as "HH:MM:SS".
 */
const currentTimeStr = () => {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

module.exports = {
  timeToMinutes,
  minutesToTime,
  getDayOfWeek,
  todayDateStr,
  currentTimeStr,
};
