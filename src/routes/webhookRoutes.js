const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const adminController = require('../controllers/adminController');
const { verifyZernioSignature } = require('../middlewares/authMiddleware');

// Webhook entrante de Zernio
router.post('/webhook', verifyZernioSignature, webhookController.handleZernioWebhook);

// Webhook callback desde microservicio Python
router.post('/api/webhooks/flyer-completed', webhookController.handleFlyerCompleted);

// Endpoint público alternativo para confirmaciones
router.post('/api/webhook/admin-respuesta', adminController.responderTicketWebhook);

module.exports = router;