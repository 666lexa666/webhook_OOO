import crypto from "crypto";

const PUBLIC_KEY = `
-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAtlD5ORxXDUgnnD9Ri2IB
UcT2Ru1fMi9kub8errQdLaXdFRDZJ1mNHlMJx+CHkhM5GNkMmidAhPcYRs4h/yIb
...
-----END PUBLIC KEY-----
`;

export const config = {
  api: { bodyParser: false }, // отключаем авто-парсинг, нужен raw body
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // читаем сырой body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    const signature = req.headers["payment-sign"]; // подпись в base64

    // Проверяем подпись
    const verifier = crypto.createVerify("RSA-SHA1");
    verifier.update(rawBody);
    const isValid = verifier.verify(PUBLIC_KEY, Buffer.from(signature, "base64"));
    if (!isValid) return res.status(400).json({ error: "Invalid signature" });

    // Парсим JSON после валидации
    const { success, description, order } = JSON.parse(rawBody);

    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const CHAT_ID = process.env.CHAT_ID;

    const text = `
📌 Новый статус заявки
✅ Success: ${success}
📝 Описание: ${description}
📦 Статус: *${order?.status}*
    `;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "Markdown"
      })
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Ошибка:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
