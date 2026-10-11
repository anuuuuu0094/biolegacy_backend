const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const env = require("./config/env");
const routes = require("./routes");
const { apiLimiter } = require("./middleware/security");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const webhookRoutes = require("./modules/payments/webhook.routes");

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  })
);
// Razorpay signs the exact request bytes. This route must run before express.json().
app.use("/api/v1/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }), webhookRoutes);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(apiLimiter);

app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
