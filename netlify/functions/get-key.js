const fs = require("fs");
const path = require("path");
const { getStore } = require("@netlify/blobs");

const MAX_RETRIES = 10;

function getClientIp(event) {
    const fwd = (event.headers && event.headers["x-forwarded-for"]) || "";
    return (
        fwd.split(",")[0].trim() ||
        (event.headers && event.headers["x-nf-client-connection-ip"]) ||
        "unknown"
    );
}

exports.handler = async function (event) {
    try {
        const ip = getClientIp(event);
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
            return {
                statusCode: 404,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    success: false,
                    error: "No keys available"
                })
            };
        }

        // Netlify Blobs lưu các key đã cấp
        const store = getStore({
            name: "minecraft-key-claims",
            consistency: "strong"
        });

        // Netlify Blobs lưu các IP đã nhận key
        const ipStore = getStore({
            name: "minecraft-key-ip-claims",
            consistency: "strong"
        });

        const alreadyClaimedByIp = await ipStore.get(ip);

        if (alreadyClaimedByIp) {
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    success: false,
                    error: "IP này đã nhận KEY rồi"
                })
            };
        }

        /*
         * Retry để xử lý trường hợp:
         *
         * User A ─┐
         *          ├─ cùng lúc lấy key
         * User B ─┘
         *
         * Conditional write sẽ đảm bảo chỉ một request
         * có thể claim cùng một trạng thái.
         */
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {

            const current = await store.getWithMetadata(
                "claimed-keys",
                {
                    type: "json"
                }
            );

            let claimedKeys = [];
            let etag = null;

            if (current) {
                claimedKeys = Array.isArray(current.data)
                    ? current.data
                    : [];

                etag = current.etag;
            }

            // Tìm key đầu tiên chưa được cấp
            const availableKey = keys.find(
                key => !claimedKeys.includes(key)
            );

            if (!availableKey) {
                return {
                    statusCode: 404,
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        success: false,
                        error: "All keys have been claimed"
                    })
                };
            }

            // Thêm key vào danh sách đã cấp
            const updatedClaims = [
                ...claimedKeys,
                availableKey
            ];

            let result;

            if (!current) {
                // Chưa có dữ liệu → chỉ request đầu tiên được tạo
                result = await store.setJSON(
                    "claimed-keys",
                    updatedClaims,
                    {
                        onlyIfNew: true
                    }
                );
            } else {
                // Đã có dữ liệu → chỉ cập nhật nếu dữ liệu
                // chưa bị request khác thay đổi
                result = await store.setJSON(
                    "claimed-keys",
                    updatedClaims,
                    {
                        onlyIfMatch: etag
                    }
                );
            }

            // Claim thành công
            if (result.modified) {

                await ipStore.set(ip, availableKey);

                return {
                    statusCode: 200,
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-store"
                    },
                    body: JSON.stringify({
                        success: true,
                        key: availableKey
                    })
                };
            }

            // Có request khác claim trước → thử lại
        }

        return {
            statusCode: 503,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                success: false,
                error: "Server is busy, please try again"
            })
        };

    } catch (error) {
        console.error("Get key error:", error);

        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};
