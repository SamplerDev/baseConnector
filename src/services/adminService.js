const env = require('../config/env');
const supabase = require('../config/db');
const pythonClient = require('../config/pythonClient');
const zernioService = require('./zernioService');
const log = require('../utils/logger');

async function procesarRespuestaAdmin(adminPhone, adminMessage) {
  if (env.ADMIN_PHONE && String(adminPhone).replace(/\D/g, '') !== String(env.ADMIN_PHONE).replace(/\D/g, '')) {
    log.warn('ADMIN_REPLY_DENIED', `Teléfono no autorizado: ${adminPhone}`);
    throw new Error('Número no autorizado');
  }

  const match = adminMessage.match(/#(\d+)/);
  if (!match) {
    log.warn('ADMIN_REPLY_INVALID', 'No se encontró el ID del ticket (#ID)');
    throw new Error('ID de ticket no encontrado en el mensaje (#ID)');
  }

  const ticket_id = match[1];
  log.info('ADMIN_REPLY_MATCH', `Procesando Ticket ID: #${ticket_id}`);

  const aiResponse = await pythonClient.post('/agent/confirm', {
    admin_message: adminMessage
  });

  const accion = aiResponse.data.accion;
  const nuevoEstado = (accion === 'APROBAR') ? 'CONFIRMADO' : 'RECHAZAR';

  const { data: ticket, error } = await supabase
    .from('tickets_disponibilidad')
    .update({ estado: nuevoEstado })
    .eq('id', ticket_id)
    .select('*, ofertas_publicadas(destino, fecha_salida, descripcion)')
    .single();

  if (error || !ticket) {
    throw new Error(`Error actualizando ticket #${ticket_id} en Supabase`);
  }

  const destinoNombre = ticket.ofertas_publicadas?.destino || 'tu viaje';
  let mensajeCliente = nuevoEstado === 'CONFIRMADO'
    ? `🎉 ¡Buenas noticias! Confirmamos disponibilidad para tu viaje a *${destinoNombre}*. ¿Deseas proceder con la reserva?`
    : `Lamentablemente no contamos con lugares disponibles para *${destinoNombre}* en este momento.`;

  await zernioService.sendZernioMessage(ticket.client_phone, mensajeCliente);
  log.success('ADMIN_REPLY_OK', `Flujo completado para ticket #${ticket_id}`);

  return { ticket_id, nuevoEstado };
}

module.exports = { procesarRespuestaAdmin };