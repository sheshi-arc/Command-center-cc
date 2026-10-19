export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('token');
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const rawBase = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '/api';
  const API_BASE = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const response = await fetch(`${API_BASE}${normalizedEndpoint}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  if (!response.ok) {
    if (response.status === 405) {
      throw new Error('API server unreachable (405 Method Not Allowed). Please ensure the backend server is running on port 5000.');
    }
    const errorBody = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorBody.message || `Request failed with status ${response.status}`);
  }

  // Handle file/blob downloads (PDF / Excel / CSV)
  const contentType = response.headers.get('content-type');
  if (
    contentType &&
    (contentType.includes('application/pdf') ||
      contentType.includes('spreadsheetml') ||
      contentType.includes('text/csv') ||
      contentType.includes('application/octet-stream'))
  ) {
    return (await response.blob()) as unknown as T;
  }

  return response.json();
}
