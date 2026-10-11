const router = require("express").Router();
const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const service = require("./payment.service");

router.post("/", asyncHandler(async(req,res)=>{
  const result = await service.processWebhook(req.body,req.get("X-Razorpay-Signature"),req.get("X-Razorpay-Event-Id"));
  success(res,result,"Webhook accepted");
}));

module.exports = router;
