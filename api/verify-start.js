const crypto = require("crypto");

// Đổi chuỗi bí mật này, và đặt trùng giá trị vào biến môi trường
// VERIFY_SECRET trên Vercel (Project Settings -> Environment Variables)
const SECRET = process.env.VERIFY_SECRET || "doi-chuoi-bi-mat-nay";

module.exports = async (req, res) => {

    const ts = Date.now().toString();

    const sig = crypto
        .createHmac("sha256", SECRET)
        .update(ts)
        .digest("hex");

    const token = `${ts}.${sig}`;

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;

    res.writeHead(302, {
        Location: `${proto}://${host}/?token=${token}`
    });

    res.end();
};
