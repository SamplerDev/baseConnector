require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./db'); // Importamos la conexión a Supabase

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Endpoint de prueba conectando a Supabase
app.get('/health', async (req, res) => {
  try {
    // Intenta consultar la tabla de ofertas
    const { data, error } = await supabase.from('ofertas_publicadas').select('count', { count: 'exact' });

    if (error) throw error;

    res.status(200).json({
      status: 'OK',
      database: 'Supabase Conectado',
      total_ofertas: data
    });
  } catch (err) {
    res.status(200).json({
      status: 'OK',
      database: 'Error o tabla pendiente en Supabase',
      details: err.message
    });
  }
});

// Endpoint del Webhook para WhatsApp
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).json({ status: 'received' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor base corriendo en puerto ${PORT}`);
});