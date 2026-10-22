const Joi = require("joi");

const password = (minimum = 8) => Joi.string()
  .min(minimum)
  .max(128)
  .custom((value, helpers) => (
    Buffer.byteLength(value, "utf8") <= 72 ? value : helpers.error("password.tooLong")
  ))
  .messages({ "password.tooLong": "Password must be at most 72 UTF-8 bytes" });

const loginSchema = Joi.object({
  email: Joi.string().email().max(254).required(),
  password: password().required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const createUserSchema = Joi.object({
  fullName: Joi.string().min(2).max(120).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^[0-9]{10}$/).allow("", null),
  password: password().required(),
  role: Joi.string().valid("TEACHER_ADMIN", "STUDENT").default("STUDENT"),
  status: Joi.string().valid("ACTIVE", "PENDING", "SUSPENDED").default("ACTIVE"),
});

const googleLoginSchema = Joi.object({
  identityToken: Joi.string().min(100).max(8192).required(),
  nonce: Joi.string().min(16).max(128).required(),
  displayName: Joi.string().trim().max(120).allow("", null),
});

const appleLoginSchema = Joi.object({
  authorizationCode: Joi.string().min(20).max(4096).required(),
  nonce: Joi.string().min(16).max(128).required(),
  displayName: Joi.string().trim().max(120).allow("", null),
});

const sendPhoneCodeSchema = Joi.object({
  phone: Joi.string().pattern(/^\+[1-9]\d{7,14}$/).required(),
});

const checkPhoneCodeSchema = Joi.object({
  phone: Joi.string().pattern(/^\+[1-9]\d{7,14}$/).required(),
  code: Joi.string().pattern(/^\d{4,10}$/).required(),
  fullName: Joi.string().trim().min(2).max(120).allow("", null),
});

const updateProfileSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().max(254).allow("", null),
  phone: Joi.string()
    .trim()
    .custom((value, helpers) => {
      const compact = value.replace(/[\s()-]/g, "");
      if (/^(?:\+[1-9]\d{7,14}|\d{10})$/.test(compact)) return compact;
      return helpers.error("string.pattern.base");
    })
    .messages({ "string.pattern.base": "Phone must be a valid 10-digit or international number" })
    .allow("", null),
  avatarUrl: Joi.string()
    .trim()
    .uri({ scheme: ["http", "https"] })
    .max(2048)
    .allow("", null),
});

const updatePasswordSchema = Joi.object({
  currentPassword: password().allow("", null),
  newPassword: password().required(),
});

const adminGateSchema = Joi.object({
  accessKey: Joi.string().min(1).max(512).required(),
  clientKey: Joi.string().hex().length(64).required(),
});

module.exports = {
  loginSchema, refreshSchema, createUserSchema,
  googleLoginSchema, appleLoginSchema, sendPhoneCodeSchema, checkPhoneCodeSchema,
  updateProfileSchema, updatePasswordSchema,
  adminGateSchema,
};
