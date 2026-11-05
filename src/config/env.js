const path = require('path');
const dotenv = require('dotenv');

// Carga del archivo .env desde la raíz
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

module.exports = {
  PORT: process.env.PORT || 3000,
  ADMIN_PHONE: process.env.ADMIN_PHONE_NUMBER,
  PYTHON_AI_URL: process.env.PYTHON_AI_URL || 'http://localhost:8000',
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  ZERNIO_API_KEY: process.env.ZERNIO_API_KEY,
  ZERNIO_ACCOUNT_ID: process.env.ZERNIO_ACCOUNT_ID,
  ZERNIO_WEBHOOK_SECRET: process.env.ZERNIO_WEBHOOK_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY
};