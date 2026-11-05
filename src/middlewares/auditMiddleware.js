const supabase = require('../config/db');
const log = require('../utils/logger');

async function auditAdminAction(req, res, next) {
  const originalJson = res.json;

  // Interceptar la respuesta para registrar la auditoría solo si la operación fue exitosa (200 OK)
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300 && body.ok) {
      setImmediate(async () => {
        try {
          await supabase.from('logs_auditoria').insert([{
            admin_id: req.user.id,
            admin_email: req.user.email,
            accion: `${req.method} ${req.originalUrl}`,
            ip: req.ip || req.headers['x-forwarded-for'],
            user_agent: req.headers['user-agent'],
            payload: req.body ? JSON.stringify(req.body) : null,
            created_at: new Date()
          }]);
          log.info('AUDIT', `Acción administrativa auditada: ${req.method} ${req.originalUrl} por ${req.user.email}`);
        } catch (err) {
          log.error('AUDIT_ERR', 'Error escribiendo en log de auditoría', err);
        }
      });
    }
    return originalJson.call(this, body);
  };

  next();
}

module.exports = { auditAdminAction };