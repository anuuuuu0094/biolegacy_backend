const router = require("express").Router();
const controller = require("./commerce.controller");
const validate = require("../../middleware/validate");
const { authenticate, authorize, optionalAuthenticate } = require("../../middleware/auth");
const v = require("./commerce.validation");

router.get("/products", optionalAuthenticate, controller.listProducts);
router.get("/products/:identifier", optionalAuthenticate, validate(v.identifierParams,"params"), controller.getProduct);
router.post("/orders", authenticate, authorize("STUDENT"), validate(v.createOrderSchema), controller.createOrder);
router.get("/orders", authenticate, authorize("STUDENT"), controller.listOrders);
router.get("/orders/:id", authenticate, authorize("STUDENT"), validate(v.orderParams,"params"), controller.getOrder);

module.exports = router;
