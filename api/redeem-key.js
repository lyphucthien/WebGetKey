const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const SECRET = process.env.VERIFY_SECRET;

if (!SECRET) {
    throw new Error("VERIFY_SECRET is not configured");
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));

    if (bufA.length !== bufB.length) {
        return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async (req, res) => {
    try {

        if (req.method !== "POST") {
            return res.status(405).json({
                success: false,
                error: "Method not allowed"
            });
        }

        // =====================================
        // 1. XÁC THỰC REQUEST ĐẾN TỪ BOT
        // =====================================

        const botSecret = req.headers["x-redeem-secret"];

        if (!botSecret || !safeEqual(botSecret, SECRET)) {
            return res.status(403).json({
                success: false,
                error: "Không có quyền gọi API này"
            });
        }

        // =====================================
        // 2. LẤY DỮ LIỆU GỬI LÊN
        // =====================================

        const { key, minecraftUsername, discordId } = req.body || {};

        if (!key || !minecraftUsername) {
            return res.status(400).json({
                success: false,
                error: "Thiếu key hoặc tên Minecraft"
            });
        }

        const cleanKey = String(key).trim();
        const username = String(minecraftUsername).trim();

        // =====================================
        // 3. KEY NÀY CÓ THẬT SỰ ĐƯỢC HỆ THỐNG PHÁT RA KHÔNG?
        // =====================================

        const isMinecraftKey = await kv.sismember("issued-set-minecraft", cleanKey);
        const isLpthubKey = await kv.sismember("issued-set-lpthub", cleanKey);

        if (!isMinecraftKey && !isLpthubKey) {
            return res.status(400).json({
                success: false,
                error: "Key không hợp lệ"
            });
        }

        // =====================================
        // 4. KEY ĐÃ ĐƯỢC KÍCH HOẠT (REDEEM) TRƯỚC ĐÓ CHƯA?
        // =====================================

        const redeemKey = `redeemed:${cleanKey}`;
        const alreadyRedeemed = await kv.get(redeemKey);

        if (alreadyRedeemed) {
            return res.status(400).json({
                success: false,
                error: "Key này đã được kích hoạt trước đó"
            });
        }

        // =====================================
        // 5. LƯU TRẠNG THÁI ĐÃ KÍCH HOẠT
        // =====================================

        const record = {
            minecraftUsername: username,
            discordId: discordId || null,
            redeemedAt: Date.now()
        };

        await kv.set(redeemKey, record);

        // Plugin sẽ tra theo tên (lowercase để tránh lệch hoa/thường)
        await kv.set(`verified:${username.toLowerCase()}`, record);

        return res.status(200).json({
            success: true
        });

    } catch (error) {

        console.error("Redeem key error:", error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};