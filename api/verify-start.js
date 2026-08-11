const crypto = require("crypto");

const SECRET = process.env.VERIFY_SECRET;

if (!SECRET) {
    throw new Error("VERIFY_SECRET is not configured");
}

module.exports = async (req, res) => {
    try {
        const ts = Date.now().toString();

        const sig = crypto
            .createHmac("sha256", SECRET)
            .update(ts)
            .digest("hex");

        const token = `${ts}.${sig}`;
        const cookie = [
            `verify_token=${encodeURIComponent(token)}`,
            "Max-Age=900",
            "Path=/",
            "HttpOnly",
            "Secure",
            "SameSite=Lax"
        ].join("; ");

        res.writeHead(302, {
            "Set-Cookie": cookie,
            "Location": "/"
        });

        res.end();

    } catch (error) {
        console.error("Verify start error:", error);

        res.status(500).json({
            success: false,
            error: "Unable to create verification token"
        });
    }
};