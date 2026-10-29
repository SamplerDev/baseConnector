const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Carga de variables de entorno con trazabilidad
const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath });

// ==================================================================
// SISTEMA DE LOGGING ESTRUCTURADO CON MARCAS DE TIEMPO
// ==================================================================
const log = {
  info: (tag, msg, data = null) => {
    console.log(`[${new Date().toISOString()}] ℹ️  [${tag}] ${msg}`, data ? '\n' + JSON.stringify(data, null, 2) : '');
  },
  success: (tag, msg, data = null) => {
    console.log(`[${new Date().toISOString()}] ✅ [${tag}] ${msg}`, data ? '\n' + JSON.stringify(data, null, 2) : '');
  },
  warn: (tag, msg, data = null) => {
    console.warn(`[${new Date().toISOString()}] ⚠️  [${tag}] ${msg}`, data ? '\n' + JSON.stringify(data, null, 2) : '');
  },
  error: (tag, msg, error = null) => {
    console.error(`[${new Date().toISOString()}] ❌ [${tag}] ${msg}`, error ? '\n' + (error.stack || JSON.stringify(error, null, 2)) : '');
  }
};

log.info('STARTUP', 'Iniciando servidor Node.js y verificando variables de entorno...');

const PORT = process.env.PORT || 3000;
const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;
const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://localhost:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const ZERNIO_ACCOUNT_ID = process.env.ZERNIO_ACCOUNT_ID;
const ZERNIO_WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET;

// Diagnóstico inicial de variables
log.info('ENV_CHECK', 'Estado de variables cargadas:', {
  PORT,
  ADMIN_PHONE: ADMIN_PHONE ? '✅ Configurado' : '❌ Faltante',
  PYTHON_AI_URL,
  INTERNAL_API_KEY: INTERNAL_API_KEY ? '✅ Configurada' : '❌ Faltante',
  ZERNIO_API_KEY: ZERNIO_API_KEY ? '✅ Configurada' : '❌ Faltante',
  ZERNIO_ACCOUNT_ID: ZERNIO_ACCOUNT_ID ? '✅ Configurado' : '❌ Faltante',
  ZERNIO_WEBHOOK_SECRET: ZERNIO_WEBHOOK_SECRET ? '✅ Configurado' : '⚠️ Omitido / No configurado'
});

const supabase = require('./db');
if (!supabase) {
  log.error('SUPABASE', 'Error crítico: No se pudo instanciar el cliente de Supabase.');
} else {
  log.success('SUPABASE', 'Cliente de Supabase cargado correctamente.');
}

const app = express();

// Confiar en el proxy inverso de Hostinger (LiteSpeed)
app.set('trust proxy', 1);

// Protecciones de seguridad HTTP y Rate Limit
app.use(helmet());
app.use(cors());

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones desde esta IP' }
});
app.use(apiLimiter);

// Guardar buffer crudo para la verificación HMAC de Zernio
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Middleware Global de Monitorización
app.use((req, res, next) => {
  const start = Date.now();
  log.info('HTTP_IN', `--> ${req.method} ${req.url} [IP: ${req.ip}]`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    log.info('HTTP_OUT', `<-- ${req.method} ${req.url} ${res.statusCode} [${duration}ms]`);
  });
  next();
});

// ==================================================================
// CLIENTE AXIOS PARA PYTHON (RENDER) CON LOGS Y KEEP-ALIVE
// ==================================================================
const pythonClient = axios.create({
  baseURL: PYTHON_AI_URL,
  timeout: 60000, // Timeout de 60s para tolerar el cold start de Render
  headers: {
    'X-API-Key': INTERNAL_API_KEY,
    'Content-Type': 'application/json'
  }
});

pythonClient.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  log.info('PYTHON_REQ', `[Render] -> ${config.method.toUpperCase()} ${config.baseURL}${config.url}`, config.data);
  return config;
}, (err) => {
  log.error('PYTHON_REQ_ERR', 'Error en la preparación de solicitud a Python', err);
  return Promise.reject(err);
});

pythonClient.interceptors.response.use((response) => {
  const duration = Date.now() - response.config.metadata.startTime;
  log.success('PYTHON_RES', `[Render] <- ${response.status} OK [${duration}ms]`, response.data);
  return response;
}, (err) => {
  const duration = err.config?.metadata ? Date.now() - err.config.metadata.startTime : 0;
  log.error('PYTHON_RES_ERR', `[Render] Error en llamada a Python [${duration}ms]`, err.response?.data || err.message);
  return Promise.reject(err);
});

// Mantener despierto el microservicio de Render enviando un ping cada 10 minutos
setInterval(async () => {
  try {
    await pythonClient.get('/health');
    log.info('KEEP_ALIVE', 'Ping de mantenimiento enviado a Render');
  } catch (err) {
    log.warn('KEEP_ALIVE_ERR', 'No se pudo contactar Render en el ping de mantenimiento');
  }
}, 10 * 60 * 1000);

// ==================================================================
// FUNCIÓN AUXILIAR: Enviar Mensajes a través de Zernio API
// ==================================================================
async function sendZernioMessage(target, text, fallbackPhone = null) {
  if (!text) return;

  // Si el texto supera los 3500 caracteres, fraccionar y enviar por partes
  if (text.length > 3500) {
    const chunks = splitTextIntoChunks(text, 3500);
    log.info('ZERNIO_SPLIT', `Mensaje de ${text.length} caracteres dividido en ${chunks.length} partes.`);

    for (let i = 0; i < chunks.length; i++) {
      const isLastPart = i === chunks.length - 1;
      const chunkText = `${chunks[i]}${chunks.length > 1 ? `\n\n_(Parte ${i + 1} de ${chunks.length})_` : ''}`;

      await sendSingleZernioMessage(target, chunkText, fallbackPhone);

      // Esperar 800ms entre mensajes para garantizar el orden de entrega en WhatsApp
      if (!isLastPart) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
    return;
  }

  return await sendSingleZernioMessage(target, text, fallbackPhone);
}

// Función interna que realiza la Petición HTTP a Zernio
async function sendSingleZernioMessage(target, text, fallbackPhone = null) {
  const isConversationId = typeof target === 'string' && target.length === 24 && !target.startsWith('+');

  let endpoint = '';
  let payload = {};

  if (isConversationId) {
    endpoint = `https://zernio.com/api/v1/inbox/conversations/${target}/messages`;
    payload = {
      accountId: ZERNIO_ACCOUNT_ID,
      message: text
    };
  } else {
    const participantId = String(target).replace(/\D/g, '');
    endpoint = `https://zernio.com/api/v1/inbox/conversations`;
    payload = {
      accountId: ZERNIO_ACCOUNT_ID,
      participantId: participantId,
      message: text
    };
  }

  log.info('ZERNIO_SEND', `Iniciando envío a [${target}]...`, payload);

  try {
    const startTime = Date.now();
    const response = await axios.post(
      endpoint,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${ZERNIO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    const duration = Date.now() - startTime;
    log.success('ZERNIO_SEND_OK', `Mensaje entregado a [${target}] en ${duration}ms`, response.data);
    return response.data;
  } catch (err) {
    const errData = err.response?.data;
    log.error('ZERNIO_SEND_ERR', `Falla enviando a [${target}]`, errData || err.message);

    if (isConversationId && (errData?.code === 'CONVERSATION_NOT_FOUND' || err.response?.status === 404)) {
      const phoneToUse = fallbackPhone || target;
      log.warn('ZERNIO_FALLBACK', `Reintentando envío a través de participantId (teléfono: ${phoneToUse})...`);
      return sendSingleZernioMessage(phoneToUse, text);
    }
  }
}

// ==================================================================
// MIDDLEWARES DE SEGURIDAD
// ==================================================================

// 1. Verificación HMAC segura contra timing attacks (Webhooks Zernio)
function verifyZernioSignature(req, res, next) {
  log.info('AUTH_ZERNIO', 'Evaluando firma HMAC del Webhook...');
  
  if (!ZERNIO_WEBHOOK_SECRET) {
    log.warn('AUTH_ZERNIO', 'ZERNIO_WEBHOOK_SECRET no configurado. Saltando validación de firma.');
    return next();
  }

  const signature = req.headers['x-zernio-signature'] || req.headers['x-late-signature'];

  if (!signature) {
    log.error('AUTH_ZERNIO', 'Rechazado: Encabezado de firma ausente.');
    return res.status(401).json({ error: 'Encabezado X-Zernio-Signature/X-Late-Signature ausente' });
  }

  const expectedHash = crypto
    .createHmac('sha256', ZERNIO_WEBHOOK_SECRET)
    .update(req.rawBody || '')
    .digest('hex');

  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedHash);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    log.error('AUTH_ZERNIO', 'Rechazado: La firma HMAC no coincide con el secreto local.');
    return res.status(403).json({ error: 'Firma de Zernio inválida' });
  }

  log.success('AUTH_ZERNIO', 'Firma de Zernio validada con éxito.');
  next();
}

// 2. Middleware para verificar que la petición proviene de un Admin autenticado con 2FA en Supabase
async function requireSupabaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token de acceso no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  // Validar el token con Supabase
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ ok: false, error: 'Sesión no válida o expirada' });
  }

  // Verificar el claim 'aal' del JWT para confirmar que se completó el segundo factor (TOTP)
  try {
    const payloadBase64 = token.split('.')[1];
    const decodedJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
    const jwtPayload = JSON.parse(decodedJson);

    if (jwtPayload.aal !== 'aal2') {
      return res.status(403).json({ ok: false, error: 'Se requiere verificación de doble factor (2FA)' });
    }
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Formato de token de autenticación inválido' });
  }

  req.user = user;
  next();
}

// Proteger todas las rutas de /api/admin centralizadamente con Supabase 2FA
app.use('/api/admin', requireSupabaseAuth);

// ==================================================================
// LÓGICA DE NEGOCIO: Procesar Respuesta del Admin (Tickets)
// ==================================================================
async function procesarRespuestaAdmin(adminPhone, adminMessage) {
  if (ADMIN_PHONE && String(adminPhone).replace(/\D/g, '') !== String(ADMIN_PHONE).replace(/\D/g, '')) {
    log.warn('ADMIN_REPLY_DENIED', `Teléfono no autorizado intentó responder ticket: ${adminPhone}`);
    throw new Error('Número no autorizado');
  }

  const match = adminMessage.match(/#(\d+)/);
  if (!match) {
    log.warn('ADMIN_REPLY_INVALID', 'No se encontró el ID del ticket (#ID) en el mensaje.');
    throw new Error('ID de ticket no encontrado en el mensaje (#ID)');
  }

  const ticket_id = match[1];
  log.info('ADMIN_REPLY_MATCH', `Procesando Ticket ID: #${ticket_id}`);

  log.info('AI_AGENT', 'Evaluando decisión del Admin con Render (/agent/confirm)...');
  const aiResponse = await pythonClient.post('/agent/confirm', {
    admin_message: adminMessage
  });

  const accion = aiResponse.data.accion;
  const nuevoEstado = (accion === 'APROBAR') ? 'CONFIRMADO' : 'RECHAZAR';
  log.info('ADMIN_REPLY_DECISION', `Decisión parseada: ${accion} -> Nuevo Estado: ${nuevoEstado}`);

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

  await sendZernioMessage(ticket.client_phone, mensajeCliente);
  log.success('ADMIN_REPLY_OK', `Flujo de doble confirmación completado para ticket #${ticket_id}`);

  return { ticket_id, nuevoEstado };
}

// ==================================================================
// FUNCIONES AUXILIARES: Deduplicación en Supabase
// ==================================================================
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
    log.error('DEDUP_MARK_ERR', `Error marcando evento ${eventId} como procesado`, error);
  } else {
    log.success('DEDUP_MARK_OK', `Evento ${eventId} guardado en mensajes_procesados.`);
  }
}

function splitTextIntoChunks(text, maxChunkSize = 3500) {
  if (!text || text.length <= maxChunkSize) return [text];

  const chunks = [];
  let currentChunk = '';
  const lines = text.split('\n');

  for (const line of lines) {
    // Si agregar esta línea supera el límite del fragmento actual
    if ((currentChunk + '\n' + line).length > maxChunkSize) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Si una sola línea/párrafo supera el máximo, dividir por palabras
      if (line.length > maxChunkSize) {
        const words = line.split(' ');
        for (const word of words) {
          if ((currentChunk + ' ' + word).length > maxChunkSize) {
            chunks.push(currentChunk.trim());
            currentChunk = word;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + word;
          }
        }
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}



// ==================================================================
// 1. HEALTHCHECK
// ==================================================================
app.get('/health', async (req, res) => {
  log.info('HEALTH', 'Ejecutando Healthcheck...');
  try {
    if (!supabase) {
      return res.status(500).json({ status: 'Error', message: 'Variables de Supabase faltantes' });
    }

    const { data, error } = await supabase
      .from('ofertas_publicadas')
      .select('count', { count: 'exact' });

    if (error) throw error;

    let pythonStatus = 'Desconocido';
    try {
      const pyHealth = await pythonClient.get('/health');
      pythonStatus = pyHealth.data.status;
    } catch (e) {
      pythonStatus = `Error conectando con Render: ${e.message}`;
    }

    res.status(200).json({
      status: 'OK',
      provider: 'Zernio API',
      database: 'Supabase Conectado Correctamente',
      total_ofertas: data,
      python_service: pythonStatus
    });
  } catch (err) {
    log.error('HEALTH_ERR', 'Error durante el Healthcheck', err);
    res.status(500).json({ status: 'Error', details: err.message });
  }
});

// ==================================================================
// 2. WEBHOOK ZERNIO: Recepción de Eventos y Mensajes
// ==================================================================
app.post('/webhook', verifyZernioSignature, async (req, res) => {
  log.info('WEBHOOK_IN', 'Payload completo recibido en /webhook:', req.body);

  res.status(200).send({ status: 'RECEIVED' });

  setImmediate(async () => {
    try {
      const payload = req.body;
      const eventId = payload.id || req.headers['x-zernio-event-id'] || req.headers['x-late-event-id'];

      if (payload.event && payload.event !== 'message.received' && payload.event !== 'dm.received') {
        return;
      }

      if (await isMessageProcessed(eventId)) {
        log.warn('WEBHOOK_DEDUP', `⚠️ Evento duplicado omitido [ID: ${eventId}]`);
        return;
      }
      await markMessageAsProcessed(eventId);

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
      const cleanAdmin = String(ADMIN_PHONE).replace(/\D/g, '');
      const isAdmin = cleanFrom === cleanAdmin;

      // FLUJO ADMINISTRADOR
      if (isAdmin) {
        if (textBody && textBody.includes('#')) {
          log.info('ADMIN_FLOW', `Procesando confirmación de ticket desde función interna...`);
          await procesarRespuestaAdmin(fromNumber, textBody);
        } else {
          log.info('ADMIN_FLYER', `Nueva promo/flyer recibida de Admin (${fromNumber})...`);

          const targetId = conversationId || fromNumber;
          await sendZernioMessage(targetId, "⏳ *Analizando afiche con IA (Buscando ofertas)...*", fromNumber);

          let imageBase64 = null;
          let mimeType = 'image/jpeg';

          if (mediaUrl) {
            try {
              const mediaResponse = await axios.get(mediaUrl, {
                headers: { 'Authorization': `Bearer ${ZERNIO_API_KEY}` },
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
      } 
      // FLUJO CLIENTE
      else {
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

          await sendZernioMessage(conversationId || fromNumber, respuestaIA, fromNumber);
        }
      }
    } catch (err) {
      log.error('WEBHOOK_PROC_ERR', 'Error durante el procesamiento del Webhook', err);
    }
  });
});

// ==================================================================
// 3. RUTAS PÚBLICAS
// ==================================================================
app.get('/api/catalogo-activo', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ofertas_publicadas')
      .select('id, destino, fecha_salida, descripcion, contacto, cupos')
      .eq('activo', true)
      .gt('cupos', 0)
      .order('fecha_salida', { ascending: true });

    if (error) throw error;
    res.status(200).json({ ok: true, catalogo: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/webhook/admin-respuesta', async (req, res) => {
  const { admin_phone, admin_message } = req.body;
  try {
    const resultado = await procesarRespuestaAdmin(admin_phone, admin_message);
    res.status(200).json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ==================================================================
// 4. RUTAS ADMINISTRATIVAS PROTEGIDAS (Supabase 2FA Token)
// ==================================================================
app.get('/api/admin/conversaciones', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('*, chat_sesiones(*)')
      .order('ultimo_mensaje', { ascending: false });

    if (error) throw error;
    res.status(200).json({ ok: true, conversaciones: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/admin/toggle-bot', async (req, res) => {
  const { phone_number, bot_activo } = req.body;
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .update({ bot_activo })
      .eq('phone_number', phone_number)
      .select();

    if (error) throw error;
    res.status(200).json({ ok: true, estado: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/enviar-mensaje-manual', async (req, res) => {
  const { phone_number, mensaje } = req.body;
  try {
    await sendZernioMessage(phone_number, mensaje);

    await supabase.from('chat_sesiones').insert([{
      phone_number,
      role: 'human',
      content: mensaje
    }]);

    await supabase.from('conversaciones').update({
      bot_activo: false,
      ultimo_mensaje: new Date()
    }).eq('phone_number', phone_number);

    res.status(200).json({ ok: true, mensaje: 'Mensaje enviado manualmente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/borradores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ofertas_borrador')
      .select('*')
      .eq('estado', 'PENDIENTE')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ ok: true, borradores: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/aprobar-borrador/:id', async (req, res) => {
  const { id } = req.params;
  const datosEditados = req.body;

  try {
    const { data: ofertaPublicada, error: pubErr } = await supabase
      .from('ofertas_publicadas')
      .insert([{
        destino: datosEditados.destino,
        fecha_salida: datosEditados.fecha_salida,
        duracion: datosEditados.duracion,
        hotel: datosEditados.hotel,
        regimen_comida: datosEditados.regimen_comida,
        inclusiones: datosEditados.inclusiones,
        precio_promo: datosEditados.precio_promo,
        promocion: datosEditados.promocion,
        contacto: datosEditados.contacto,
        cupos: datosEditados.cupos || 1,
        activo: true
      }])
      .select()
      .single();

    if (pubErr) throw pubErr;

    await supabase
      .from('ofertas_borrador')
      .update({ estado: 'APROBADO' })
      .eq('id', id);

    res.json({ ok: true, mensaje: 'Oferta validada y publicada con éxito', oferta: ofertaPublicada });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/admin/borrador/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('ofertas_borrador')
      .update({ estado: 'RECHAZADO' })
      .eq('id', id);

    if (error) throw error;
    res.json({ ok: true, mensaje: 'Borrador descartado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================================================================
// 5. CALLBACK DESDE PYTHON (Resultado de Ofertas)
// ==================================================================
app.post('/api/webhooks/flyer-completed', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : req.headers['x-api-key'];

  if (INTERNAL_API_KEY && token !== INTERNAL_API_KEY) {
    log.error('AUTH_CALLBACK_FAIL', 'Acceso rechazado en Callback: Token inválido.');
    return res.status(401).json({ error: 'No autorizado' });
  }

  res.status(200).json({ ok: true });

  const { phoneNumber, extractedData, error, message } = req.body;

  if (error) {
    await sendZernioMessage(phoneNumber, `❌ Ocurrió un error procesando la imagen: ${message || 'Error en IA'}`);
    return;
  }

  try {
    const ofertasEncontradas = extractedData?.ofertas || [];

    if (ofertasEncontradas.length === 0) {
      await sendZernioMessage(phoneNumber, "⚠️ No se detectaron ofertas de viaje claras en la imagen o texto enviado.");
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

    await sendZernioMessage(phoneNumber, resumenAdmin);
    log.success('CALLBACK_DONE', `Flujo de afiche completado y notificado a ${phoneNumber}`);

  } catch (err) {
    log.error('CALLBACK_ERR', 'Error procesando los datos del callback de Python:', err);
  }
});

// ARRANCAR SERVIDOR
app.listen(PORT, () => {
  log.success('SERVER_BOOT', `🚀 Servidor Express activo en puerto ${PORT}`);
});