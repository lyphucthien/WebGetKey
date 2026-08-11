const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const MAX_RETRIES = 10;
const SECRET = process.env.VERIFY_SECRET;
const TOKEN_MAX_AGE_MS = 15 * 60 * 1000;

if (!SECRET) {
    throw new Error("VERIFY_SECRET is not configured");
}

function isValidToken(token) {
    if (!token || typeof token !== "string") {
        return false;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
        return false;
    }

    const [ts, sig] = parts;

    const timestamp = Number(ts);

    if (!Number.isFinite(timestamp)) {
        return false;
    }

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

    const age = Date.now() - timestamp;

    return age >= 0 && age <= TOKEN_MAX_AGE_MS;
}

function getClientIp(req) {
    const forwarded =
        req.headers["x-forwarded-for"] || "";

    return (
        forwarded.split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        "unknown"
    );
}

module.exports = async (req, res) => {
    try {
        // =====================================
        // 1. LẤY TOKEN
        // =====================================

        const token = req.query?.token;

        if (!isValidToken(token)) {
            return res.status(403).json({
                success: false,
                error: "Token không hợp lệ hoặc đã hết hạn"
            });
        }

        // =====================================
        // 2. LẤY IP
        // =====================================

        const ip = getClientIp(req);

        // =====================================
        // 3. KIỂM TRA TOKEN ĐÃ DÙNG CHƯA
        // =====================================

        const tokenKey = `used-token:${token}`;

        const alreadyUsed = await kv.get(tokenKey);

        if (alreadyUsed) {
            return res.status(403).json({
                success: false,
                error: "Token này đã được sử dụng"
            });
        }

        // =====================================
        // 4. KIỂM TRA IP
        // =====================================

        const ipKey = `ip:${ip}`;

        const alreadyClaimedByIp =
            await kv.get(ipKey);

        if (alreadyClaimedByIp) {
            return res.status(200).json({
                success: false,
                error: "IP này đã nhận KEY rồi"
            });
        }

        // =====================================
        // 5. ĐỌC keys.json
        // =====================================

        const keysPath = path.join(
            process.cwd(),
            "keys.json"
        );

        const keysData = JSON.parse(
            fs.readFileSync(keysPath, "utf8")
        );

        if (!Array.isArray(keysData)) {
            throw new Error(
                "keys.json must contain an array of keys"
            );
        }

        const keys = keysData
            .map(key => String(key).trim())
            .filter(Boolean);

        if (keys.length === 0) {
            return res.status(404).json({
                success: false,
                error: "No keys available"
            });
        }

        // =====================================
        // 6. TÌM KEY CHƯA CLAIM
        // =====================================

        for (
            let attempt = 0;
            attempt < MAX_RETRIES;
            attempt++
        ) {
            const claimedKeys =
                (await kv.get("claimed-keys")) || [];

            const availableKey = keys.find(
                key => !claimedKeys.includes(key)
            );

            if (!availableKey) {
                return res.status(404).json({
                    success: false,
                    error: "All keys have been claimed"
                });
            }

            const updatedClaims = [
                ...claimedKeys,
                availableKey
            ];

            // =====================================
            // 7. LƯU KEY + IP + TOKEN
            // =====================================

            await kv.set(
                "claimed-keys",
                updatedClaims
            );

            await kv.set(
                ipKey,
                availableKey
            );

            // Token chỉ sử dụng 1 lần
            await kv.set(
                tokenKey,
                true,
                {
                    ex: 15 * 60
                }
            );

            // =====================================
            // 8. TRẢ KEY
            // =====================================

            return res.status(200).json({
                success: true,
                key: availableKey
            });
        }

        // =====================================
        // 9. SERVER BẬN
        // =====================================

        return res.status(503).json({
            success: false,
            error: "Server is busy, please try again"
        });

    } catch (error) {
        console.error(
            "Get key error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};