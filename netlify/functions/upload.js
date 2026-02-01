import Busboy from "busboy";
import { google } from "googleapis";
import { Readable } from "stream";

/* =========================
   Google Drive client
   ========================= */
function getDriveClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  }

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  });

  return google.drive({ version: "v3", auth });
}

/* =========================
   Multipart parser
   ========================= */
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType) return reject(new Error("Missing Content-Type"));

    const bb = Busboy({ headers: { "content-type": contentType } });

    let fileBuffer = null;
    let fileName = "photo.jpg";
    let mimeType = "image/jpeg";
    const fields = {};

    bb.on("file", (_name, file, info) => {
      fileName = info.filename || fileName;
      mimeType = info.mimeType || mimeType;

      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("error", reject);
    bb.on("finish", () =>
      resolve({ fileBuffer, fileName, mimeType, fields })
    );

    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    Readable.from(body).pipe(bb);
  });
}

/* =========================
   Netlify Function handler
   ========================= */
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 🔐 Token check
  const token =
    event.headers["x-upload-token"] || event.headers["X-Upload-Token"];
  if (process.env.UPLOAD_TOKEN && token !== process.env.UPLOAD_TOKEN) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  try {
    const { fileBuffer, fileName, mimeType, fields } =
      await parseMultipart(event);

    if (!fileBuffer) {
      return { statusCode: 400, body: "No file received" };
    }

    const drive = getDriveClient();

    const qrId = (fields.qrId || "qr").replace(/[^a-zA-Z0-9_-]/g, "");
    const finalName = `${qrId}_${Date.now()}_${fileName}`;

    // ✅ FIX: Buffer → Readable stream
    await drive.files.create({
      requestBody: {
        name: finalName,
        parents: [process.env.DRIVE_FOLDER_ID]
      },
      media: {
        mimeType,
        body: Readable.from(fileBuffer)
      }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, filename: finalName })
    };
  } catch (err) {
    console.error("🔥 Upload failed:", err);
    return { statusCode: 500, body: "Upload failed" };
  }
}
