const { createClient } = require('@supabase/supabase-js');
const env = require('./env');
const log = require('../utils/logger');

let supabase = null;

if (env.SUPABASE_URL && env.SUPABASE_KEY) {
  supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  log.success('SUPABASE', 'Cliente de Supabase instanciado correctamente.');
} else {
  log.error('SUPABASE', 'Error crítico: Variables SUPABASE_URL o SUPABASE_KEY faltantes en .env');
}

module.exports = supabase;