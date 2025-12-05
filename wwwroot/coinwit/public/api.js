const API_BASE_URL = window.location.origin + '/api';

function getToken() {
    return localStorage.getItem('authToken');
}

function getAdminToken() {
    return localStorage.getItem('adminAuthToken');
}

function checkLogin(redirectToLogin = true) {
    const isLoginOrRegisterPage = window.location.pathname.includes('login') || window.location.pathname.includes('register');
    const token = getAdminToken() || getToken();
    if (!token && redirectToLogin && !isLoginOrRegisterPage) {
        const targetPage = window.location.pathname + window.location.search;
        sessionStorage.setItem('redirectAfterLogin', targetPage);
        window.location.href = 'login';
        return null;
    }
    return token;
}

async function fetchAPI(endpoint, options = {}) {
    const token = getAdminToken() || getToken();
    const defaultHeaders = { 'Content-Type': 'application/json' };
    if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
    }
    options.headers = { ...defaultHeaders, ...options.headers };
    try {
        const cleanEndpoint = endpoint.startsWith('/api') ? endpoint.substring(4) : endpoint;
        const fullUrl = API_BASE_URL + cleanEndpoint;
        const response = await fetch(fullUrl, options);
        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('adminAuthToken');
            const targetPage = window.location.pathname + window.location.search;
            sessionStorage.setItem('redirectAfterLogin', targetPage);
            window.location.href = 'login';
            return Promise.reject(new Error('Unauthorized'));
        }
        const contentType = response.headers.get("content-type");
        let data = {};
        if (contentType && contentType.indexOf("application/json") !== -1) {
            data = await response.json();
        }
        if (!response.ok) {
            return Promise.reject(new Error(data.message || 'Lỗi không xác định từ server'));
        }
        return data;
    } catch (error) {
        return Promise.reject(error);
    }
}

async function fetchAdminAPI(endpoint, options = {}) {
    const token = getAdminToken();
    const defaultHeaders = { 'Content-Type': 'application/json' };
    if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
    } else {
        setTimeout(() => window.location.href = 'login', 2000);
        return Promise.reject(new Error('Lỗi Token Admin'));
    }
    options.headers = { ...defaultHeaders, ...options.headers };
    try {
        const cleanEndpoint = endpoint.startsWith('/api') ? endpoint.substring(4) : endpoint;
        const fullUrl = API_BASE_URL + cleanEndpoint;
        const response = await fetch(fullUrl, options);
        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminAuthToken');
            localStorage.removeItem('authToken');
            setTimeout(() => window.location.href = 'login', 2000);
            return Promise.reject(new Error('Unauthorized (401/403)'));
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Lỗi không xác định từ server');
        }
        return data;
    } catch (error) {
        return Promise.reject(error);
    }
}

window.API = {
    BASE_URL: API_BASE_URL,
    fetch: fetchAPI,
    fetchAdmin: fetchAdminAPI,
    getToken: getToken,
    getAdminToken: getAdminToken,
    checkLogin: checkLogin
};

