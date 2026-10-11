const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const payment = require("./payment.service");
const orders = require("../commerce/order.service");

const createOrder = asyncHandler(async(req,res)=>success(res,await orders.create(req.user.sub,req.body),"Checkout prepared",201));
const verify = asyncHandler(async(req,res)=>success(res,await payment.verify(req.user.sub,req.body),"Payment verified and access granted"));
const cancel = asyncHandler(async(req,res)=>success(res,await payment.cancel(req.user.sub,req.body.orderId),"Order cancelled"));

module.exports = { createOrder, verify, cancel };
