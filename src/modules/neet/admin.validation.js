const Joi = require("joi");

const uuid = Joi.string().uuid();
const nullableDate = Joi.date().iso().allow(null, "");
const optionSchema = Joi.object({
  id: uuid.optional(), optionText: Joi.string().trim().min(1).max(5000).required(),
  imageUrl: Joi.string().uri({ scheme: ["https"] }).allow(null, ""),
  isCorrect: Joi.boolean().default(false), sortOrder: Joi.number().integer().min(0).required(),
});

const seriesSchema = Joi.object({
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(160).required(),
  title: Joi.string().trim().min(2).max(220).required(), shortName: Joi.string().trim().max(80).allow(null, ""),
  description: Joi.string().trim().min(10).max(10000).required(), thumbnailUrl: Joi.string().uri({ scheme: ["https"] }).allow(null, ""),
  bannerUrl: Joi.string().uri({ scheme: ["https"] }).allow(null, ""), category: Joi.string().trim().max(80).default("NEET"),
  examType: Joi.string().trim().max(80).default("NEET"), targetClass: Joi.string().trim().max(80).allow(null, ""),
  targetExam: Joi.string().trim().max(80).default("NEET"), language: Joi.string().trim().max(40).default("English"),
  tags: Joi.array().items(Joi.string().trim().max(60)).max(30).default([]),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD", "MIXED").default("MIXED"),
  authorName: Joi.string().trim().max(160).allow(null, ""), lifecycleStatus: Joi.string().valid("DRAFT", "SCHEDULED", "PUBLISHED", "CLOSED", "ARCHIVED").default("DRAFT"),
  displayOrder: Joi.number().integer().min(0).default(0), accessType: Joi.string().valid("PUBLIC", "AUTHENTICATED", "COURSE", "SELECTED_USERS", "PAID").default("AUTHENTICATED"),
  price: Joi.number().min(0).default(0), accessDurationDays: Joi.number().integer().min(1).allow(null), courseId: uuid.allow(null, ""),
  startsAt: nullableDate, endsAt: nullableDate, instructions: Joi.object().unknown(true).default({}), eligibility: Joi.object().unknown(true).default({}),
}).custom((value, helpers) => value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt) ? helpers.error("date.range") : value)
  .messages({ "date.range": "endsAt must be later than startsAt" });

const blueprintSubject = Joi.object({
  subject: Joi.string().trim().required(), count: Joi.number().integer().min(0).required(),
  difficulty: Joi.object({ EASY: Joi.number().integer().min(0).default(0), MEDIUM: Joi.number().integer().min(0).default(0), HARD: Joi.number().integer().min(0).default(0) }).default({}),
  chapters: Joi.array().items(Joi.object({ chapter: Joi.string().required(), count: Joi.number().integer().min(1).required() })).default([]),
});

const testSchema = Joi.object({
  seriesId: uuid.required(), code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).max(80).required(), name: Joi.string().trim().min(2).max(220).required(),
  examType: Joi.string().trim().uppercase().max(80).default("OTHER"), isFree: Joi.boolean().default(false),
  description: Joi.string().trim().max(10000).allow(""), instructions: Joi.object().unknown(true).default({}),
  selectionMode: Joi.string().valid("MANUAL", "BLUEPRINT").default("MANUAL"),
  blueprint: Joi.object({ totalQuestions: Joi.number().integer().min(1), subjects: Joi.array().items(blueprintSubject).default([]), seed: Joi.string().max(120) }).unknown(true).default({}),
  totalQuestions: Joi.number().integer().min(0).default(0), totalMarks: Joi.number().min(0).default(0), durationMinutes: Joi.number().integer().min(1).max(1440).required(),
  passingMarks: Joi.number().min(0).default(0), correctMarks: Joi.number().min(0).default(4), incorrectMarks: Joi.number().max(0).default(-1), unansweredMarks: Joi.number().default(0),
  maxAttempts: Joi.number().integer().min(1).allow(null), resultVisibility: Joi.string().valid("IMMEDIATE", "AFTER_SUBMISSION", "AFTER_TEST_END", "MANUAL_RELEASE").default("IMMEDIATE"),
  explanationVisibility: Joi.string().valid("IMMEDIATE", "AFTER_TEST_END", "MANUAL_RELEASE", "NEVER").default("AFTER_TEST_END"),
  answerKeyVisibility: Joi.string().valid("IMMEDIATE", "AFTER_SUBMISSION", "AFTER_TEST_END", "MANUAL_RELEASE", "NEVER").default("AFTER_TEST_END"),
  rankingEnabled: Joi.boolean().default(true), leaderboardEnabled: Joi.boolean().default(true), shuffleQuestions: Joi.boolean().default(true), shuffleOptions: Joi.boolean().default(false),
  shuffleSections: Joi.boolean().default(false), resumeEnabled: Joi.boolean().default(true), pauseEnabled: Joi.boolean().default(false), startsAt: nullableDate, endsAt: nullableDate,
  timezone: Joi.string().max(80).default("UTC"), eligibility: Joi.object().unknown(true).default({}), integritySettings: Joi.object().unknown(true).default({}),
  lifecycleStatus: Joi.string().valid("DRAFT", "SCHEDULED", "PUBLISHED", "CLOSED", "ARCHIVED").default("DRAFT"),
}).custom((value, helpers) => {
  if (value.endsAt && value.startsAt && new Date(value.endsAt) <= new Date(value.startsAt)) return helpers.message({ custom: "endsAt must be later than startsAt" });
  if (value.passingMarks > value.totalMarks && value.totalMarks > 0) return helpers.message({ custom: "passingMarks cannot exceed totalMarks" });
  return value;
});

const sectionSchema = Joi.object({ name: Joi.string().trim().min(1).max(120).required(), subject: Joi.string().trim().min(1).max(80).required(), instructions: Joi.string().max(3000).allow(null, ""), questionLimit: Joi.number().integer().min(1).allow(null), sortOrder: Joi.number().integer().min(0).required() });

const questionSchema = Joi.object({
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).max(100).required(), questionText: Joi.string().trim().min(2).max(20000).required(),
  subject: Joi.string().trim().min(2).max(80).required(), chapter: Joi.string().trim().max(160).allow(null, ""), topic: Joi.string().trim().max(160).allow(null, ""), subtopic: Joi.string().trim().max(160).allow(null, ""),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").default("MEDIUM"), questionType: Joi.string().valid("SINGLE_CORRECT", "MULTIPLE_CORRECT").default("SINGLE_CORRECT"),
  marks: Joi.number().min(0).default(4), negativeMarks: Joi.number().min(0).default(1), explanation: Joi.string().max(20000).allow(null, ""), hint: Joi.string().max(10000).allow(null, ""),
  solution: Joi.string().max(30000).allow(null, ""), sourceReference: Joi.string().max(500).allow(null, ""), tags: Joi.array().items(Joi.string().trim().max(60)).max(30).default([]),
  language: Joi.string().trim().max(40).default("English"), imageUrl: Joi.string().uri({ scheme: ["https"] }).allow(null, ""), status: Joi.string().valid("DRAFT", "ACTIVE", "ARCHIVED").default("ACTIVE"),
  options: Joi.array().items(optionSchema).min(2).max(10).required(),
}).custom((value, helpers) => {
  const correct = value.options.filter((option) => option.isCorrect).length;
  if (value.questionType === "SINGLE_CORRECT" && correct !== 1) return helpers.message({ custom: "Single-correct questions require exactly one correct option" });
  if (value.questionType === "MULTIPLE_CORRECT" && correct < 1) return helpers.message({ custom: "Multiple-correct questions require at least one correct option" });
  if (new Set(value.options.map((option) => option.sortOrder)).size !== value.options.length) return helpers.message({ custom: "Option display orders must be unique" });
  return value;
});

const idParams = Joi.object({ id: uuid.required() });
const seriesParams = Joi.object({ seriesId: uuid.required() });
const assignSchema = Joi.object({ questionIds: Joi.array().items(uuid).min(1).unique().required() });
const sectionsSchema = Joi.object({ sections: Joi.array().items(sectionSchema).min(1).required() });
const importSchema = Joi.object({ questions: Joi.array().items(questionSchema).min(1).max(500).required() });
const publishSchema = Joi.object({ action: Joi.string().valid("PUBLISH", "UNPUBLISH", "CLOSE", "ARCHIVE", "RELEASE_RESULTS").required() });
const membershipSchema = Joi.object({
  groups: Joi.array().items(Joi.object({ code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).max(80).required(), title: Joi.string().trim().min(1).max(120).required(), sortOrder: Joi.number().integer().min(0).required() })).default([]),
  tests: Joi.array().items(Joi.object({ testId: uuid.required(), groupCode: Joi.string().trim().uppercase().max(80).allow(null,""), sortOrder: Joi.number().integer().min(0).required(), isActive: Joi.boolean().default(true) })).unique("testId").required(),
});

module.exports = { seriesSchema, testSchema, questionSchema, idParams, seriesParams, assignSchema, sectionsSchema, importSchema, publishSchema, membershipSchema };
