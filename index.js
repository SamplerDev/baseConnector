const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const supabase = require('./db');

const app = express();
app.use(cors());

// Guardar buffer crudo para la verificación HMAC de Zernio
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const PORT = process.env.PORT || 3000;
const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;
const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://localhost:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;

// Credenciales Zernio
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const ZERNIO_ACCOUNT_ID = process.env.ZERNIO_ACCOUNT_ID;
const ZERNIO_WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET;

// Cliente de Axios para llamar al Microservicio de Python en Render
const pythonClient = axios.create({
  baseURL: PYTHON_AI_URL,
  headers: {
    'X-API-Key': INTERNAL_API_KEY,
    'Content-Type': 'application/json'
  }
});

// ==================================================================
// FUNCIÓN AUXILIAR: Enviar Mensajes a través de Zernio API
// ==================================================================
async function sendZernioMessage(recipientPhone, text) {
  try {
    const response = await axios.post(
      'https://api.zernio.com/v1/inbox/messages',
      {
        accountId: ZERNIO_ACCOUNT_ID,
        recipient: recipientPhone,
        message: text
      },
      {
        headers: {
          'Authorization': `Bearer ${ZERNIO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Mensaje enviado a ${recipientPhone} vía Zernio [ID: ${response.data.id || 'OK'}]`);
    return response.data;
  } catch (err) {
    console.error(`❌ Error al enviar mensaje vía Zernio a ${recipientPhone}:`, err.response?.data || err.message);
  }
}

// ==================================================================
// MIDDLEWARES DE SEGURIDAD
// ==================================================================

// 1. Verificación de firma del Webhook de Zernio (X-Zernio-Signature)
function verifyZernioSignature(req, res, next) {
  if (!ZERNIO_WEBHOOK_SECRET) return next(); // Omitir en desarrollo si no está configurado

  const signature = req.headers['x-zernio-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Encabezado X-Zernio-Signature ausente' });
  }

  const expectedHash = crypto
    .createHmac('sha256', ZERNIO_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest('hex');

  if (signature !== expectedHash) {
    return res.status(403).json({ error: 'Firma de Zernio inválida' });
  }

  next();
}

// 2. Seguridad para Endpoints Administrativos del Dashboard
function requireAdminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (!ADMIN_SECRET_KEY || adminKey !== ADMIN_SECRET_KEY) {
    return res.status(401).json({ ok: false, error: 'No autorizado: X-Admin-Key inválida o ausente' });
  }
  next();
}

// ==================================================================
// FUNCIONES AUXILIARES: Deduplicación en Supabase
// ==================================================================
async function isMessageProcessed(eventId) {
  if (!supabase || !eventId) return false;
  const { data } = await supabase
    .from('mensajes_procesados')
    .select('message_id')
    .eq('message_id', eventId)
    .maybeSingle();
  return !!data;
}

async function markMessageAsProcessed(eventId) {
  if (!supabase || !eventId) return;
  await supabase
    .from('mensajes_procesados')
    .insert([{ message_id: eventId }]);
}

// ==================================================================
// 1. HEALTHCHECK
// ==================================================================
app.get('/health', async (req, res) => {
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
    res.status(500).json({ status: 'Error', details: err.message });
  }
});

// ==================================================================
// 2. WEBHOOK ZERNIO: Recepción de Eventos y Mensajes de WhatsApp
// ==================================================================
app.post('/webhook', verifyZernioSignature, async (req, res) => {
  // Responde 200 OK inmediatamente a Zernio
  res.status(200).send({ status: 'RECEIVED' });

  setImmediate(async () => {
    try {
      const payload = req.body;
      const eventId = payload.id || req.headers['x-zernio-event-id'];

      // Ignorar si no es un evento de mensaje recibido o si es duplicado
      if (payload.event && payload.event !== 'message.received' && payload.event !== 'dm.received') {
        return;
      }

      if (await isMessageProcessed(eventId)) {
        console.log(`⚠️ Evento duplicado ignorado: ${eventId}`);
        return;
      }
      await markMessageAsProcessed(eventId);

      // Extraer datos del mensaje normalizado de Zernio
      const messageData = payload.data || payload;
      const fromNumber = messageData.from || messageData.sender;
      const textBody = messageData.text || messageData.message || messageData.body;

      if (!fromNumber || !textBody) return;

      // Comprobar estado de la conversación (Human Takeover)
      const { data: conv } = await supabase
        .from('conversaciones')
        .select('bot_activo')
        .eq('phone_number', fromNumber)
        .maybeSingle();

      const botActivo = conv ? conv.bot_activo : true;

      // Registrar mensaje en el historial
      await supabase.from('chat_sesiones').insert([{
        phone_number: fromNumber,
        role: 'user',
        content: textBody
      }]);

      // A. Respuesta del Administrador (Doble confirmación de ticket)
      if (fromNumber === ADMIN_PHONE && textBody.includes('#')) {
        console.log(`👤 Confirmación enviada por Administrador (${fromNumber}): ${textBody}`);
        await axios.post(`http://localhost:${PORT}/api/webhook/admin-respuesta`, {
          admin_phone: fromNumber,
          admin_message: textBody
        });
      }
      // B. Consulta del cliente con el BOT ACTIVO
      else if (botActivo) {
        // Obtener catálogo con stock activo
        const { data: catalogo } = await supabase
          .from('ofertas_publicadas')
          .select('id, destino, fecha_salida, descripcion, contacto, cupos')
          .eq('activo', true)
          .gt('cupos', 0);

        // Llamada al agente Gemini 2.5 Flash en Render
        const aiResponse = await pythonClient.post('/agent/chat', {
          user_message: textBody,
          travel_catalog: catalogo || [],
          history: []
        });

        const respuestaIA = aiResponse.data.response;

        // Guardar en el historial
        await supabase.from('chat_sesiones').insert([{
          phone_number: fromNumber,
          role: 'assistant',
          content: respuestaIA
        }]);

        // Enviar respuesta al cliente vía Zernio
        await sendZernioMessage(fromNumber, respuestaIA);
      } else {
        console.log(`⏸️ Bot pausado para ${fromNumber}. Mensaje listo en Dashboard.`);
      }
    } catch (err) {
      console.error('❌ Error procesando el webhook de Zernio:', err.message);
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

// ==================================================================
// 4. RUTAS ADMINISTRATIVAS DEL DASHBOARD (Protegidas)
// ==================================================================
app.use('/api/admin', requireAdminAuth);

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
    // Enviar el mensaje manualmente desde la plataforma vía Zernio
    await sendZernioMessage(phone_number, mensaje);

    // Guardar en el historial como 'human'
    await supabase.from('chat_sesiones').insert([{
      phone_number,
      role: 'human',
      content: mensaje
    }]);

    // Pausar el bot para ese cliente
    await supabase.from('conversaciones').update({
      bot_activo: false,
      ultimo_mensaje: new Date()
    }).eq('phone_number', phone_number);

    res.status(200).json({ ok: true, mensaje: 'Mensaje enviado manualmente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================================================================
// 5. DOBLE CONFIRMACIÓN DE TICKETS
// ==================================================================
app.post('/api/solicitar-confirmacion-doble', async (req, res) => {
  const { client_phone, viaje_id, destino } = req.body;
  try {
    const { data: ticket, error } = await supabase
      .from('tickets_disponibilidad')
      .insert([{ client_phone, viaje_id, estado: 'ESPERANDO_ADMIN' }])
      .select()
      .single();

    if (error) throw error;

    const mensajeAdmin = `⚠️ *SOLICITUD DE DOBLE CONFIRMACIÓN*\n\n` +
      `Ticket ID: #${ticket.id}\n` +
      `Cliente: ${client_phone}\n` +
      `Viaje: ${destino} (ID: ${viaje_id})\n\n` +
      `¿Confirmas disponibilidad en tiempo real?\n` +
      `Responde *"SI #${ticket.id}"* o *"NO #${ticket.id}"*.`;

    // Enviar notificación al Admin vía Zernio
    await sendZernioMessage(ADMIN_PHONE, mensajeAdmin);

    res.status(200).json({
      ok: true,
      ticket_id: ticket.id,
      respuesta_cliente: 'Estamos verificando la disponibilidad exacta con la oficina central.'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/webhook/admin-respuesta', async (req, res) => {
  const { admin_phone, admin_message } = req.body;
  if (ADMIN_PHONE && admin_phone !== ADMIN_PHONE) {
    return res.status(403).json({ ok: false, message: 'Número no autorizado' });
  }

  try {
    const match = admin_message.match(/#(\d+)/);
    if (!match) {
      return res.status(400).json({ ok: false, message: 'ID de ticket no encontrado' });
    }

    const ticket_id = match[1];

    const aiResponse = await pythonClient.post('/agent/confirm', {
      admin_message: admin_message
    });

    const accion = aiResponse.data.accion;
    const nuevoEstado = (accion === 'APROBAR') ? 'CONFIRMADO' : 'RECHAZAR';

    const { data: ticket, error } = await supabase
      .from('tickets_disponibilidad')
      .update({ estado: nuevoEstado })
      .eq('id', ticket_id)
      .select('*, ofertas_publicadas(destino, fecha_salida, descripcion)')
      .single();

    if (error || !ticket) throw new Error('Error actualizando ticket');

    let mensajeCliente = nuevoEstado === 'CONFIRMADO'
      ? `🎉 ¡Buenas noticias! Confirmamos disponibilidad para tu viaje a *${ticket.ofertas_publicadas.destino}*. ¿Deseas proceder con la reserva?`
      : `Lamentablemente no contamos con lugares disponibles para *${ticket.ofertas_publicadas.destino}* en este momento.`;

    // Enviar resultado final al cliente vía Zernio
    await sendZernioMessage(ticket.client_phone, mensajeCliente);

    res.status(200).json({ ok: true, ticket_id, nuevoEstado });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================================================================
// ARRANCAR SERVIDOR
// ==================================================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor Express activo en puerto ${PORT} (Integrado con Zernio API)`);
});