const fs = require("fs");
const path = require("path");

exports.handler = async function () {
    try {
        const keysFile = path.join(
            process.cwd(),
            "keys.json"
        );

        const data = JSON.parse(
            fs.readFileSync(keysFile, "utf8")
        );

        if (!data.keys || data.keys.length === 0) {
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    success: false,
                    message: "Hết KEY"
                })
            };
        }

        // Lấy KEY đầu tiên
        const key = data.keys.shift();

        // Lưu lại
        fs.writeFileSync(
            keysFile,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        console.log("[KEY] Đã cấp:", key);

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                success: true,
                key: key
            })
        };

    } catch (error) {

        console.error("[ERROR]", error);

        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                success: false,
                message: "Lỗi server"
            })
        };
    }
};