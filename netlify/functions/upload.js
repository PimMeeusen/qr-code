import Busboy from "busboy";
import { google } from "googleapis";
import { Readable } from "stream";

/* =========================
   Google Drive client
   ========================= */
function getDriveClient() {
  console.log("→ getDriveClient()");
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
  console.log("→ parseMultipart()");

  return new Promise((resolve, reject) => {
    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"];

    if (!contentType) {
      reject(new Error("Missing Content-Type header"));
      return;
    }

    const bb = Busboy({ headers: { "content-type": contentType } });

    let fileBuffer = null;
    let fileName = "photo.jpg";
    let mimeType = "image/jpeg";
    const fields = {};

    bb.on("file", (_name, file, info) => {
      console.log("→ file received:", info.filename, info.mimeType);
      fileName = info.filename || fileName;
      mimeType = info.mimeType || mimeType;

      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
        console.log("→ file size:", fileBuffer.length);
      });
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
      console.log("→ field:", name, val);
    });

    bb.on("error", (err) => {
      console.error("❌ Busboy error", err);
      reject(err);
    });

    bb.on("finish", () => {
      resolve({ fileBuffer, fileName, mimeType, fields });
    });

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
  console.log("=== FUNCTION START ===");
  console.log("Method:", event.httpMethod);

  try {
    if (event.httpMethod !== "POST") {
      console.log("❌ Not POST");
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const token =
      event.headers["x-upload-token"] || event.headers["X-Upload-Token"];

    console.log("Token received:", token);
    console.log("Expected token:", process.env.UPLOAD_TOKEN);

    if (process.env.UPLOAD_TOKEN && token !== process.env.UPLOAD_TOKEN) {
      console.error("❌ Token mismatch");
      return { statusCode: 401, body: "Unauthorized" };
    }

    console.log("✅ Token OK");
    console.log("DRIVE_FOLDER_ID:", process.env.DRIVE_FOLDER_ID);
    console.log(
      "Has GOOGLE_SERVICE_ACCOUNT_JSON:",
      !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    );

    const { fileBuffer, fileName, mimeType, fields } =
      await parseMultipart(event);

    if (!fileBuffer) {
      throw new Error("No file received");
    }

    const drive = getDriveClient();

    const qrId = (fields.qrId || "qr").replace(/[^a-zA-Z0-9_-]/g, "");
    const finalName = `${qrId}_${Date.now()}_${fileName}`;

    console.log("→ Uploading to Drive:", finalName);

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

    console.log("✅ Upload success");
    console.log("=== FUNCTION END ===");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, filename: finalName })
    };
  } catch (err) {
    console.error("🔥 FUNCTION ERROR:", err.message);
    console.error(err);
    return { statusCode: 500, body: "Upload failed" };
  }
}
