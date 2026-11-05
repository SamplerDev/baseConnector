const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireSupabaseAuth } = require('../middlewares/authMiddleware');
const { auditAdminAction } = require('../middlewares/auditMiddleware');

// ==================================================================
// 1. RUTA PÚBLICA (Login via Backend BFF)
// ==================================================================
router.post('/login', adminController.login);

// ==================================================================
// 2. MIDDLEWARES GLOBALES DEL PANEL DE ADMINISTRACIÓN
// Exigen Token JWT con 2FA (AAL2) y registran auditoría
// ==================================================================
router.use(requireSupabaseAuth);
router.use(auditAdminAction);

// ==================================================================
// 3. RUTAS PROTEGIDAS
// ==================================================================
// Gestión de Borradores
router.get('/borradores', adminController.getBorradores);
router.post('/aprobar-borrador/:id', adminController.aprobarBorrador);
router.delete('/borrador/:id', adminController.rechazarBorrador);

// Conversaciones, Bot y Mensajería
router.get('/conversaciones', adminController.getConversaciones);
router.patch('/toggle-bot', adminController.toggleBot);
router.post('/enviar-mensaje-manual', adminController.enviarMensajeManual);

module.exports = router;