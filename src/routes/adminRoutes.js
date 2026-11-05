const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireSupabaseAuth } = require('../middlewares/authMiddleware');

// Autenticación Supabase (2FA TOTP) obligatoria para todo el subgrupo /api/admin
router.use(requireSupabaseAuth);

router.get('/conversaciones', adminController.getConversaciones);
router.patch('/toggle-bot', adminController.toggleBot);
router.post('/enviar-mensaje-manual', adminController.enviarMensajeManual);
router.get('/borradores', adminController.getBorradores);
router.post('/aprobar-borrador/:id', adminController.aprobarBorrador);
router.delete('/borrador/:id', adminController.rechazarBorrador);

module.exports = router;