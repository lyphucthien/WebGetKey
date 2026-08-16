const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const SECRET = process.env.VERIFY_SECRET;

if (!SECRET) {
    throw new Error("VERIFY_SECRET is not configured");
}

// Các key trong KV ứng với từng loại
const RESET_TARGETS = {
    minecraft: {
        kvList: "remaining-keys"
        // Không xoá "keys.json" gốc, chỉ xoá bản nạp trong KV
        // -> lần gọi get-key tiếp theo sẽ nạp lại full từ keys.json
    },
    lpthub: {
        kvIssuedSet: "issued-set-lpthub"
        // Xoá tập key đã phát -> các key cũ có thể được sinh/dùng lại
    }
};

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

        // =====================================
        // 1. KIỂM TRA MẬT KHẨU ADMIN
        // =====================================

        const secret = req.query?.secret;

        if (!secret || !safeEqual(secret, SECRET)) {
            return res.status(403).json({
                success: false,
                error: "Sai mật khẩu admin"
            });
        }

        // =====================================
        // 2. LOẠI CẦN RESET
        // =====================================

        const typeParam =
            (req.query?.type || "")
                .toString()
                .toLowerCase();

        const target = RESET_TARGETS[typeParam];

        if (!target) {
            return res.status(400).json({
                success: false,
                error: "type phải là 'minecraft' hoặc 'lpthub'"
            });
        }

        // =====================================
        // 3. TUỲ CHỌN: RESET LUÔN KHOÁ IP
        //    ?resetIp=1
        // =====================================

        const resetIp = req.query?.resetIp === "1";

        // =====================================
        // 4. XOÁ DỮ LIỆU TRONG KV
        // =====================================

        if (target.kvList) {
            await kv.del(target.kvList);
        }

        if (target.kvIssuedSet) {
            await kv.del(target.kvIssuedSet);
        }

        let ipNote = "Không đụng tới khoá IP";

        if (resetIp) {
            // Lưu ý: KV không hỗ trợ xoá theo prefix trực tiếp
            // qua REST API miễn phí một cách đơn giản, nên phần
            // khoá IP cần xoá thủ công trong Upstash Data Browser
            // (gõ: KEYS ip-lpthub:* hoặc ip:*  rồi xoá từng key),
            // hoặc đợi tự hết hạn (3 tiếng).
            ipNote =
                "Muốn xoá khoá IP, vào Upstash Data Browser " +
                "tìm theo prefix tương ứng và xoá thủ công " +
                "(hoặc đợi tự hết hạn).";
        }

        return res.status(200).json({
            success: true,
            message: `Đã reset dữ liệu key cho loại "${typeParam}"`,
            ipNote
        });

    } catch (error) {

        console.error("Admin reset error:", error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
