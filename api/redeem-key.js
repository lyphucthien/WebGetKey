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

        const callerSecret = req.headers["x-redeem-secret"];

        if (!callerSecret || !safeEqual(callerSecret, SECRET)) {
            return res.status(403).json({
                success: false,
                error: "Không có quyền gọi API này"
            });
        }

        if (req.method === "GET") {

            const { username } = req.query || {};

            if (!username) {
                return res.status(400).json({
                    success: false,
                    error: "Thiếu username"
                });
            }

            const record = await kv.get(
                `verified:${String(username).trim().toLowerCase()}`
            );

            return res.status(200).json({
                success: true,
                verified: !!record
            });
        }

        if (req.method !== "POST") {
            return res.status(405).json({
                success: false,
                error: "Method not allowed"
            });
        }

        const { key, minecraftUsername, discordId } = req.body || {};

        if (!key || !minecraftUsername) {
            return res.status(400).json({
                success: false,
                error: "Thiếu key hoặc tên Minecraft"
            });
        }

        const cleanKey = String(key).trim();
        const username = String(minecraftUsername).trim();

        const isMinecraftKey = await kv.sismember("issued-set-minecraft", cleanKey);
        const isLpthubKey = await kv.sismember("issued-set-lpthub", cleanKey);

        if (!isMinecraftKey && !isLpthubKey) {
            return res.status(400).json({
                success: false,
                error: "Key không hợp lệ"
            });
        }

        const redeemKey = `redeemed:${cleanKey}`;
        const alreadyRedeemed = await kv.get(redeemKey);

        if (alreadyRedeemed) {
            return res.status(400).json({
                success: false,
                error: "Key này đã được kích hoạt trước đó"
            });
        }

        const record = {
            minecraftUsername: username,
            discordId: discordId || null,
            redeemedAt: Date.now()
        };

        await kv.set(redeemKey, record);
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
