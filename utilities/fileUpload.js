const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let folder = "kyc/others";
    if (file.fieldname === "evidence") folder = "p2p/disputes";
    if (file.fieldname === "selfie") folder = "kyc/selfies";
    if (
      file.fieldname === "proof_id_front" ||
      file.fieldname === "proof_id_back"
    )
      folder = "kyc/ids";
    if (file.fieldname === "proof_address") folder = "kyc/addresses";

    return {
      folder,
      format: file.mimetype.split("/")[1], // jpg/png/pdf
      public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
      resource_type: "auto",
    };
  },
});

// File filter
function fileFilter(_req, file, cb) {
  const imageFields = ["selfie", "proof_id_front", "proof_id_back", "evidence"];
  if (imageFields.includes(file.fieldname)) {
    if (["image/jpeg", "image/png"].includes(file.mimetype))
      return cb(null, true);
    return cb(new Error("Only JPG/PNG images allowed for selfies and ID"));
  }

  if (file.fieldname === "proof_address") {
    if (["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype))
      return cb(null, true);
    return cb(new Error("Only JPG, PNG, or PDF allowed for proof of address"));
  }

  cb(new Error("Invalid file field"));
}

// Multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

function uploadFile(options = {}) {
  const { maxSize = 5 * 1024 * 1024 } = options; // Default 5MB limit

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: maxSize },
  });
}

// Error handler
function uploadErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError)
    return res.status(400).json({ message: `Upload error: ${err.message}` });
  if (err) return res.status(400).json({ message: err.message });
  next();
}

module.exports = { upload, uploadErrorHandler };
