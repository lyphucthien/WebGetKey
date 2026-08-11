const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const MAX_RETRIES = 10;

// PHẢI TRÙNG với secret trong api/verify-start.js
const SECRET = process.env.VERIFY_SECRET || "doi-chuoi-bi-mat-nay";

// Token có hiệu lực trong 15 phút kể từ lúc tạo
const TOKEN_MAX_AGE_MS = 15 * 60 * 1000;

function isValidToken(token) {
    if (!token || typeof token !== "string") return false;

    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [ts, sig] = parts;

    const expectedSig = crypto
        .createHmac("sha256", SECRET)
        .update(ts)
        .digest("hex");

    const sigBuf = Buffer.from(sig, "utf8");
    const expectedBuf = Buffer.from(expectedSig, "utf8");

    if (
        sigBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
        return false;
    }

    const age = Date.now() - Number(ts);

    return age >= 0 && age <= TOKEN_MAX_AGE_MS;
}

function getClientIp(req) {
    const fwd = req.headers["x-forwarded-for"] || "";
    return (
        fwd.split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        "unknown"
    );
}

module.exports = async (req, res) => {
    try {
        const ip = getClientIp(req);

        // Đọc danh sách key gốc
        const keysPath = path.join(process.cwd(), "keys.json");

        const keysData = JSON.parse(
            fs.readFileSync(keysPath, "utf8")
        );

        if (!Array.isArray(keysData)) {
            throw new Error("keys.json must contain an array of keys");
        }

        const keys = keysData
            .map(key => String(key).trim())
            .filter(Boolean);

        if (keys.length === 0) {
            res.status(404).json({
                success: false,
                error: "No keys available"
            });
            return;
        }

        // Kiểm tra IP đã nhận key chưa (lưu trên Vercel KV)
        const alreadyClaimedByIp = await kv.get(`ip:${ip}`);

        if (alreadyClaimedByIp) {
            res.status(200).json({
                success: false,
                error: "IP này đã nhận KEY rồi"
            });
            return;
        }

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {

            const claimedKeys =
                (await kv.get("claimed-keys")) || [];

            const availableKey = keys.find(
                key => !claimedKeys.includes(key)
            );

            if (!availableKey) {
                res.status(404).json({
                    success: false,
                    error: "All keys have been claimed"
                });
                return;
            }

            const updatedClaims = [
                ...claimedKeys,
                availableKey
            ];

            await kv.set("claimed-keys", updatedClaims);
            await kv.set(`ip:${ip}`, availableKey);

            res.status(200).json({
                success: true,
                key: availableKey
            });
            return;
        }

        res.status(503).json({
            success: false,
            error: "Server is busy, please try again"
        });

    } catch (error) {
        console.error("Get key error:", error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
