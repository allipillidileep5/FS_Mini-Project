const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const { requireAdmin } = require("../middleware/auth");
const servicesFile = path.join(__dirname, "..", "data", "services.json");
const tokensFile = path.join(__dirname, "..", "data", "tokens.json");

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

router.get("/", (req, res) => {
    res.json({ success: true, services: readJSON(servicesFile) });
});

router.post("/", requireAdmin, (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const prefix = typeof req.body.prefix === "string"
        ? req.body.prefix.trim().toUpperCase()
        : "";

    if (!name) {
        return res.status(400).json({
            success: false,
            message: "Service name is required"
        });
    }

    if (name.length > 60) {
        return res.status(400).json({
            success: false,
            message: "Service name must be 60 characters or less"
        });
    }

    if (!/^[A-Z]{1,3}$/.test(prefix)) {
        return res.status(400).json({
            success: false,
            message: "Prefix must contain 1 to 3 letters only"
        });
    }

    const services = readJSON(servicesFile);

    if (services.some((service) => service.name.toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({
            success: false,
            message: "A service with this name already exists"
        });
    }

    if (services.some((service) => service.prefix.toUpperCase() === prefix)) {
        return res.status(409).json({
            success: false,
            message: "This token prefix is already in use"
        });
    }

    const ids = services.map((service) => Number(service.id)).filter(Number.isFinite);
    const id = String(ids.length ? Math.max(...ids) + 1 : 1);

    const service = { id, name, prefix };
    services.push(service);
    writeJSON(servicesFile, services);

    res.status(201).json({
        success: true,
        message: "Service added successfully",
        service
    });
});

router.delete("/:id", requireAdmin, (req, res) => {
    const services = readJSON(servicesFile);
    const id = String(req.params.id);
    const index = services.findIndex((service) => String(service.id) === id);

    if (index === -1) {
        return res.status(404).json({
            success: false,
            message: "Service not found"
        });
    }

    const tokens = readJSON(tokensFile);
    const hasTokens = tokens.some((token) => String(token.serviceId) === id);

    if (hasTokens) {
        return res.status(409).json({
            success: false,
            message: "This service cannot be deleted because it has token history"
        });
    }

    services.splice(index, 1);
    writeJSON(servicesFile, services);

    res.json({
        success: true,
        message: "Service deleted successfully"
    });
});

module.exports = router;
