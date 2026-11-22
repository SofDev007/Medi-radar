import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api\/?$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export const getToken = () => localStorage.getItem('token');

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/admin/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

/** Human-readable message from an API error. */
export const errorMessage = (error, fallback = 'Something went wrong. Try again.') =>
  error?.response?.data?.message || (error?.message === 'Network Error' ? 'Cannot reach the server.' : fallback);

export const authAPI = {
  login: (email, password) => api.post('/auth/admin/login', { email, password }),
};

export const adminAPI = {
  summary: () => api.get('/admin/summary'),
  passengers: () => api.get('/admin/passengers'),
};

export const busAPI = {
  getAll: () => api.get('/buses'),
  create: (data) => api.post('/buses', data),
  update: (id, data) => api.put(`/buses/${id}`, data),
  delete: (id) => api.delete(`/buses/${id}`),
  assignDriver: (busId, driverId) => api.post(`/buses/${busId}/assign-driver`, { driverId }),
  getActive: () => api.get('/buses/active/all'),
};

export const driverAPI = {
  getAll: () => api.get('/drivers'),
  create: (data) => api.post('/drivers', data),
  update: (id, data) => api.put(`/drivers/${id}`, data),
  delete: (id) => api.delete(`/drivers/${id}`),
  applications: (status) => api.get('/drivers/applications', { params: { status } }),
  approve: (id) => api.post(`/drivers/${id}/approve`),
  reject: (id, reason) => api.post(`/drivers/${id}/reject`, { reason }),
  document: (id, kind) => api.get(`/drivers/${id}/documents/${kind}`, { responseType: 'blob' }),
};

export const tripAPI = {
  list: (params) => api.get('/trips', { params }),
  stats: (params) => api.get('/trips/stats', { params }),
  getActive: () => api.get('/trips/active/all'),
};

export const locationAPI = {
  byTrip: (tripId) => api.get(`/locations/trip/${tripId}`),
};

export const incidentAPI = {
  list: (params) => api.get('/incidents', { params }),
  get: (id) => api.get(`/incidents/${id}`),
  acknowledge: (id) => api.post(`/incidents/${id}/acknowledge`),
  resolve: (id, resolution, note) => api.post(`/incidents/${id}/resolve`, { resolution, note }),
};

export const transitAPI = {
  stops: () => api.get('/transit/stops'),
  createStop: (data) => api.post('/transit/stops', data),
  updateStop: (id, data) => api.put(`/transit/stops/${id}`, data),
  deleteStop: (id) => api.delete(`/transit/stops/${id}`),
  routes: () => api.get('/transit/routes'),
  route: (id) => api.get(`/transit/routes/${id}`),
  createRoute: (data) => api.post('/transit/routes', data),
  updateRoute: (id, data) => api.put(`/transit/routes/${id}`, data),
  deleteRoute: (id) => api.delete(`/transit/routes/${id}`),
  generatePath: (id) => api.post(`/transit/routes/${id}/generate-path`, {}),
};

export const publicAPI = {
  route: (id) => api.get(`/public/routes/${id}`),
};

export default api;
