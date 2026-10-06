const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const { requireAdmin } = require("../middleware/auth");
const tokensFile = path.join(__dirname, "..", "data", "tokens.json");
const servicesFile = path.join(__dirname, "..", "data", "services.json");

const VALID_STATUSES = ["waiting", "serving", "completed", "cancelled", "skipped"];

function readJSON(file) {
    try {
        if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
        const raw = fs.readFileSync(file, "utf8").trim();
        return raw ? JSON.parse(raw) : [];
    } catch (error) {
        console.error(`Could not read ${file}:`, error.message);
        return [];
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeToken(token) {
    const normalized = {
        ...token,
        id: String(token.id),
        serviceId: String(token.serviceId),
        status: String(token.status || "waiting").toLowerCase()
    };
    if (!normalized.date && normalized.createdAt) {
        normalized.date = normalized.createdAt.slice(0, 10);
    }
    if (!normalized.name && normalized.customerName) {
        normalized.name = normalized.customerName;
    }
    if (!normalized.customerName && normalized.name) {
        normalized.customerName = normalized.name;
    }
    return normalized;
}

function readTokens() {
    const tokens = readJSON(tokensFile).map(normalizeToken);
    writeJSON(tokensFile, tokens);
    return tokens;
}


function publicToken(token) {
    if (!token) return null;
    const { ownerId, ...safeToken } = token;
    return safeToken;
}

function getPeopleAhead(tokens, token) {
    if (token.status !== "waiting") return 0;
    return tokens.filter((item) =>
        String(item.serviceId) === String(token.serviceId) &&
        item.status === "waiting" &&
        new Date(item.createdAt).getTime() < new Date(token.createdAt).getTime()
    ).length;
}

router.get("/", requireAdmin, (req, res) => {
    res.json({ success: true, tokens: readTokens() });
});

router.get("/public/summary", (req, res) => {
    const tokens = readTokens();

    const waiting = tokens.filter((token) => token.status === "waiting").length;
    const completed = tokens.filter((token) => token.status === "completed").length;
    const serving = tokens.find((token) => token.status === "serving") || null;

    // Deliberately do not return customer names or private token records.
    res.json({
        success: true,
        summary: {
            waiting,
            completed,
            currentToken: serving ? serving.tokenNumber : null
        }
    });
});


router.get("/number/:tokenNumber", (req, res) => {
    const tokenNumber = String(req.params.tokenNumber).trim().toUpperCase();
    const tokens = readTokens();

    const token = tokens.find(
        (item) =>
            String(item.tokenNumber).toUpperCase() === tokenNumber &&
            (req.auth?.role === "admin" || item.ownerId === req.auth?.userId)
    );

    if (!token) {
        return res.status(404).json({
            success: false,
            message: "Token number not found"
        });
    }

    res.json({
        success: true,
        token: publicToken(token),
        peopleAhead: getPeopleAhead(tokens, token)
    });
});

router.get("/:id", (req, res) => {
    const tokens = readTokens();
    const token = tokens.find((item) => String(item.id) === String(req.params.id));

    if (!token) {
        return res.status(404).json({
            success: false,
            message: "Token not found"
        });
    }

    if (req.auth?.role !== "admin" && token.ownerId !== req.auth?.userId) {
        return res.status(403).json({
            success: false,
            message: "You are not allowed to access this token"
        });
    }

    res.json({
        success: true,
        token: {
            ...publicToken(token),
            peopleAhead: getPeopleAhead(tokens, token)
        }
    });
});

router.post("/", (req, res) => {
    try {
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        const serviceId = req.body.serviceId;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Please enter your name"
            });
        }

        if (name.length > 80) {
            return res.status(400).json({
                success: false,
                message: "Name must be 80 characters or less"
            });
        }

        if (!serviceId) {
            return res.status(400).json({
                success: false,
                message: "Please select a service"
            });
        }

        const services = readJSON(servicesFile);
        const tokens = readTokens();
        const service = services.find(
            (item) => String(item.id) === String(serviceId)
        );

        if (!service) {
            return res.status(404).json({
                success: false,
                message: "Selected service not found"
            });
        }

        const serviceTokens = tokens.filter(
            (item) => String(item.serviceId) === String(service.id)
        );

        const numbers = serviceTokens.map((item) => {
            const match = String(item.tokenNumber || "").match(/(\d+)$/);
            return match ? Number(match[1]) : 0;
        });

        const nextNumber = (numbers.length ? Math.max(...numbers) : 0) + 1;
        const tokenNumber = `${service.prefix}${String(nextNumber).padStart(3, "0")}`;
        const now = new Date();

        const newToken = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            tokenNumber,
            name,
            customerName: name,
            ownerId: req.auth.userId,
            serviceId: String(service.id),
            serviceName: service.name,
            prefix: service.prefix,
            status: "waiting",
            createdAt: now.toISOString(),
            date: now.toISOString().slice(0, 10)
        };

        tokens.push(newToken);
        writeJSON(tokensFile, tokens);

        res.status(201).json({
            success: true,
            message: "Token generated successfully",
            token: {
                ...publicToken(newToken),
                peopleAhead: getPeopleAhead(tokens, newToken)
            }
        });
    } catch (error) {
        console.error("Token creation error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to generate token"
        });
    }
});

router.put("/:id/status", requireAdmin, (req, res) => {
    const status = String(req.body.status || "").toLowerCase();

    if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
            success: false,
            message: `Invalid status. Use: ${VALID_STATUSES.join(", ")}`
        });
    }

    const tokens = readTokens();
    const index = tokens.findIndex(
        (item) => String(item.id) === String(req.params.id)
    );

    if (index === -1) {
        return res.status(404).json({
            success: false,
            message: "Token not found"
        });
    }

    // Only one token can be serving for a service.
    if (status === "serving") {
        tokens.forEach((item) => {
            if (
                item.serviceId === tokens[index].serviceId &&
                item.status === "serving" &&
                item.id !== tokens[index].id
            ) {
                item.status = "completed";
                item.completedAt = new Date().toISOString();
            }
        });
        tokens[index].calledAt = new Date().toISOString();
    }

    if (status === "completed") {
        tokens[index].completedAt = new Date().toISOString();
    }

    tokens[index].status = status;
    writeJSON(tokensFile, tokens);

    res.json({ success: true, token: tokens[index] });
});


module.exports = router;
