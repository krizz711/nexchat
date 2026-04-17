const router = require('express').Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { upload } = require('../config/cloudinary');

// Upload file/image in chat
router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    res.json({
      url: req.file.path,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
