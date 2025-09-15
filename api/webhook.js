import crypto from "crypto";

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAtlD5ORxXDUgnnD9Ri2IB
UcT2Ru1fMi9kub8errQdLaXdFRDZJ1mNHlMJx+CHkhM5GNkMmidAhPcYRs4h/yIb
YLiRSsR+Zl6krjcrEvrTIZ1BySNAxEuCzWGFM27Ef01xNOSPEgtptAmop6vRuaiS
ha2vB5rHN1hSks1td/7xDcFG+C4cnDsTYp39rUvSSMtkW6FCbBoxNPrNOSlZGykx
OFBhOYd/uOK4z/zFSy07f4rA32KNn3zJE5eb6tzNMRNa6lOL96x0OYzw/P6oaS5b
sugVehAM1TGBCzm4Xmz1VZVBhxd3V7VoJuf/0C0W2Yfer+E/G0s3DDWmjzqhbvrc
Eb0y1kOZn4Z39jswv5Bkk8NyqHfNe0dE4pX+dSnfhC/9J5xFZy/CknclEM/0waY8
36iYIy+MaRsQdWXjbvP1AVk/yq2RlXCaOnK7GPvxAP1qjcgt56cGUOks9H9X6lba
PcJd+KDWde1aZZJLUpxu7JDIVTruDy/KrxDtJYi7Mz40Y6pnsKXzPHzVr0km9LI9
zK1j24OS1RIbO2fMM9D2zNQnSUV//aR+/xb7W2UgL2L0GRl7nDzqQL2dLvStHG9O
yUtnH5R/hPuIZqIDZx1N52F1JwArfDY0j9t5suAqN0VXJe2N77cYJ0x2LDeg+rLl
KsdjLKRDtKpXormCUTs/V+0CAwEAAQ-----
END PUBLIC KEY-----`;

export const config = {
  api: { bodyParser: false }, // нужен raw body для подписи
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // читаем сырой body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    // проверяем подпись
    const signature = req.headers["payment-sign"];
    const verifier = crypto.createVerify("RSA-SHA1");
    verifier.update(rawBody);
    const isValid = verifier.verify(PUBLIC_KEY, Buffer.from(signature, "base64"));
    if (!isValid) return res.status(400).json({ error: "Invalid signature" });

    // парсим JSON
    const body = JSON.parse(rawBody);
    const { order, success } = body;

    // отправка в Telegram
    const text = `📌 Новый заказ\n🆔 Order ID: ${order?.id}\n✅ Success: ${success}\n📦 Статус: *${order?.status}*\n💰 Сумма: ${order?.orderAmount} ${order?.orderCurrency}`;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.CHAT_ID, text, parse_mode: "Markdown" }),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
