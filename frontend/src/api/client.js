import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// Attach Bearer token from localStorage on every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mq_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Bubble up the server's `message` field so callers can display it directly.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.message || err.message || 'Request failed.';
    err.displayMessage = msg;

    // Auto-logout on 401 (except on the login endpoint itself).
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem('mq_token');
      localStorage.removeItem('mq_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
