const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const keysFile = path.join(__dirname, "keys.json");

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/get-key", (req, res) => {

    try {

        const data = JSON.parse(
            fs.readFileSync(keysFile, "utf8")
        );

        if (!data.keys || data.keys.length === 0) {

            return res.json({
                success: false,
                message: "Hết KEY"
            });

        }

        // Lấy KEY đầu tiên
        const key = data.keys.shift();

        // Lưu lại file
        fs.writeFileSync(
            keysFile,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        console.log(`[KEY] Đã cấp: ${key}`);

        res.json({
            success: true,
            key: key
        });

    } catch (error) {

        console.error("[ERROR]", error);

        res.status(500).json({
            success: false,
            message: "Lỗi server"
        });

    }

});

app.listen(PORT, () => {
    console.log(`Web đang chạy tại http://localhost:${PORT}`);
});