const Joi = require("joi");

const verifySchema = Joi.object({
  razorpayOrderId: Joi.string().trim().max(120).required(),
  razorpayPaymentId: Joi.string().trim().max(120).required(),
  razorpaySignature: Joi.string().trim().hex().length(64).required(),
});
const cancelSchema = Joi.object({ orderId: Joi.string().uuid().required() });

module.exports = { verifySchema, cancelSchema };
