const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const apiLimiter = require('./middlewares/rateLimiter');
const routes = require('./routes');
const log = require('./utils/logger');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(apiLimiter);

app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// Logger HTTP Global
app.use((req, res, next) => {
  const start = Date.now();
  log.info('HTTP_IN', `--> ${req.method} ${req.url} [IP: ${req.ip}]`);
  res.on('finish', () => {
    log.info('HTTP_OUT', `<-- ${req.method} ${req.url} ${res.statusCode} [${Date.now() - start}ms]`);
  });
  next();
});

// ------------------------------------------------------------------
// PANEL DE ADMINISTRACIÓN (public/admin)
// ------------------------------------------------------------------
const adminDir = path.resolve(__dirname, '../public/admin');
const indexPath = path.join(adminDir, 'index.html');

log.info('PATH_CHECK', `Ruta estática admin: ${adminDir}`);
log.info('PATH_CHECK', `Estado de index.html: ${fs.existsSync(indexPath) ? '✅ EXISTE' : '❌ NO ENCONTRADO'}`);

// Servir archivos estáticos (.js, .css, etc.)
app.use('/admin', express.static(adminDir));

// Entregar index.html utilizando Regex para compatibilidad total con Express 5
app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
  log.info('ADMIN_SERVE', `Sirviendo panel admin desde: ${indexPath}`);
  res.sendFile(indexPath, (err) => {
    if (err) {
      log.error('ADMIN_SERVE_ERR', `No se pudo enviar ${indexPath}`, err);
      if (!res.headersSent) {
        res.status(404).send('Error: No se encontró la interfaz del panel administrativo.');
      }
    }
  });
});

// Montar resto de la API Backend
app.use('/', routes);

module.exports = app;