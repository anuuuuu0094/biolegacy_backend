const Joi = require("joi");
const uuid = Joi.string().uuid();

const item = Joi.object({
  targetType: Joi.string().valid("COURSE","TEST_SERIES","TEST").required(),
  targetId: uuid.required(),
  sortOrder: Joi.number().integer().min(0).default(0),
});
const productSchema = Joi.object({
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160).required(),
  type: Joi.string().valid("COURSE","TEST_SERIES","TEST","BUNDLE").required(),
  title: Joi.string().trim().min(2).max(220).required(),
  description: Joi.string().trim().max(5000).allow("").default(""),
  examType: Joi.string().trim().uppercase().max(80).default("OTHER"),
  currency: Joi.string().trim().uppercase().length(3).default("INR"),
  priceMinor: Joi.number().integer().min(0).required(),
  compareAtPriceMinor: Joi.number().integer().min(0).allow(null),
  status: Joi.string().valid("DRAFT","ACTIVE","INACTIVE","ARCHIVED").default("DRAFT"),
  accessType: Joi.string().valid("LIFETIME","DURATION","FIXED_DATE").default("LIFETIME"),
  durationDays: Joi.number().integer().min(1).allow(null),
  accessStartsAt: Joi.date().iso().allow(null),
  accessEndsAt: Joi.date().iso().allow(null),
  metadata: Joi.object().unknown(true).default({}),
  items: Joi.array().items(item).min(1).required(),
}).custom((value,helpers)=>{
  if(value.compareAtPriceMinor!=null && value.compareAtPriceMinor<value.priceMinor)return helpers.message({custom:"Compare-at price cannot be below the selling price"});
  if(value.accessType==="DURATION"&&!value.durationDays)return helpers.message({custom:"Duration days are required"});
  if(value.accessType==="FIXED_DATE"&&!value.accessEndsAt)return helpers.message({custom:"Access end date is required"});
  if(value.status==="ACTIVE"&&value.accessType==="FIXED_DATE"&&new Date(value.accessEndsAt)<=new Date())return helpers.message({custom:"An active product must have a future access end date"});
  const expectedTarget={COURSE:"COURSE",TEST_SERIES:"TEST_SERIES",TEST:"TEST"}[value.type];
  if(expectedTarget&&value.items.some((entry)=>entry.targetType!==expectedTarget))return helpers.message({custom:`${value.type} products must target ${expectedTarget} items; use BUNDLE for mixed targets`});
  if(value.type!=="BUNDLE"&&value.items.length!==1)return helpers.message({custom:`${value.type} products must contain exactly one target; use BUNDLE for multiple targets`});
  return value;
});

const couponSchema = Joi.object({
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).max(60).required(),
  description: Joi.string().trim().max(1000).allow("",null),
  discountType: Joi.string().valid("PERCENT","FIXED").required(),
  discountValue: Joi.number().positive().required(),
  maxDiscountMinor: Joi.number().integer().positive().allow(null),
  minimumAmountMinor: Joi.number().integer().min(0).default(0),
  usageLimit: Joi.number().integer().positive().allow(null),
  perUserLimit: Joi.number().integer().positive().default(1),
  startsAt: Joi.date().iso().allow(null), expiresAt: Joi.date().iso().allow(null),
  status: Joi.string().valid("ACTIVE","INACTIVE","ARCHIVED").default("ACTIVE"),
  productIds: Joi.array().items(uuid).unique().default([]),
  productTypes: Joi.array().items(Joi.string().valid("COURSE","TEST_SERIES","TEST","BUNDLE")).unique().default([]),
  examTypes: Joi.array().items(Joi.string().trim().uppercase().max(80)).unique().default([]),
  allowedUserIds: Joi.array().items(uuid).unique().default([]),
});
const idParams = Joi.object({ id: uuid.required() });
const refundSchema = Joi.object({ amountMinor: Joi.number().integer().positive().allow(null), reason: Joi.string().trim().min(3).max(1000).required(), accessAction: Joi.string().valid("KEEP","REVOKE").default("KEEP") });
const reconcileSchema = Joi.object({ limit: Joi.number().integer().min(1).max(100).default(25) });

module.exports = { productSchema, couponSchema, idParams, refundSchema, reconcileSchema };
