const hasCjk = (value = '') => /[\u3400-\u9FFF]/.test(String(value));
const hasReplacement = (value = '') => String(value).includes('\uFFFD');

const decodeOriginalName = (value = '') => {
  const name = String(value || '');
  if (!name || hasCjk(name)) return name;

  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (!decoded || hasReplacement(decoded)) return name;

  // Multer/busboy may expose UTF-8 filenames as latin1 mojibake.
  // Prefer the decoded value when it restores Chinese filenames used by the app.
  return hasCjk(decoded) ? decoded : name;
};

const normalizeUploadedFileName = (req, res, next) => {
  if (req.file?.originalname) {
    req.file.originalname = decodeOriginalName(req.file.originalname);
  }
  next();
};

module.exports = {
  decodeOriginalName,
  normalizeUploadedFileName,
};
