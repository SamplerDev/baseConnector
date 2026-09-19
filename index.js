require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Endpoint de verificación de salud
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'WhatsApp Connector Gateway' });
});

// Endpoint principal para recibir Webhooks de WhatsApp (Evolution API / Meta)
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const payload = req.body;
    
    // IMPORTANTE: Responder a WhatsApp de inmediato para evitar timeouts (HTTP 200)
    res.status(200).json({ status: 'received' });

    // Extraer datos básicos del mensaje
    const sender = payload?.data?.key?.remoteJid || payload?.sender;
    const messageText = payload?.data?.message?.conversation || payload?.message;

    console.log(`[Webhook Recibido] De: ${sender} | Mensaje: ${messageText}`);

    // TODO: Aquí irá el enrutador para llamar a MariaDB y al microservicio en Render

  } catch (error) {
    console.error('Error procesando el webhook:', error);
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor base corriendo en el puerto ${PORT}`);
});