const fs = require("fs");
const path = require("path");

exports.handler = async function () {
    try {
        const keysPath = path.join(process.cwd(), "keys.json");

        const keys = JSON.parse(
            fs.readFileSync(keysPath, "utf8")
        );

        if (!Array.isArray(keys) || keys.length === 0) {
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

        // Lấy key đầu tiên
        const key = keys[0];

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
