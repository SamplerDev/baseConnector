const axios = require('axios');
const env = require('./env');
const log = require('../utils/logger');

const pythonClient = axios.create({
  baseURL: env.PYTHON_AI_URL,
  timeout: 60000, // 60s para tolerar el cold start de Render
  headers: {
    'X-API-Key': env.INTERNAL_API_KEY,
    'Content-Type': 'application/json'
  }
});

pythonClient.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  log.info('PYTHON_REQ', `[Render] -> ${config.method.toUpperCase()} ${config.baseURL}${config.url}`, config.data);
  return config;
}, (err) => {
  log.error('PYTHON_REQ_ERR', 'Error en la preparación de solicitud a Python', err);
  return Promise.reject(err);
});

pythonClient.interceptors.response.use((response) => {
  const duration = Date.now() - response.config.metadata.startTime;
  log.success('PYTHON_RES', `[Render] <- ${response.status} OK [${duration}ms]`, response.data);
  return response;
}, (err) => {
  const duration = err.config?.metadata ? Date.now() - err.config.metadata.startTime : 0;
  log.error('PYTHON_RES_ERR', `[Render] Error en llamada a Python [${duration}ms]`, err.response?.data || err.message);
  return Promise.reject(err);
});

// Mantener despierto el microservicio de Render enviando un ping cada 10 minutos
setInterval(async () => {
  try {
    await pythonClient.get('/health');
    log.info('KEEP_ALIVE', 'Ping de mantenimiento enviado a Render');
  } catch (err) {
    log.warn('KEEP_ALIVE_ERR', 'No se pudo contactar Vercel en el ping de mantenimiento');
  }
}, 10 * 60 * 1000);

module.exports = pythonClient;