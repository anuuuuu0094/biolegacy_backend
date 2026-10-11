const Joi = require("joi");

const enquirySchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().pattern(/^[0-9]{10}$/).required(),
  email: Joi.string().trim().email().allow("", null),
  course: Joi.string().trim().min(2).max(160).required(),
  targetExamYear: Joi.number().integer().min(2024).max(2040).allow(null),
  city: Joi.string().trim().max(120).allow("", null),
  message: Joi.string().trim().max(1000).allow("", null),
});

const updateEnquirySchema = Joi.object({
  leadStatus: Joi.string().valid("NEW", "CONTACTED", "COUNSELED", "ENROLLED", "CLOSED").required(),
  notes: Joi.string().trim().max(2000).allow("", null),
});

module.exports = { enquirySchema, updateEnquirySchema };
