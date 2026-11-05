const express = require('express');
const router = express.Router();

const healthRoutes = require('./healthRoutes');
const webhookRoutes = require('./webhookRoutes');
const catalogRoutes = require('./catalogRoutes');
const adminRoutes = require('./adminRoutes');

router.use('/health', healthRoutes);
router.use('/api/catalogo', catalogRoutes);
router.use('/api/admin', adminRoutes);
router.use('/', webhookRoutes);

module.exports = router;