const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  PORT: process.env.PORT || 3000,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  ADMIN_PHONE: process.env.ADMIN_PHONE,
  PYTHON_AI_URL: (process.env.PYTHON_AI_URL || '').replace(/\/+$/, ''),
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  ZERNIO_API_KEY: process.env.ZERNIO_API_KEY,
  ZERNIO_ACCOUNT_ID: process.env.ZERNIO_ACCOUNT_ID,
  ZERNIO_WEBHOOK_SECRET: process.env.ZERNIO_WEBHOOK_SECRET
};