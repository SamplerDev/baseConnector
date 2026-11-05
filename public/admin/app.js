// ==================================================================
// 1. SEGURIDAD Y CONTROL DE INACTIVIDAD (15 Minutos)
// ==================================================================
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 Minutos
let inactivityTimer;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    alert('🔒 Sesión cerrada automáticamente por inactividad.');
    cerrarSesionSegura();
  }, INACTIVITY_LIMIT_MS);
}

// Monitorizar eventos de interacción del usuario
['mousemove', 'keydown', 'click', 'scroll'].forEach(event => {
  window.addEventListener(event, resetInactivityTimer);
});

async function cerrarSesionSegura() {
  await supabase.auth.signOut();
  sessionStorage.clear();
  location.reload();
}

// Anti-Clickjacking en JavaScript (Doble Verificación)
if (window.top !== window.self) {
  window.top.location = window.self.location;
}

// ==================================================================
// 2. RENDERING SEGURO CON DESINFECCIÓN ANTI-XSS
// ==================================================================
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return DOMPurify.sanitize(String(unsafe));
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