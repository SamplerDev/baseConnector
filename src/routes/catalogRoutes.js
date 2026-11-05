const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');

router.get('/activo', catalogController.getCatalogoActivo);

module.exports = router;