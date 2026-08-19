const fs = require('fs');

// 常见类型的魔数（文件头签名），用于校验上传文件的真实内容
const SIGNATURES = [
  { mimes: ['application/pdf'], bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mimes: ['image/png'], bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mimes: ['image/jpeg'], bytes: [0xff, 0xd8, 0xff] },
  { mimes: ['image/gif'], bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  {
    // Office Open XML（docx/xlsx/pptx）本质是 zip 包
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    bytes: [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04
  },
  {
    // 旧版 Office（doc/xls/ppt）OLE 复合文档
    mimes: ['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'],
    bytes: [0xd0, 0xcf, 0x11, 0xe0],
  },
];

const matchesSignature = (header, mime) => {
  const signature = SIGNATURES.find((item) => item.mimes.includes(mime));
  // text/plain、text/markdown 等无固定魔数的类型跳过校验
  if (!signature) return true;
  return signature.bytes.every((byte, index) => header[index] === byte);
};

const deleteUploadedFile = (file) => {
  if (file && file.path) {
    fs.promises.unlink(file.path).catch(() => {});
  }
};

// multer 之后调用：文件真实内容与声明的 mimetype 不符时删除文件并返回 400
const verifyUploadedFileSignature = async (req, res, next) => {
  if (!req.file) return next();

  try {
    const fd = await fs.promises.open(req.file.path, 'r');
    const header = Buffer.alloc(8);
    await fd.read(header, 0, 8, 0);
    await fd.close();

    if (!matchesSignature(header, req.file.mimetype)) {
      deleteUploadedFile(req.file);
      return res.status(400).json({ message: '文件内容与声明的类型不符' });
    }
    return next();
  } catch (err) {
    deleteUploadedFile(req.file);
    return next(err);
  }
};

module.exports = { verifyUploadedFileSignature };
