const Joi=require("joi");
const idParams=Joi.object({id:Joi.string().uuid().required()});
const slugParams=Joi.object({slug:Joi.string().trim().lowercase().max(160).required()});
const answerSchema=Joi.object({
  attemptQuestionId:Joi.string().uuid().required(),
  selectedOptionIds:Joi.array().items(Joi.string().uuid()).max(10).unique().default([]),
  visited:Joi.boolean().default(true), markedForReview:Joi.boolean().default(false),
  timeSpentSeconds:Joi.number().integer().min(0).max(86400).default(0),
});
const submitSchema=Joi.object({answers:Joi.array().items(answerSchema).max(500).default([])});
const eventSchema=Joi.object({type:Joi.string().valid("TAB_HIDDEN","FULLSCREEN_EXIT","RECONNECT").required(),occurredAt:Joi.date().iso().required()});
module.exports={idParams,slugParams,answerSchema,submitSchema,eventSchema};
