const router = require("express").Router();
const controller = require("./auth.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const { authLimiter, phoneOtpSendLimiter, phoneOtpCheckLimiter, adminGateLimiter } = require("../../middleware/security");
const { requireAdminPortalSignature, requireAdminGateAttemptSignature, adminPortalKeysMatch } = require("../../middleware/adminPortal");
const ApiError = require("../../utils/apiError");
const { success } = require("../../utils/apiResponse");
const {
  loginSchema, refreshSchema, createUserSchema, googleLoginSchema, appleLoginSchema,
  sendPhoneCodeSchema, checkPhoneCodeSchema,
  updateProfileSchema, updatePasswordSchema,
  adminGateSchema,
} = require("./auth.validation");

router.get("/providers", controller.providers);
router.post("/admin/gate", validate(adminGateSchema), requireAdminGateAttemptSignature, adminGateLimiter, (req, res) => {
  if (!adminPortalKeysMatch(req.body.accessKey)) throw new ApiError(401, "Access denied");
  success(res, { verified: true }, "Administrator gateway verified");
});
router.post("/login", authLimiter, validate(loginSchema), controller.login);
router.post("/admin/login", authLimiter, requireAdminPortalSignature, validate(loginSchema), controller.adminLogin);
router.post("/google", authLimiter, validate(googleLoginSchema), controller.googleLogin);
router.post("/apple", authLimiter, validate(appleLoginSchema), controller.appleLogin);
router.post("/phone/send-code", authLimiter, validate(sendPhoneCodeSchema), phoneOtpSendLimiter, controller.sendPhoneCode);
router.post("/phone/verify-code", authLimiter, validate(checkPhoneCodeSchema), phoneOtpCheckLimiter, controller.checkPhoneCode);
router.post("/refresh", authLimiter, validate(refreshSchema), controller.refresh);
router.post("/logout", validate(refreshSchema), controller.logout);
router.get("/me", authenticate, controller.me);
router.patch("/me", authenticate, validate(updateProfileSchema), controller.updateMe);
router.put("/me/password", authLimiter, authenticate, validate(updatePasswordSchema), controller.updatePassword);
router.post("/logout-all", authenticate, controller.logoutAll);
router.post("/users", authenticate, authorize("TEACHER_ADMIN"), validate(createUserSchema), controller.createUser);

module.exports = router;
