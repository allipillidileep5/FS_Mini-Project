const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const COOKIE_NAME = "queueflow_session";
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const DATA_FOLDER = path.join(__dirname, "..", "data");
const SECRET_FILE = path.join(DATA_FOLDER, ".session-secret");

function loadSessionSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

    try {
        if (!fs.existsSync(DATA_FOLDER)) {
            fs.mkdirSync(DATA_FOLDER, { recursive: true });
        }
        if (fs.existsSync(SECRET_FILE)) {
            const existing = fs.readFileSync(SECRET_FILE, "utf8").trim();
            if (existing) return existing;
        }

        const generated = crypto.randomBytes(48).toString("hex");
        fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
        return generated;
    } catch (error) {
        console.error("Could not persist session secret:", error.message);
        return crypto.randomBytes(48).toString("hex");
    }
}

const SESSION_SECRET = loadSessionSecret();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

function base64url(value) {
    return Buffer.from(value).toString("base64url");
}

function sign(payload) {
    return crypto
        .createHmac("sha256", SESSION_SECRET)
        .update(payload)
        .digest("base64url");
}

function createCookieValue(data) {
    const payload = base64url(JSON.stringify({
        ...data,
        exp: Date.now() + SESSION_MAX_AGE
    }));
    return `${payload}.${sign(payload)}`;
}

function verifyCookieValue(value) {
    if (!value || typeof value !== "string") return null;

    const separator = value.lastIndexOf(".");
    if (separator <= 0) return null;

    const payload = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    const expected = sign(payload);

    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
        actualBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
        return null;
    }

    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!data.exp || Date.now() > Number(data.exp)) return null;
        if (!["user", "admin"].includes(data.role)) return null;
        if (data.role === "user" && !data.userId) return null;
        return data;
    } catch {
        return null;
    }
}

function parseCookies(req) {
    const header = req.headers.cookie || "";
    return header.split(";").reduce((cookies, part) => {
        const index = part.indexOf("=");
        if (index === -1) return cookies;
        const key = part.slice(0, index).trim();
        try {
            const value = decodeURIComponent(part.slice(index + 1).trim());
            cookies[key] = value;
        } catch {
            // Ignore malformed cookies instead of failing the request.
        }
        return cookies;
    }, {});
}

function setSessionCookie(res, data) {
    const value = createCookieValue(data);
    res.setHeader(
        "Set-Cookie",
        `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${Math.floor(
            SESSION_MAX_AGE / 1000
        )}; Path=/; HttpOnly; SameSite=Lax`
    );
}

function clearSessionCookie(res) {
    res.setHeader(
        "Set-Cookie",
        `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
    );
}

function ensureIdentity(req, res, next) {
    const cookies = parseCookies(req);
    const session = verifyCookieValue(cookies[COOKIE_NAME]);

    if (session) {
        req.auth = session;
        return next();
    }

    const userId = crypto.randomUUID();
    req.auth = {
        role: "user",
        userId
    };
    setSessionCookie(res, req.auth);
    next();
}

function requireAdmin(req, res, next) {
    res.setHeader("Cache-Control", "no-store");
    if (req.auth?.role !== "admin") {
        return res.status(401).json({
            success: false,
            message: "Admin authentication required"
        });
    }
    next();
}

function requireOwnerOrAdmin(getOwnerId) {
    return (req, res, next) => {
        if (req.auth?.role === "admin") return next();

        const ownerId = getOwnerId(req);
        if (!ownerId || ownerId !== req.auth?.userId) {
            return res.status(403).json({
                success: false,
                message: "You are not allowed to access this token"
            });
        }

        next();
    };
}

function login(req, res) {
    const username = typeof req.body.username === "string"
        ? req.body.username.trim()
        : "";
    const password = typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (
        username !== ADMIN_USERNAME ||
        password !== ADMIN_PASSWORD
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid admin username or password"
        });
    }

    setSessionCookie(res, {
        role: "admin",
        userId: `admin:${ADMIN_USERNAME}`
    });

    res.json({
        success: true,
        message: "Admin login successful"
    });
}

function me(req, res) {
    res.json({
        success: true,
        authenticated: Boolean(req.auth),
        role: req.auth?.role || null
    });
}

module.exports = {
    COOKIE_NAME,
    ADMIN_USERNAME,
    SESSION_MAX_AGE,
    clearSessionCookie,
    ensureIdentity,
    login,
    me,
    parseCookies,
    requireAdmin,
    requireOwnerOrAdmin,
    setSessionCookie,
    verifyCookieValue
};
