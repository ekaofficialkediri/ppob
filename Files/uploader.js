const FormData = require("form-data");
const { fromBuffer } = require("file-type");
const { ImageUploadService } = require("node-upload-images");

async function CatBox(buffer) {
  try {
    const fetchModule = await import("node-fetch");
    const fetch = fetchModule.default;
    const { ext } = await fromBuffer(buffer);
    const form = new FormData();
    form.append("fileToUpload", buffer, `file.${ext}`);
    form.append("reqtype", "fileupload");
    const res = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: form
    });
    const url = await res.text();
    if (url && url.startsWith("https://")) return url;
    return null;
  } catch (e) {
    return null;
  }
}

async function UploadPixhost(buffer) {
  try {
    const service = new ImageUploadService("pixhost.to");
    const { directLink } = await service.uploadFromBinary(buffer, "image.png");
    return directLink || null;
  } catch (e) {
    console.error("[Pixhost Error]", e.message);
    return null;
  }
}

async function UploadMedia(buffer, filename = "file", type = "image") {
  let url = await CatBox(buffer);
  if (url) return url;
  if (type === "image") {
    url = await UploadPixhost(buffer);
    if (url) return url;
  }
  console.error("[UploadMedia] Semua metode upload gagal");
  return null;
}

module.exports = { CatBox, UploadPixhost, UploadMedia };