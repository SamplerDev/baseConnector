const supabase = require('../config/db');

async function getCatalogoActivo(req, res) {
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
}

module.exports = { getCatalogoActivo };