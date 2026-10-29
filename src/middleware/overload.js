const env = require("../config/env");
const pool = require("../db/pool");

function rejectWhenDatabaseQueueIsFull(req, res, next) {
  if (req.path.endsWith("/live") || pool.waitingCount < env.dbPoolMaxWaiting) return next();
  res.set("Retry-After", "1");
  return res.status(503).json({
    success: false,
    message: "The service is temporarily busy. Please retry shortly.",
  });
}

module.exports = rejectWhenDatabaseQueueIsFull;
