const { createClient } = require("redis");
const env = require("../config/env");

let client;

function getRedisClient() {
  if (env.rateLimitStore !== "redis") return null;
  if (!client) {
    client = createClient({
      url: env.redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy(retries) {
          if (retries > 10) return new Error("Redis reconnect limit reached");
          return Math.min(50 * (2 ** Math.min(retries, 6)), 3000);
        },
      },
    });
    client.on("error", (error) => {
      console.error("Redis connection error", { message: error.message });
    });
  }
  return client;
}

async function connectRedis() {
  const redis = getRedisClient();
  if (redis && !redis.isOpen) await redis.connect();
}

async function closeRedis() {
  if (client?.isOpen) await client.quit();
}

module.exports = { getRedisClient, connectRedis, closeRedis };
