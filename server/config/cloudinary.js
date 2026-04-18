const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    return {
      folder: 'chat-app',
      resource_type: 'auto',
      use_filename: true,
      unique_filename: true,
    };
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp',
                     'application/pdf','text/plain','application/zip'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'), false);
  },
});

module.exports = { cloudinary, upload };
