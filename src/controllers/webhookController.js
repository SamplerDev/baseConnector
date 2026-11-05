const axios = require('axios');
const env = require('../config/env');
const supabase = require('../config/db');
const pythonClient = require('../config/pythonClient');
const log = require('../utils/logger');
const zernioService = require('../services/zernioService');
const dedupService = require('../services/dedupService');
const { procesarRespuestaAdmin } = require('../services/adminService');

async function handleZernioWebhook(req, res) {
  log.info('WEBHOOK_IN', 'Payload completo recibido en /webhook:', req.body);
  res.status(200).send({ status: 'RECEIVED' });

  setImmediate(async () => {
    try {
      const payload = req.body;
      const eventId = payload.id || req.headers['x-zernio-event-id'] || req.headers['x-late-event-id'];

      if (payload.event && payload.event !== 'message.received' && payload.event !== 'dm.received') {
        return;
      }

      if (await dedupService.isMessageProcessed(eventId)) {
        log.warn('WEBHOOK_DEDUP', `⚠️ Evento duplicado omitido [ID: ${eventId}]`);
        return;
      }
      await dedupService.markMessageAsProcessed(eventId);

      const messageData = payload.message || payload.data || payload;
      const fromNumber = messageData.sender?.phoneNumber || messageData.from || messageData.sender;
      const textBody = messageData.text || messageData.message || messageData.body || messageData.caption || '';
      const conversationId = messageData.conversationId || payload.conversation?.id;

      let mediaUrl = null;
      if (messageData.attachments && messageData.attachments.length > 0) {
        mediaUrl = messageData.attachments[0].url || messageData.attachments[0].payload?.url;
      }

      if (!fromNumber || (!textBody && !mediaUrl)) {
        log.warn('WEBHOOK_ABORT', 'No se detectó remitente ni contenido.');
        return;
      }

      const cleanFrom = String(fromNumber).replace(/\D/g, '');
      const cleanAdmin = String(env.ADMIN_PHONE).replace(/\D/g, '');
      const isAdmin = cleanFrom === cleanAdmin;

      if (isAdmin) {
        if (textBody && textBody.includes('#')) {
          log.info('ADMIN_FLOW', `Procesando confirmación de ticket...`);
          await procesarRespuestaAdmin(fromNumber, textBody);
        } else {
          log.info('ADMIN_FLYER', `Nueva promo/flyer recibida de Admin (${fromNumber})...`);

          const targetId = conversationId || fromNumber;
          await zernioService.sendZernioMessage(targetId, "⏳ *Analizando afiche con IA (Buscando ofertas)...*", fromNumber);

          let imageBase64 = null;
          let mimeType = 'image/jpeg';

          if (mediaUrl) {
            try {
              const mediaResponse = await axios.get(mediaUrl, {
                headers: { 'Authorization': `Bearer ${env.ZERNIO_API_KEY}` },
                responseType: 'arraybuffer',
                timeout: 15000
              });
              imageBase64 = Buffer.from(mediaResponse.data).toString('base64');
              mimeType = mediaResponse.headers['content-type'] || 'image/jpeg';
            } catch (mErr) {
              log.error('MEDIA_DOWNLOAD_ERR', 'Error descargando la imagen:', mErr.message);
            }
          }

          await pythonClient.post('/agent/extract-flyer', {
            phone_number: targetId,
            text_content: textBody,
            image_base64: imageBase64,
            mime_type: mimeType
          });
        }
      } else {
        const { data: conv } = await supabase
          .from('conversaciones')
          .select('bot_activo')
          .eq('phone_number', fromNumber)
          .maybeSingle();

        const botActivo = conv ? conv.bot_activo : true;

        await supabase.from('chat_sesiones').insert([{
          phone_number: fromNumber,
          role: 'user',
          content: textBody
        }]);

        if (botActivo) {
          const { data: catalogo } = await supabase
            .from('ofertas_publicadas')
            .select('id, destino, fecha_salida, descripcion, contacto, cupos')
            .eq('activo', true)
            .gt('cupos', 0);

          const aiResponse = await pythonClient.post('/agent/chat', {
            user_message: textBody,
            travel_catalog: catalogo || [],
            history: []
          });

          const respuestaIA = aiResponse.data.response;

          await supabase.from('chat_sesiones').insert([{
            phone_number: fromNumber,
            role: 'assistant',
            content: respuestaIA
          }]);

          await zernioService.sendZernioMessage(conversationId || fromNumber, respuestaIA, fromNumber);
        }
      }
    } catch (err) {
      log.error('WEBHOOK_PROC_ERR', 'Error durante el procesamiento del Webhook', err);
    }
  });
}

async function handleFlyerCompleted(req, res) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : req.headers['x-api-key'];

  if (env.INTERNAL_API_KEY && token !== env.INTERNAL_API_KEY) {
    log.error('AUTH_CALLBACK_FAIL', 'Acceso rechazado en Callback: Token inválido.');
    return res.status(401).json({ error: 'No autorizado' });
  }

  res.status(200).json({ ok: true });

  const { phoneNumber, extractedData, error, message } = req.body;

  if (error) {
    await zernioService.sendZernioMessage(phoneNumber, `❌ Ocurrió un error procesando la imagen: ${message || 'Error en IA'}`);
    return;
  }

  try {
    const ofertasEncontradas = extractedData?.ofertas || [];

    if (ofertasEncontradas.length === 0) {
      await zernioService.sendZernioMessage(phoneNumber, "⚠️ No se detectaron ofertas de viaje claras en la imagen o texto enviado.");
      return;
    }

    let resumenAdmin = `📋 *SE DETECTARON ${ofertasEncontradas.length} OFERTA(S) EN BORRADOR*\n\n`;

    for (let i = 0; i < ofertasEncontradas.length; i++) {
      const item = ofertasEncontradas[i];

      const { error: dbErr } = await supabase.from('ofertas_borrador').insert([{
        destino: item.destino || 'Sin Destino',
        fecha_salida: item.fecha_salida || 'A confirmar',
        duracion: item.duracion || null,
        hotel: item.hotel || null,
        regimen_comida: item.regimen_comida || null,
        inclusiones: item.inclusiones || null,
        precio_promo: item.precio_promo || null,
        promocion: item.promocion || null,
        contacto: item.contacto || null,
        cupos: item.cupos || 1,
        estado: 'PENDIENTE'
      }]);

      if (dbErr) log.error('SUPABASE_BORRADOR_ERR', `Error guardando borrador ${i + 1}:`, dbErr);

      resumenAdmin += `*Oferta #${i + 1}:*\n` +
        `• *Destino:* ${item.destino || 'N/A'}\n` +
        `• *Fecha:* ${item.fecha_salida || 'A confirmar'}\n` +
        `• *Hotel:* ${item.hotel || 'No especificado'}\n` +
        `• *Régimen:* ${item.regimen_comida || 'Sin especificar'}\n` +
        `• *Precio:* ${item.precio_promo ? '$' + item.precio_promo : 'A consultar'}\n` +
        `• *Promo:* ${item.promocion || 'Ninguna'}\n\n`;
    }

    resumenAdmin += `✅ Todas fueron guardadas en *ofertas_borrador* para revisión.`;

    await zernioService.sendZernioMessage(phoneNumber, resumenAdmin);
    log.success('CALLBACK_DONE', `Flujo de afiche completado y notificado a ${phoneNumber}`);

  } catch (err) {
    log.error('CALLBACK_ERR', 'Error procesando los datos del callback de Python:', err);
  }
}

module.exports = {
  handleZernioWebhook,
  handleFlyerCompleted
};