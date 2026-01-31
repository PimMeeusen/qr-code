import Busboy from "busboy";
import { google } from "googleapis";

export const config = {
  api: { bodyParser: false }
};

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });

    let fileBuffer = null;
    let fileName = "photo.jpg";
    let mimeType = "image/jpeg";
    const fields = {};

    bb.on("file", (_name, file, info) => {
      fileName = info.filename || fileName;
      mimeType = info.mimeType || mimeType;

      const chunks = [];
      file.on("data", d => chunks.push(d));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("finish", () => {
      resolve({ fileBuffer, fileName, mimeType, fields });
    });

    bb.on("error", reject);

    req.pipe(bb);
  });
}

function getDriveClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  });

  return google.drive({ version: "v3", auth });
}

export default async function handler(req, res) {
  // Alleen POST toestaan
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // 🔐 Token check
  const token = req.headers["x-upload-token"];
  if (process.env.UPLOAD_TOKEN && token !== process.env.UPLOAD_TOKEN) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const { fileBuffer, fileName, mimeType, fields } =
      await parseMultipart(req);

    if (!fileBuffer) {
      return res.status(400).send("No file received");
    }

    const drive = getDriveClient();

    const qrId = (fields.qrId || "qr").replace(/[^a-zA-Z0-9_-]/g, "");
    const finalName = `${qrId}_${Date.now()}_${fileName}`;

    await drive.files.create({
      requestBody: {
        name: finalName,
        parents: [process.env.DRIVE_FOLDER_ID]
      },
      media: {
        mimeType,
        body: Buffer.from(fileBuffer)
      }
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Upload failed");
  }
}
