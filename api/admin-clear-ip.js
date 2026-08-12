const { kv } = require("@vercel/kv");

const SECRET = process.env.VERIFY_SECRET;

if (!SECRET) {
    throw new Error("VERIFY_SECRET is not configured");
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

// Endpoint TẠM THỜI để xoá khoá "IP đã nhận KEY" đang bị dính lại
// (do các bản ghi cũ không có thời hạn tự hết hạn).
//
// Cách dùng: mở trong trình duyệt
//   /api/admin-clear-ip?secret=VERIFY_SECRET_CUA_BAN
// -> tự xoá khoá cho đúng IP đang gọi request này.
//
// XOÁ FILE NÀY sau khi dùng xong để tránh ai đó dò được secret rồi tự xoá khoá của họ.
module.exports = async (req, res) => {
    try {
        const secret = req.query?.secret;

        if (!secret || secret !== SECRET) {
            return res.status(403).json({
                success: false,
                error: "Sai secret"
            });
        }

        const ip =
            req.query?.ip || getClientIp(req);

        const ipKey = `ip:${ip}`;

        const existed = await kv.get(ipKey);

        await kv.del(ipKey);

        return res.status(200).json({
            success: true,
            ip,
            existed: Boolean(existed)
        });

    } catch (error) {
        console.error(
            "Admin clear ip error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
