const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // Máximo 100 peticiones por minuto por IP
  message: { error: 'Demasiadas peticiones desde esta IP' }
});

module.exports = apiLimiter;