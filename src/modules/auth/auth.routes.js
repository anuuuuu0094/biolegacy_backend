const router = require("express").Router();
const controller = require("./auth.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const { authLimiter, phoneOtpSendLimiter, phoneOtpCheckLimiter } = require("../../middleware/security");
const {
  loginSchema, refreshSchema, createUserSchema, googleLoginSchema, appleLoginSchema,
  sendPhoneCodeSchema, checkPhoneCodeSchema,
  updateProfileSchema, updatePasswordSchema,
} = require("./auth.validation");

router.get("/providers", controller.providers);
router.post("/login", authLimiter, validate(loginSchema), controller.login);
router.post("/google", authLimiter, validate(googleLoginSchema), controller.googleLogin);
router.post("/apple", authLimiter, validate(appleLoginSchema), controller.appleLogin);
router.post("/phone/send-code", authLimiter, phoneOtpSendLimiter, validate(sendPhoneCodeSchema), controller.sendPhoneCode);
router.post("/phone/verify-code", authLimiter, phoneOtpCheckLimiter, validate(checkPhoneCodeSchema), controller.checkPhoneCode);
router.post("/refresh", validate(refreshSchema), controller.refresh);
router.post("/logout", validate(refreshSchema), controller.logout);
router.get("/me", authenticate, controller.me);
router.patch("/me", authenticate, validate(updateProfileSchema), controller.updateMe);
router.put("/me/password", authLimiter, authenticate, validate(updatePasswordSchema), controller.updatePassword);
router.post("/logout-all", authenticate, controller.logoutAll);
router.post("/users", authenticate, authorize("TEACHER_ADMIN"), validate(createUserSchema), controller.createUser);

module.exports = router;
