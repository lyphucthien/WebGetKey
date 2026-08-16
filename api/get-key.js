const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const SECRET = process.env.VERIFY_SECRET;

const TOKEN_MAX_AGE_MS = 15 * 60 * 1000;

// Khớp với cooldown 2 tiếng 50 phút bên frontend
const IP_LOCK_SECONDS = (2 * 60 * 60 + 50 * 60); // 10200s

// =====================================
// CẤU HÌNH TỪNG LOẠI KEY
// =====================================

const KEY_TYPES = {
    minecraft: {
        file: "keys.json",
        kvList: "remaining-keys",
        ipPrefix: "ip"
    },
    lpthub: {
        file: "keys-lpthub.json",
        kvList: "remaining-keys-lpthub",
        ipPrefix: "ip-lpthub"
    }
};

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

function getCookie(req, name) {
    const cookieHeader = req.headers.cookie;

    if (!cookieHeader) {
        return null;
    }

    const cookies = cookieHeader.split(";");

    for (const cookie of cookies) {
        const [key, ...valueParts] = cookie.trim().split("=");

        if (key === name) {
            return decodeURIComponent(valueParts.join("="));
        }
    }

    return null;
}

module.exports = async (req, res) => {
    try {

        // =====================================
        // 1. LẤY LOẠI KEY (type)
        // =====================================

        const typeParam =
            (req.query?.type || "minecraft")
                .toString()
                .toLowerCase();

        const typeConfig = KEY_TYPES[typeParam];

        if (!typeConfig) {
            return res.status(400).json({
                success: false,
                error: "Loại key không hợp lệ"
            });
        }

        // =====================================
        // 2. LẤY TOKEN
        // =====================================

        let token = req.query?.token;

        // Nếu không có token trên URL,
        // lấy token từ cookie
        if (!token) {
            token = getCookie(req, "verify_token");
        }

        // =====================================
        // 3. KIỂM TRA TOKEN
        // =====================================

        if (!isValidToken(token)) {
            return res.status(403).json({
                success: false,
                error: "Token không hợp lệ hoặc đã hết hạn"
            });
        }

        // =====================================
        // 4. LẤY IP
        // =====================================

        const ip = getClientIp(req);

        // =====================================
        // 5. TOKEN ĐÃ DÙNG?
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
        // 6. IP ĐÃ NHẬN KEY LOẠI NÀY?
        // =====================================

        const ipKey = `${typeConfig.ipPrefix}:${ip}`;

        const alreadyClaimedByIp =
            await kv.get(ipKey);

        if (alreadyClaimedByIp) {
            return res.status(200).json({
                success: false,
                error: "IP này đã nhận KEY rồi"
            });
        }

        // =====================================
        // 7. LẤY DANH SÁCH KEY CÒN LẠI TỪ KV
        //    (nạp từ file json nếu KV chưa có)
        // =====================================

        let keys = await kv.get(typeConfig.kvList);

        if (!keys) {
            const keysPath = path.join(
                process.cwd(),
                typeConfig.file
            );

            const keysData = JSON.parse(
                fs.readFileSync(keysPath, "utf8")
            );

            if (!Array.isArray(keysData)) {
                throw new Error(
                    typeConfig.file + " must contain an array of keys"
                );
            }

            keys = keysData
                .map(key => String(key).trim())
                .filter(Boolean);

            await kv.set(typeConfig.kvList, keys);
        }

        if (keys.length === 0) {
            return res.status(404).json({
                success: false,
                error: "All keys have been claimed"
            });
        }

        // =====================================
        // 8. LẤY KEY ĐẦU TIÊN VÀ XOÁ KHỎI DANH SÁCH
        // =====================================

        for (let attempt = 0; attempt < 10; attempt++) {

            const currentKeys =
                (await kv.get(typeConfig.kvList)) || [];

            const availableKey = currentKeys[0];

            if (!availableKey) {
                return res.status(404).json({
                    success: false,
                    error: "All keys have been claimed"
                });
            }

            const updatedKeys = currentKeys.slice(1);

            // =====================================
            // 9. LƯU DỮ LIỆU
            // =====================================

            await kv.set(
                typeConfig.kvList,
                updatedKeys
            );

            await kv.set(
                ipKey,
                availableKey,
                {
                    ex: IP_LOCK_SECONDS
                }
            );

            // Token chỉ được sử dụng 1 lần
            await kv.set(
                tokenKey,
                true,
                {
                    ex: 15 * 60
                }
            );

            // Xóa cookie sau khi nhận KEY
            res.setHeader(
                "Set-Cookie",
                "verify_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
            );

            // =====================================
            // 9. TRẢ KEY
            // =====================================

            return res.status(200).json({
                success: true,
                key: availableKey
            });
        }

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