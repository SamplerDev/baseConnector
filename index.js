const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

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
log.info('STARTUP', 'Ruta del archivo .env:', envPath);

const PORT = process.env.PORT || 3000;
const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;
const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://localhost:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const ZERNIO_ACCOUNT_ID = process.env.ZERNIO_ACCOUNT_ID;
const ZERNIO_WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET;

// Diagnóstico inicial de variables
log.info('ENV_CHECK', 'Estado de variables cargadas:', {
  PORT,
  ADMIN_PHONE: ADMIN_PHONE ? '✅ Configurado' : '❌ Faltante',
  PYTHON_AI_URL,
  INTERNAL_API_KEY: INTERNAL_API_KEY ? '✅ Configurada' : '❌ Faltante',
  ADMIN_SECRET_KEY: ADMIN_SECRET_KEY ? '✅ Configurada' : '❌ Faltante',
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
app.use(cors());

// Guardar buffer crudo para la verificación HMAC de Zernio
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Middleware Global de Monitorización de Peticiones HTTP Entrantes
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
// CLIENTE AXIOS PARA PYTHON (RENDER) CON LOGS DE TIEMPO
// ==================================================================
const pythonClient = axios.create({
  baseURL: PYTHON_AI_URL,
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

// ==================================================================
// FUNCIÓN AUXILIAR: Enviar Mensajes a través de Zernio API
// ==================================================================
async function sendZernioMessage(target, text) {
  // Verificar si target es un conversationId (hexadecimal de 24 caracteres) o un teléfono
  const isConversationId = typeof target === 'string' && target.length === 24 && !target.startsWith('+');

  let endpoint = '';
  let payload = {};

  if (isConversationId) {
    // A. Envío directo dentro de una conversación activa
    endpoint = `https://zernio.com/api/v1/inbox/conversations/${target}/messages`;
    payload = {
      accountId: ZERNIO_ACCOUNT_ID,
      message: text
    };
  } else {
    // B. Envío por número de teléfono (por ejemplo: ADMIN_PHONE o mensaje manual)
    const participantId = String(target).replace(/\D/g, ''); // Deja solo dígitos
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
        }
      }
    );
    const duration = Date.now() - startTime;
    log.success('ZERNIO_SEND_OK', `Mensaje entregado a [${target}] en ${duration}ms`, response.data);
    return response.data;
  } catch (err) {
    log.error('ZERNIO_SEND_ERR', `Falla enviando a [${target}]`, err.response?.data || err.message);
  }
}
// ==================================================================
// MIDDLEWARES DE SEGURIDAD
// ==================================================================

// 1. Verificación de firma del Webhook de Zernio (HMAC-SHA256)
function verifyZernioSignature(req, res, next) {
  log.info('AUTH_ZERNIO', 'Evaluando firma HMAC del Webhook...');
  
  if (!ZERNIO_WEBHOOK_SECRET) {
    log.warn('AUTH_ZERNIO', 'ZERNIO_WEBHOOK_SECRET no configurado. Saltando validación de firma.');
    return next();
  }

  const signature = req.headers['x-zernio-signature'] || req.headers['x-late-signature'];
  log.info('AUTH_ZERNIO', 'Encabezado de firma recibido:', signature);

  if (!signature) {
    log.error('AUTH_ZERNIO', 'Rechazado: Encabezado de firma ausente.');
    return res.status(401).json({ error: 'Encabezado X-Zernio-Signature/X-Late-Signature ausente' });
  }

  const expectedHash = crypto
    .createHmac('sha256', ZERNIO_WEBHOOK_SECRET)
    .update(req.rawBody || '')
    .digest('hex');

  log.info('AUTH_ZERNIO', `Hash calculado: ${expectedHash} | Recibido: ${signature}`);

  if (signature !== expectedHash) {
    log.error('AUTH_ZERNIO', 'Rechazado: La firma HMAC no coincide con el secreto local.');
    return res.status(403).json({ error: 'Firma de Zernio inválida' });
  }

  log.success('AUTH_ZERNIO', 'Firma de Zernio validada con éxito.');
  next();
}

// 2. Seguridad para Endpoints Administrativos
function requireAdminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  log.info('AUTH_ADMIN', 'Validando acceso administrativo...');

  if (!ADMIN_SECRET_KEY || adminKey !== ADMIN_SECRET_KEY) {
    log.warn('AUTH_ADMIN', 'Acceso denegado: X-Admin-Key incorrecta o no enviada.');
    return res.status(401).json({ ok: false, error: 'No autorizado: X-Admin-Key inválida o ausente' });
  }

  log.success('AUTH_ADMIN', 'Autenticación administrativa concedida.');
  next();
}

// ==================================================================
// FUNCIONES AUXILIARES: Deduplicación en Supabase
// ==================================================================
async function isMessageProcessed(eventId) {
  if (!supabase || !eventId) return false;
  log.info('DEDUP_CHECK', `Verificando evento en Supabase: ${eventId}`);
  
  const { data, error } = await supabase
    .from('mensajes_procesados')
    .select('message_id')
    .eq('message_id', eventId)
    .maybeSingle();

  if (error) {
    log.error('DEDUP_ERR', `Error consultando mensajes_procesados para ${eventId}`, error);
    return false;
  }

  const processed = !!data;
  log.info('DEDUP_RESULT', `¿El evento ${eventId} ya fue procesado?: ${processed}`);
  return processed;
}

async function markMessageAsProcessed(eventId) {
  if (!supabase || !eventId) return;
  log.info('DEDUP_MARK', `Registrando evento como procesado en Supabase: ${eventId}`);
  
  const { error } = await supabase
    .from('mensajes_procesados')
    .insert([{ message_id: eventId }]);

  if (error) {
    log.error('DEDUP_MARK_ERR', `Error marcando evento ${eventId} como procesado`, error);
  } else {
    log.success('DEDUP_MARK_OK', `Evento ${eventId} guardado en mensajes_procesados.`);
  }
}

// ==================================================================
// 1. HEALTHCHECK
// ==================================================================
app.get('/health', async (req, res) => {
  log.info('HEALTH', 'Ejecutando Healthcheck...');
  try {
    if (!supabase) {
      log.error('HEALTH', 'Falla en Healthcheck: Supabase no inicializado.');
      return res.status(500).json({ status: 'Error', message: 'Variables de Supabase faltantes' });
    }

    log.info('HEALTH', 'Pingo a Supabase (ofertas_publicadas)...');
    const { data, error } = await supabase
      .from('ofertas_publicadas')
      .select('count', { count: 'exact' });

    if (error) throw error;
    log.success('HEALTH', `Supabase respondiendo OK. Total ofertas en BD:`, data);

    let pythonStatus = 'Desconocido';
    try {
      log.info('HEALTH', 'Pingo a servicio Python en Render...');
      const pyHealth = await pythonClient.get('/health');
      pythonStatus = pyHealth.data.status;
    } catch (e) {
      pythonStatus = `Error conectando con Render: ${e.message}`;
      log.warn('HEALTH', pythonStatus);
    }

    const healthResponse = {
      status: 'OK',
      provider: 'Zernio API',
      database: 'Supabase Conectado Correctamente',
      total_ofertas: data,
      python_service: pythonStatus
    };

    log.success('HEALTH', 'Healthcheck completado con éxito:', healthResponse);
    res.status(200).json(healthResponse);
  } catch (err) {
    log.error('HEALTH_ERR', 'Error durante el Healthcheck', err);
    res.status(500).json({ status: 'Error', details: err.message });
  }
});

// ==================================================================
// 2. WEBHOOK ZERNIO: Recepción de Eventos
// ==================================================================
app.post('/webhook', verifyZernioSignature, async (req, res) => {
  log.info('WEBHOOK_IN', 'Payload completo recibido en /webhook:', req.body);

  // Respuesta inmediata 200 OK a Zernio
  res.status(200).send({ status: 'RECEIVED' });
  log.info('WEBHOOK_ACK', 'Respuesta 200 OK enviada inmediatamente a Zernio.');

  setImmediate(async () => {
    try {
      const payload = req.body;
      const eventId = payload.id || req.headers['x-zernio-event-id'] || req.headers['x-late-event-id'];

      log.info('WEBHOOK_PROC', `Procesando evento asíncrono [ID: ${eventId}]`);

      // Filtrado por tipo de evento
      if (payload.event && payload.event !== 'message.received' && payload.event !== 'dm.received') {
        log.warn('WEBHOOK_SKIP', `Evento ignorado por no ser de mensaje: ${payload.event}`);
        return;
      }

      // Deduplicación
      if (await isMessageProcessed(eventId)) {
        log.warn('WEBHOOK_DEDUP', `⚠️ Evento duplicado omitido [ID: ${eventId}]`);
        return;
      }
      await markMessageAsProcessed(eventId);

      // Normalización del mensaje
      const messageData = payload.message || payload.data || payload;
      const fromNumber = messageData.sender?.phoneNumber || messageData.from || messageData.sender;
      const textBody = messageData.text || messageData.message || messageData.body || messageData.caption;
      const conversationId = messageData.conversationId || payload.conversation?.id;
// I

      log.info('WEBHOOK_PARSED', 'Datos de mensaje extraídos:', {
        fromNumber,
        textBody,
        hasAttachments: Boolean(messageData.attachments && messageData.attachments.length)
      });

      if (!fromNumber || !textBody) {
        log.warn('WEBHOOK_ABORT', 'No se detectó remitente o texto. Abortando flujo.');
        return;
      }

      // Consulta de estado de la conversación (Human Takeover)
      log.info('SUPABASE_QUERY', `Consultando bot_activo para el teléfono: ${fromNumber}`);
      const { data: conv, error: convErr } = await supabase
        .from('conversaciones')
        .select('bot_activo')
        .eq('phone_number', fromNumber)
        .maybeSingle();

      if (convErr) log.error('SUPABASE_ERR', 'Error buscando conversación', convErr);

      const botActivo = conv ? conv.bot_activo : true;
      log.info('BOT_STATUS', `Estado del bot para ${fromNumber}: ${botActivo ? 'ACTIVADO' : 'PAUSADO'}`);

      // Registrar mensaje en el historial del usuario
      log.info('SUPABASE_INSERT', `Guardando mensaje del usuario en chat_sesiones...`);
      await supabase.from('chat_sesiones').insert([{
        phone_number: fromNumber,
        role: 'user',
        content: textBody
      }]);

      // A. RESPUESTA DEL ADMINISTRADOR (Confirmación de ticket con #ID)
      if (fromNumber === ADMIN_PHONE && textBody.includes('#')) {
        log.info('ADMIN_FLOW', `Detectado mensaje de confirmación de ticket por Admin (${fromNumber}): ${textBody}`);
        await axios.post(`http://localhost:${PORT}/api/webhook/admin-respuesta`, {
          admin_phone: fromNumber,
          admin_message: textBody
        });
      }
      // B. CONSULTA DEL CLIENTE (Si el bot está activo)
      else if (botActivo) {
        log.info('CLIENT_FLOW', `Iniciando consulta de catálogo en Supabase...`);
        const { data: catalogo, error: catErr } = await supabase
          .from('ofertas_publicadas')
          .select('id, destino, fecha_salida, descripcion, contacto, cupos')
          .eq('activo', true)
          .gt('cupos', 0);

        if (catErr) log.error('SUPABASE_CATALOG_ERR', 'Error obteniendo catálogo', catErr);
        log.info('CATALOG_LOADED', `Ofertas activas encontradas: ${catalogo ? catalogo.length : 0}`);

        // Llamada a Gemini 2.5 Flash en Render
        log.info('AI_AGENT', 'Enviando contexto y pregunta del cliente a Render (/agent/chat)...');
        const aiResponse = await pythonClient.post('/agent/chat', {
          user_message: textBody,
          travel_catalog: catalogo || [],
          history: []
        });

        const respuestaIA = aiResponse.data.response;
        log.success('AI_AGENT_RES', 'Respuesta generada por Gemini:', respuestaIA);

        // Guardar respuesta de IA en el historial
        log.info('SUPABASE_INSERT', 'Guardando respuesta de IA en chat_sesiones...');
        await supabase.from('chat_sesiones').insert([{
          phone_number: fromNumber,
          role: 'assistant',
          content: respuestaIA
        }]);

        // Enviar respuesta al cliente vía Zernio
        await sendZernioMessage(conversationId || fromNumber, respuestaIA);
      } else {
        log.warn('BOT_PAUSED', `El bot está pausado para ${fromNumber}. No se generó respuesta automática.`);
      }
    } catch (err) {
      log.error('WEBHOOK_PROC_ERR', 'Error grave durante el procesamiento del Webhook', err);
    }
  });
});

// ==================================================================
// 3. RUTAS PÚBLICAS
// ==================================================================
app.get('/api/catalogo-activo', async (req, res) => {
  log.info('API_PUBLIC', 'Solicitud recibida en /api/catalogo-activo');
  try {
    const { data, error } = await supabase
      .from('ofertas_publicadas')
      .select('id, destino, fecha_salida, descripcion, contacto, cupos')
      .eq('activo', true)
      .gt('cupos', 0)
      .order('fecha_salida', { ascending: true });

    if (error) throw error;
    log.success('API_PUBLIC', `Catálogo entregado. Total ítems: ${data.length}`);
    res.status(200).json({ ok: true, catalogo: data });
  } catch (err) {
    log.error('API_PUBLIC_ERR', 'Error en /api/catalogo-activo', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================================================================
// 4. RUTAS ADMINISTRATIVAS DEL DASHBOARD (Protegidas)
// ==================================================================
app.use('/api/admin', requireAdminAuth);

app.get('/api/admin/conversaciones', async (req, res) => {
  log.info('ADMIN_ROUTE', 'GET /api/admin/conversaciones');
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('*, chat_sesiones(*)')
      .order('ultimo_mensaje', { ascending: false });

    if (error) throw error;
    log.success('ADMIN_ROUTE', `Conversaciones obtenidas: ${data.length}`);
    res.status(200).json({ ok: true, conversaciones: data });
  } catch (err) {
    log.error('ADMIN_ROUTE_ERR', 'Error obteniendo conversaciones', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/admin/toggle-bot', async (req, res) => {
  const { phone_number, bot_activo } = req.body;
  log.info('ADMIN_ROUTE', `PATCH /api/admin/toggle-bot - Tel: ${phone_number}, Nuevo Estado: ${bot_activo}`);
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .update({ bot_activo })
      .eq('phone_number', phone_number)
      .select();

    if (error) throw error;
    log.success('ADMIN_ROUTE', `Estado del bot actualizado para ${phone_number}`, data);
    res.status(200).json({ ok: true, estado: data });
  } catch (err) {
    log.error('ADMIN_ROUTE_ERR', 'Error en toggle-bot', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/enviar-mensaje-manual', async (req, res) => {
  const { phone_number, mensaje } = req.body;
  log.info('ADMIN_ROUTE', `POST /api/admin/enviar-mensaje-manual - Tel: ${phone_number}`, { mensaje });
  try {
    await sendZernioMessage(phone_number, mensaje);

    log.info('SUPABASE_INSERT', 'Guardando mensaje manual humano en chat_sesiones...');
    await supabase.from('chat_sesiones').insert([{
      phone_number,
      role: 'human',
      content: mensaje
    }]);

    log.info('SUPABASE_UPDATE', 'Pausando el bot para intervención humana...');
    await supabase.from('conversaciones').update({
      bot_activo: false,
      ultimo_mensaje: new Date()
    }).eq('phone_number', phone_number);

    log.success('ADMIN_ROUTE', `Mensaje manual procesado para ${phone_number}`);
    res.status(200).json({ ok: true, mensaje: 'Mensaje enviado manualmente' });
  } catch (err) {
    log.error('ADMIN_ROUTE_ERR', 'Error en envío manual', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================================================================
// 5. DOBLE CONFIRMACIÓN DE TICKETS
// ==================================================================
app.post('/api/solicitar-confirmacion-doble', async (req, res) => {
  const { client_phone, viaje_id, destino } = req.body;
  log.info('CONFIRM_DOUBLE', 'Solicitud de doble confirmación recibida:', req.body);
  try {
    const { data: ticket, error } = await supabase
      .from('tickets_disponibilidad')
      .insert([{ client_phone, viaje_id, estado: 'ESPERANDO_ADMIN' }])
      .select()
      .single();

    if (error) throw error;
    log.success('CONFIRM_DOUBLE', `Ticket creado en BD [ID: #${ticket.id}]`);

    const mensajeAdmin = `⚠️ *SOLICITUD DE DOBLE CONFIRMACIÓN*\n\n` +
      `Ticket ID: #${ticket.id}\n` +
      `Cliente: ${client_phone}\n` +
      `Viaje: ${destino} (ID: ${viaje_id})\n\n` +
      `¿Confirmas disponibilidad en tiempo real?\n` +
      `Responde *"SI #${ticket.id}"* o *"NO #${ticket.id}"*.`;

    await sendZernioMessage(ADMIN_PHONE, mensajeAdmin);

    res.status(200).json({
      ok: true,
      ticket_id: ticket.id,
      respuesta_cliente: 'Estamos verificando la disponibilidad exacta con la oficina central.'
    });
  } catch (err) {
    log.error('CONFIRM_DOUBLE_ERR', 'Error en solicitar-confirmacion-doble', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/webhook/admin-respuesta', async (req, res) => {
  const { admin_phone, admin_message } = req.body;
  log.info('ADMIN_REPLY', `Respuesta del Admin recibida (${admin_phone}):`, admin_message);

  if (ADMIN_PHONE && admin_phone !== ADMIN_PHONE) {
    log.warn('ADMIN_REPLY_DENIED', `Teléfono no autorizado intentó responder ticket: ${admin_phone}`);
    return res.status(403).json({ ok: false, message: 'Número no autorizado' });
  }

  try {
    const match = admin_message.match(/#(\d+)/);
    if (!match) {
      log.warn('ADMIN_REPLY_INVALID', 'No se encontró el ID del ticket (#ID) en el mensaje.');
      return res.status(400).json({ ok: false, message: 'ID de ticket no encontrado' });
    }

    const ticket_id = match[1];
    log.info('ADMIN_REPLY_MATCH', `Procesando Ticket ID: #${ticket_id}`);

    log.info('AI_AGENT', 'Evaluando decisión del Admin con Render (/agent/confirm)...');
    const aiResponse = await pythonClient.post('/agent/confirm', {
      admin_message: admin_message
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

    let mensajeCliente = nuevoEstado === 'CONFIRMADO'
      ? `🎉 ¡Buenas noticias! Confirmamos disponibilidad para tu viaje a *${ticket.ofertas_publicadas.destino}*. ¿Deseas proceder con la reserva?`
      : `Lamentablemente no contamos con lugares disponibles para *${ticket.ofertas_publicadas.destino}* en este momento.`;

    await sendZernioMessage(ticket.client_phone, mensajeCliente);

    log.success('ADMIN_REPLY_OK', `Flujo de doble confirmación completado para ticket #${ticket_id}`);
    res.status(200).json({ ok: true, ticket_id, nuevoEstado });
  } catch (err) {
    log.error('ADMIN_REPLY_ERR', 'Error procesando respuesta del Admin', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================================================================
// ARRANCAR SERVIDOR
// ==================================================================
app.listen(PORT, () => {
  log.success('SERVER_BOOT', `🚀 Servidor Express activo en puerto ${PORT} (Integrado con Zernio API)`);
});