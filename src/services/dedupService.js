const supabase = require('../config/db');
const log = require('../utils/logger');

async function isMessageProcessed(eventId) {
  if (!supabase || !eventId) return false;

  const { data, error } = await supabase
    .from('mensajes_procesados')
    .select('message_id')
    .eq('message_id', eventId)
    .maybeSingle();

  if (error) {
    log.error('DEDUP_ERR', `Error consultando mensajes_procesados para ${eventId}`, error);
    return false;
  }

  return !!data;
}

async function markMessageAsProcessed(eventId) {
  if (!supabase || !eventId) return;

  const { error } = await supabase
    .from('mensajes_procesados')
    .insert([{ message_id: eventId }]);

  if (error) {
    log.error('DEDUP_MARK_ERR', `Error marcando evento ${eventId}`, error);
  } else {
    log.success('DEDUP_MARK_OK', `Evento ${eventId} guardado en mensajes_procesados.`);
  }
}

module.exports = {
  isMessageProcessed,
  markMessageAsProcessed
};