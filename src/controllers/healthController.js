const supabase = require('../config/db');
const pythonClient = require('../config/pythonClient');
const log = require('../utils/logger');

async function checkHealth(req, res) {
  log.info('HEALTH', 'Ejecutando Healthcheck...');
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
    log.error('HEALTH_ERR', 'Error en Healthcheck', err);
    res.status(500).json({ status: 'Error', details: err.message });
  }
}

module.exports = { checkHealth };