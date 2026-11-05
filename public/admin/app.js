console.log('🚀 Cliente de Administración (Zero-Keys) inicializado');

// Anti-Clickjacking
if (window.top !== window.self) {
  window.top.location = window.self.location;
}

// Variables de Estado
let authToken = sessionStorage.getItem('admin_token') || null;
let currentFactorId = null;

// Elementos del DOM
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

// Comprobar sesión existente al cargar la página
window.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    entrarDashboard(sessionStorage.getItem('admin_email'));
  }
});

// Listener del Formulario de Login
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

      // Petición al Backend Node.js
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Credenciales inválidas.');
      }

      // Si el backend solicita verificación 2FA
      if (data.requires2FA) {
        currentFactorId = data.factorId;
        totpGroup.classList.remove('hidden');
        loginTotp.required = true;
        loginTotp.focus();
        mostrarError(data.message);
        loginBtn.disabled = false;
        loginBtn.innerText = 'Verificar Código 2FA';
        return;
      }

      // Inicio de sesión exitoso
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
  if (userEmailSpan) userEmailSpan.innerText = email;
  
  iniciarControlInactividad();
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

// Control de Inactividad (15 Minutos)
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
let inactivityTimer;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (authToken) {
    inactivityTimer = setTimeout(() => {
      alert('🔒 Sesión expirada por inactividad.');
      cerrarSesion();
    }, INACTIVITY_LIMIT_MS);
  }
}

function iniciarControlInactividad() {
  ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => window.addEventListener(evt, resetInactivityTimer));
  resetInactivityTimer();
}
function renderBorradores(lista, token) {
  if (lista.length === 0) {
    borradoresList.innerHTML = '<p class="text-gray-500 col-span-3 text-center">No hay borradores pendientes de revisión.</p>';
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
        <button onclick="aprobarBorrador(${item.id}, '${token}')" class="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-semibold transition">
          ✅ Aprobar y Publicar
        </button>
        <button onclick="rechazarBorrador(${item.id}, '${token}')" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-semibold transition">
          🗑️
        </button>
      </div>
    </div>
  `).join('');
}