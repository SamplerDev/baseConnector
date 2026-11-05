console.log('🚀 Cliente de Administración (Zero-Keys) inicializado');

// ==================================================================
// 1. SEGURIDAD Y CONTROL ANTI-CLICKJACKING / XSS
// ==================================================================
if (window.top !== window.self) {
  window.top.location = window.self.location;
}

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(String(unsafe));
  }
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==================================================================
// 2. VARIABLES DE ESTADO Y REFERENCIAS DOM
// ==================================================================
let authToken = sessionStorage.getItem('admin_token') || null;
let currentFactorId = null;

const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginTotp = document.getElementById('loginTotp');
const totpGroup = document.getElementById('totpGroup');
const loginError = document.getElementById('loginError');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userEmailSpan = document.getElementById('userEmailSpan');
const borradoresList = document.getElementById('borradoresList');
const borradoresBadge = document.getElementById('borradoresBadge');

// ==================================================================
// 3. CONTROL DE SESIÓN Y LOGIN
// ==================================================================
window.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    entrarDashboard(sessionStorage.getItem('admin_email'));
  }
});

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarError();
    loginBtn.disabled = true;
    loginBtn.innerText = 'Autenticando...';

    try {
      const payload = {
        email: loginEmail.value.trim(),
        password: loginPassword.value,
        code2FA: loginTotp.value.trim() || null,
        factorId: currentFactorId
      };

      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Credenciales inválidas.');
      }

      // Si requiere 2FA (Primera vez o subsecuente)
      if (data.requires2FA) {
        currentFactorId = data.factorId;
        totpGroup.classList.remove('hidden');
        loginTotp.required = true;

        // Renderizado adaptativo del QR (SVG directo vs URL Image)
        if (data.isFirstTime && data.qrCode) {
          const qrContainer = document.getElementById('qrContainer');
          const qrCodeWrapper = document.getElementById('qrCodeWrapper');
          const secretCode = document.getElementById('secretCode');

          if (qrContainer && qrCodeWrapper) {
            if (data.qrCode.startsWith('<svg')) {
              qrCodeWrapper.innerHTML = data.qrCode;
            } else {
              qrCodeWrapper.innerHTML = `<img src="${data.qrCode}" alt="Código QR 2FA" class="w-44 h-44 object-contain mx-auto">`;
            }

            if (secretCode) secretCode.innerText = data.secret || '';
            qrContainer.classList.remove('hidden');
          }
        }

        loginTotp.focus();
        mostrarError(data.message);
        loginBtn.disabled = false;
        loginBtn.innerText = 'Verificar y Enlazar 2FA';
        return;
      }

      // Inicio de sesión exitoso (Sesión AAL2 obtenida)
      authToken = data.token;
      sessionStorage.setItem('admin_token', data.token);
      sessionStorage.setItem('admin_email', data.user.email);

      entrarDashboard(data.user.email);

    } catch (err) {
      mostrarError(err.message);
    } finally {
      if (!currentFactorId) {
        loginBtn.disabled = false;
        loginBtn.innerText = 'Iniciar Sesión';
      }
    }
  });
}

function entrarDashboard(email) {
  if (loginView) loginView.classList.add('hidden');
  if (dashboardView) dashboardView.classList.remove('hidden');
  if (userEmailSpan) userEmailSpan.innerText = email || 'Admin';
  
  iniciarControlInactividad();
  cargarBorradores();
}

function mostrarError(msg) {
  if (loginError) {
    loginError.innerText = msg;
    loginError.classList.remove('hidden');
  }
}

function ocultarError() {
  if (loginError) loginError.classList.add('hidden');
}

function cerrarSesion() {
  sessionStorage.clear();
  location.reload();
}
if (logoutBtn) logoutBtn.addEventListener('click', cerrarSesion);

// ==================================================================
// 4. CLIENTE HTTP CENTRALIZADO Y AUTENTICADO
// ==================================================================
async function apiFetch(endpoint, options = {}) {
  if (!authToken) throw new Error('Sesión no autorizada');
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
    ...options.headers
  };
  
  const response = await fetch(`/api/admin${endpoint}`, { ...options, headers });
  
  if (response.status === 401 || response.status === 403) {
    cerrarSesion();
    throw new Error('Sesión expirada o token 2FA no válido.');
  }

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error en la petición.');
  return data;
}

// ==================================================================
// 5. GESTIÓN Y RENDERIZADO DE BORRADORES
// ==================================================================
async function cargarBorradores() {
  if (!borradoresList) return;
  try {
    borradoresList.innerHTML = '<p class="text-gray-400 text-sm col-span-3 text-center py-10">Cargando borradores pendientes...</p>';
    const res = await apiFetch('/borradores');
    const lista = res.borradores || [];

    if (borradoresBadge) borradoresBadge.innerText = lista.length;
    renderBorradores(lista);
  } catch (err) {
    borradoresList.innerHTML = `<p class="text-red-500 text-sm col-span-3 text-center py-10">${escapeHtml(err.message)}</p>`;
  }
}

function renderBorradores(lista) {
  if (!borradoresList) return;

  if (lista.length === 0) {
    borradoresList.innerHTML = '<p class="text-gray-500 col-span-3 text-center py-10">No hay borradores pendientes de revisión.</p>';
    return;
  }

  borradoresList.innerHTML = lista.map(item => `
    <div class="bg-white rounded-xl shadow-md p-6 border border-gray-200 flex flex-col justify-between">
      <div>
        <div class="flex justify-between items-start mb-4">
          <span class="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2.5 py-0.5 rounded">Pendiente #${escapeHtml(item.id)}</span>
        </div>
        
        <div class="space-y-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Destino</label>
            <input id="destino-${item.id}" type="text" value="${escapeHtml(item.destino)}" class="w-full border p-2 rounded text-sm font-bold">
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Fecha de Salida</label>
            <input id="fecha-${item.id}" type="text" value="${escapeHtml(item.fecha_salida)}" class="w-full border p-2 rounded text-sm">
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-xs font-semibold text-gray-500">Hotel</label>
              <input id="hotel-${item.id}" type="text" value="${escapeHtml(item.hotel)}" class="w-full border p-2 rounded text-sm">
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500">Precio Promo ($)</label>
              <input id="precio-${item.id}" type="number" value="${escapeHtml(item.precio_promo)}" class="w-full border p-2 rounded text-sm font-bold text-green-700">
            </div>
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Cupos Disponibles</label>
            <input id="cupos-${item.id}" type="number" value="${escapeHtml(item.cupos || 1)}" class="w-full border p-2 rounded text-sm">
          </div>
        </div>
      </div>

      <div class="mt-6 flex space-x-3 pt-4 border-t">
        <button onclick="aprobarBorrador(${item.id})" class="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-semibold transition">
          ✅ Aprobar y Publicar
        </button>
        <button onclick="rechazarBorrador(${item.id})" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-semibold transition">
          🗑️
        </button>
      </div>
    </div>
  `).join('');
}

// Globalizar funciones para event listeners inline del HTML
window.aprobarBorrador = async function(id) {
  try {
    const payload = {
      destino: document.getElementById(`destino-${id}`).value,
      fecha_salida: document.getElementById(`fecha-${id}`).value,
      hotel: document.getElementById(`hotel-${id}`).value,
      precio_promo: parseFloat(document.getElementById(`precio-${id}`).value),
      cupos: parseInt(document.getElementById(`cupos-${id}`).value, 10) || 1
    };
    await apiFetch(`/aprobar-borrador/${id}`, { method: 'POST', body: JSON.stringify(payload) });
    cargarBorradores();
  } catch (err) {
    alert(`Error al aprobar: ${err.message}`);
  }
};

window.rechazarBorrador = async function(id) {
  if (!confirm('¿Deseas descartar este borrador?')) return;
  try {
    await apiFetch(`/borrador/${id}`, { method: 'DELETE' });
    cargarBorradores();
  } catch (err) {
    alert(`Error al rechazar: ${err.message}`);
  }
};

// ==================================================================
// 6. CONTROL DE INACTIVIDAD (15 MINUTOS)
// ==================================================================
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
let inactivityTimer;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (authToken) {
    inactivityTimer = setTimeout(() => {
      alert('🔒 Sesión expirada automáticamente por inactividad.');
      cerrarSesion();
    }, INACTIVITY_LIMIT_MS);
  }
}

function iniciarControlInactividad() {
  ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => window.addEventListener(evt, resetInactivityTimer));
  resetInactivityTimer();
}