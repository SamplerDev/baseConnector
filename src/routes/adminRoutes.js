const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireSupabaseAuth } = require('../middlewares/authMiddleware');
const { auditAdminAction } = require('../middlewares/auditMiddleware');

// Autenticación Supabase (2FA TOTP) y Registro de Auditoría para /api/admin
router.use(requireSupabaseAuth);
router.use(auditAdminAction);

// Rutas Administrativas Protegidas
router.get('/conversaciones', adminController.getConversaciones);
router.patch('/toggle-bot', adminController.toggleBot);
router.post('/enviar-mensaje-manual', adminController.enviarMensajeManual);
router.get('/borradores', adminController.getBorradores);
router.post('/aprobar-borrador/:id', adminController.aprobarBorrador);
router.delete('/borrador/:id', adminController.rechazarBorrador);

module.exports = router;