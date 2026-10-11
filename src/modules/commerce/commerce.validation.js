const Joi = require("joi");

const createOrderSchema = Joi.object({
  productId: Joi.string().uuid().required(),
  couponCode: Joi.string().trim().uppercase().max(60).allow("", null),
});
const identifierParams = Joi.object({ identifier: Joi.string().trim().max(180).required() });
const orderParams = Joi.object({ id: Joi.string().uuid().required() });

module.exports = { createOrderSchema, identifierParams, orderParams };
