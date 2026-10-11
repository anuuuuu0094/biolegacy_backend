const Joi = require("joi");

const blogSchema = Joi.object({
  slug: Joi.string().trim().lowercase().min(2).max(160).required(),
  title: Joi.string().trim().min(2).max(220).required(),
  summary: Joi.string().trim().min(5).max(400).required(),
  content: Joi.string().trim().min(10).required(),
  coverImage: Joi.string().trim().allow("", null),
  category: Joi.string().trim().min(2).max(80).default("Guides"),
  published: Joi.boolean().default(true),
});

module.exports = { blogSchema };
