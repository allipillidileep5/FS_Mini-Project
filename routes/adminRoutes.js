const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const tokensFile = path.join(__dirname, "..", "data", "tokens.json");

function readTokens() {
    try {
        if (!fs.existsSync(tokensFile)) fs.writeFileSync(tokensFile, "[]");
        const raw = fs.readFileSync(tokensFile, "utf8").trim();
        const tokens = raw ? JSON.parse(raw) : [];

        return tokens.map((token) => ({
            ...token,
            id: String(token.id),
            serviceId: String(token.serviceId),
            status: String(token.status || "waiting").toLowerCase(),
            date: token.date || (token.createdAt ? token.createdAt.slice(0, 10) : "")
        }));
    } catch (error) {
        console.error("Token read error:", error);
        return [];
    }
}

function writeTokens(tokens) {
    fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
}

function sortByCreatedAt(a, b) {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

router.get("/current", (req, res) => {
    const tokens = readTokens();
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;

    const currentToken = tokens.find((token) =>
        token.status === "serving" &&
        (!serviceId || token.serviceId === serviceId)
    ) || null;

    res.json({ success: true, currentToken });
});

router.get("/queue", (req, res) => {
    const tokens = readTokens();
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;

    const queue = tokens
        .filter((token) =>
            token.status === "waiting" &&
            (!serviceId || token.serviceId === serviceId)
        )
        .sort(sortByCreatedAt);

    res.json({ success: true, queue });
});

router.put("/next", (req, res) => {
    const serviceId = req.body.serviceId ? String(req.body.serviceId) : "";

    if (!serviceId) {
        return res.status(400).json({
            success: false,
            message: "Service is required"
        });
    }

    const tokens = readTokens();

    const currentToken = tokens.find(
        (token) => token.serviceId === serviceId && token.status === "serving"
    );

    if (currentToken) {
        currentToken.status = "completed";
        currentToken.completedAt = new Date().toISOString();
    }

    const nextToken = tokens
        .filter((token) => token.serviceId === serviceId && token.status === "waiting")
        .sort(sortByCreatedAt)[0];

    if (!nextToken) {
        writeTokens(tokens);
        return res.json({
            success: true,
            message: currentToken
                ? `${currentToken.tokenNumber} completed. No waiting tokens.`
                : "No waiting tokens",
            currentToken: null
        });
    }

    nextToken.status = "serving";
    nextToken.calledAt = new Date().toISOString();

    writeTokens(tokens);

    res.json({
        success: true,
        message: `Now serving ${nextToken.tokenNumber}`,
        currentToken: nextToken
    });
});

router.get("/statistics", (req, res) => {
    const tokens = readTokens();
    const today = new Date().toISOString().slice(0, 10);
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;

    const todayTokens = tokens.filter((token) =>
        token.date === today &&
        (!serviceId || token.serviceId === serviceId)
    );

    const statistics = {
        total: todayTokens.length,
        waiting: todayTokens.filter((token) => token.status === "waiting").length,
        serving: todayTokens.filter((token) => token.status === "serving").length,
        completed: todayTokens.filter((token) => token.status === "completed").length,
        cancelled: todayTokens.filter((token) => token.status === "cancelled").length,
        skipped: todayTokens.filter((token) => token.status === "skipped").length
    };

    res.json({ success: true, statistics });
});

module.exports = router;
