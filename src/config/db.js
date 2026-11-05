const { createClient } = require('@supabase/supabase-js');

// Toma SUPABASE_URL y SUPABASE_API_KEY directamente de Hostinger
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_API_KEY || process.env.SUPABASE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  // Asegura que la URL no tenga espacios ni mayúsculas en el protocolo
  const cleanUrl = supabaseUrl.trim().toLowerCase().startsWith('http') 
    ? supabaseUrl.trim() 
    : `https://${supabaseUrl.trim()}`;

  supabase = createClient(cleanUrl, supabaseKey.trim());
} else {
  console.error('❌ Error: Las variables SUPABASE_URL o SUPABASE_API_KEY no están definidas.');
}

module.exports = supabase;