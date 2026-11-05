const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const apiLimiter = require('./middlewares/rateLimiter');
const routes = require('./routes');
const log = require('./utils/logger');

const app = express();

// Confiar en proxy de Hostinger (LiteSpeed)
app.set('trust proxy', 1);

// Seguridad HTTP y Rate Limit
app.use(helmet());
app.use(cors());
app.use(apiLimiter);

// Guardar buffer crudo para la validación HMAC de Zernio
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Servir la interfaz web del Panel de Administración (ubicado en /admin)
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Logger de tráfico HTTP
app.use((req, res, next) => {
  const start = Date.now();
  log.info('HTTP_IN', `--> ${req.method} ${req.url} [IP: ${req.ip}]`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    log.info('HTTP_OUT', `<-- ${req.method} ${req.url} ${res.statusCode} [${duration}ms]`);
  });
  next();
});

// Montar Rutas de la Aplicación
app.use('/', routes);

module.exports = app;