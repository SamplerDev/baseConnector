const path = require('path');
const dotenv = require('dotenv');
const log = require('../utils/logger');

// Carga de variables de entorno con trazabilidad apuntando a la raíz del proyecto
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

log.info('STARTUP', 'Iniciando servidor Node.js y verificando variables de entorno...');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_API_KEY || process.env.SUPABASE_KEY;

const env = {
  PORT: process.env.PORT || 3000,
  ADMIN_PHONE: process.env.ADMIN_PHONE_NUMBER || process.env.ADMIN_PHONE,
  PYTHON_AI_URL: (process.env.PYTHON_AI_URL || 'http://localhost:8000').replace(/\/+$/, ''),
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  ZERNIO_API_KEY: process.env.ZERNIO_API_KEY,
  ZERNIO_ACCOUNT_ID: process.env.ZERNIO_ACCOUNT_ID,
  ZERNIO_WEBHOOK_SECRET: process.env.ZERNIO_WEBHOOK_SECRET,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_KEY: supabaseKey
};

log.info('ENV_CHECK', 'Estado de variables cargadas:', {
  PORT: env.PORT,
  ADMIN_PHONE: env.ADMIN_PHONE ? '✅ Configurado' : '❌ Faltante',
  PYTHON_AI_URL: env.PYTHON_AI_URL,
  INTERNAL_API_KEY: env.INTERNAL_API_KEY ? '✅ Configurada' : '❌ Faltante',
  ZERNIO_API_KEY: env.ZERNIO_API_KEY ? '✅ Configurada' : '❌ Faltante',
  ZERNIO_ACCOUNT_ID: env.ZERNIO_ACCOUNT_ID ? '✅ Configurado' : '❌ Faltante',
  ZERNIO_WEBHOOK_SECRET: env.ZERNIO_WEBHOOK_SECRET ? '✅ Configurado' : '❌ Faltante',
  SUPABASE_URL: env.SUPABASE_URL ? '✅ Configurado' : '❌ Faltante',
  SUPABASE_KEY: env.SUPABASE_KEY ? '✅ Configurado' : '❌ Faltante'
});

module.exports = env;