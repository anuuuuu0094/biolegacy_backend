const router = require("express").Router();
const controller = require("./payment.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize } = require("../../middleware/auth");
const orderValidation = require("../commerce/commerce.validation");
const paymentValidation = require("./payment.validation");
const { paymentLimiter } = require("../../middleware/security");

router.use(paymentLimiter, authenticate, authorize("STUDENT"));
router.post("/create-order", validate(orderValidation.createOrderSchema), controller.createOrder);
router.post("/verify", validate(paymentValidation.verifySchema), controller.verify);
router.post("/cancel", validate(paymentValidation.cancelSchema), controller.cancel);

module.exports = router;
