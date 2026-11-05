const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // 👈 1. Importar el módulo de sistema de archivos
const helmet = require('helmet');
const apiLimiter = require('./middlewares/rateLimiter');
const routes = require('./routes');
const log = require('./utils/logger');

const app = express();

app.set('trust proxy', 1);

// Seguridad y Middlewares
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

// ==================================================================
// DIAGNÓSTICO DE RUTA Y ARCHIVOS ESTÁTICOS (/admin)
// ==================================================================
const adminDir = path.resolve(__dirname, '../public/admin');
const indexPath = path.join(adminDir, 'index.html');

// 🔍 LOG 1: Verificar en consola si el archivo existe físicamente al arrancar
log.info('PATH_CHECK', `Ruta absoluta buscada: ${adminDir}`);
log.info('PATH_CHECK', `¿Existe index.html en esa carpeta?: ${fs.existsSync(indexPath) ? '✅ SÍ' : '❌ NO'}`);

// 🔍 LOG 2: Middleware de rastreo para peticiones hacia /admin
app.use('/admin', (req, res, next) => {
  log.info('ADMIN_TRACE', `Petición detectada hacia /admin | path: "${req.path}" | originalUrl: "${req.originalUrl}"`);
  next();
});

// 1. Servir archivos estáticos (app.js, CSS, etc.)
app.use('/admin', express.static(adminDir));

// 2. Servir el index.html
app.get(['/admin', '/admin/*'], (req, res) => {
  log.info('ADMIN_SERVE', `Intentando enviar index.html desde: ${indexPath}`);

  res.sendFile(indexPath, (err) => {
    if (err) {
      // 🔍 LOG 3: Capturar el error exacto si Express falla al leer o entregar el archivo
      log.error('ADMIN_SERVE_ERR', `Error leyendo/enviando el archivo index.html`, err);
      if (!res.headersSent) {
        res.status(404).send(`Error de Diagnóstico: No se pudo entregar el archivo en ${indexPath}`);
      }
    } else {
      log.success('ADMIN_SERVE_OK', `index.html entregado con éxito.`);
    }
  });
});

// Montar el resto de las rutas
app.use('/', routes);

module.exports = app;