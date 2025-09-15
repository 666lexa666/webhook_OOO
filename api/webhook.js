export default async function handler(req, res) {
  // лучше использовать POST, но если у тебя реально GET с body, оставляю так
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { success, description, order } = req.body || {};

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
