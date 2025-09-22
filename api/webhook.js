import crypto from "crypto";
import { MongoClient } from "mongodb";

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
KsdjLKRDtKpXormCUTs/V+0CAwEAAQ==
-----END PUBLIC KEY-----`;

export const config = { api: { bodyParser: false } };

// ====================
// КЭШ КЛИЕНТА MONGO
// ====================
let cachedClient = null;
let cachedDb1 = null;
let cachedDb2 = null;

async function getMongoClient() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI не задана");
  if (cachedClient) return cachedClient;
  const client = new MongoClient(process.env.MONGODB_URI);
  cachedClient = await client.connect();
  return cachedClient;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // ========================
    // Читаем raw body
    // ========================
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    // ========================
    // Проверка подписи
    // ========================
    const signature = req.headers["payment-sign"];
    const verifier = crypto.createVerify("RSA-SHA1");
    verifier.update(rawBody);
    const isValid = verifier.verify(PUBLIC_KEY, Buffer.from(signature, "base64"));
    if (!isValid) return res.status(400).json({ error: "Invalid signature" });

    const { order } = JSON.parse(rawBody);
    const { id, status } = order;

    // ========================
    // Подключение к MongoDB
    // ========================
    const mongoClient = await getMongoClient();

    if (!cachedDb1) cachedDb1 = mongoClient.db(process.env.MONGODB_DB);
    if (!cachedDb2) cachedDb2 = mongoClient.db(process.env.MONGODB_DB2);

    const orders1 = cachedDb1.collection("orders");
    const orders2 = cachedDb2.collection("orders");

    // ========================
    // ПЕРВАЯ БАЗА (основная)
    // ========================
    const orderInDb = await orders1.findOne({ operation_id: id });

    if (orderInDb) {
      if (["IPS_ACCEPTED", "CHARGED"].includes(status)) {
        await orders1.updateOne(
          { operation_id: id },
          { $set: { status: "Оплачено" } }
        );

        // Получаем exchange_rate
        const rateRes = await fetch("https://desslyhub.com/api/v1/exchange_rate/steam/5", {
          method: "GET",
          headers: { apikey: "17bc36e1b7084bee862d02b23d02d513" }
        });
        const rateData = await rateRes.json();
        const exchange_rate = rateData.exchange_rate;

        // Рассчитываем сумму для Steam топап
        const steamAmount = orderInDb.discountedAmount / exchange_rate;

        // Отправляем POST на steamtopup
        const topupRes = await fetch("https://desslyhub.com/api/v1/service/steamtopup/topup", {
          method: "POST",
          headers: {
            apikey: "17bc36e1b7084bee862d02b23d02d513",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            amount: steamAmount,
            username: orderInDb.steamId
          })
        });
        const topupData = await topupRes.json();

        // Обновляем Mongo с transaction_id и status_steam
        await orders1.updateOne(
          { operation_id: id },
          {
            $set: {
              transaction_id: topupData.transaction_id,
              status_steam: topupData.status
            }
          }
        );

        console.log(`Заказ ${id} в основной базе обработан и топап выполнен`);
      } else if (status === "DECLINED") {
        await orders1.updateOne(
          { operation_id: id },
          { $set: { status: "Отменен" } }
        );
        console.log(`Заказ ${id} в основной базе отменён`);
      } else {
        console.log(`Статус ${status} игнорирован для заказа ${id} в основной базе`);
      }
    } else {
      console.log(`Заказ с operation_id ${id} не найден в основной базе`);
    }

    // ========================
    // ВТОРАЯ БАЗА (поиск по id, только статус)
    // ========================
    let dbStatus = null;
    if (["IPS_ACCEPTED", "CHARGED"].includes(status)) dbStatus = "Оплачено";
    else if (status === "DECLINED") dbStatus = "Отменен";

    if (dbStatus) {
      const result2 = await orders2.updateOne(
        { id }, // <- поиск по id во второй базе
        { $set: { status: dbStatus } }
      );
      if (result2.matchedCount === 0) {
        console.log(`Во второй базе заказ с id ${id} не найден`);
      } else {
        console.log(`Во второй базе заказ ${id} обновлён на: ${dbStatus}`);
      }
    } else {
      console.log(`Во второй базе статус ${status} игнорирован для заказа ${id}`);
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Ошибка вебхука:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
