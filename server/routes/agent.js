const express = require('express');
const router = express.Router();
const { queryAgent } = require('../controllers/agentController');
const { auth } = require('../middleware/auth');

router.post('/query', auth, queryAgent);

module.exports = router;
