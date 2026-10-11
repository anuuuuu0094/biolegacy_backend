const asyncHandler=require("../../utils/asyncHandler");
const {success}=require("../../utils/apiResponse");
const service=require("./adminCommerce.service");
const refunds=require("../payments/refund.service");
const paymentService=require("../payments/payment.service");

const products=asyncHandler(async(req,res)=>success(res,await service.listProducts(),"Products fetched"));
const createProduct=asyncHandler(async(req,res)=>success(res,await service.saveProduct(req.body,req.user.sub),"Product created",201));
const updateProduct=asyncHandler(async(req,res)=>success(res,await service.saveProduct(req.body,req.user.sub,req.params.id),"Product updated"));
const coupons=asyncHandler(async(req,res)=>success(res,await service.listCoupons(),"Coupons fetched"));
const createCoupon=asyncHandler(async(req,res)=>success(res,await service.saveCoupon(req.body,req.user.sub),"Coupon created",201));
const updateCoupon=asyncHandler(async(req,res)=>success(res,await service.saveCoupon(req.body,req.user.sub,req.params.id),"Coupon updated"));
const orders=asyncHandler(async(req,res)=>success(res,await service.listOrders(),"Orders fetched"));
const payments=asyncHandler(async(req,res)=>success(res,await service.listPayments(),"Payments fetched"));
const analytics=asyncHandler(async(req,res)=>success(res,await service.analytics(),"Commerce analytics fetched"));
const refund=asyncHandler(async(req,res)=>success(res,await refunds.createRefund(req.user.sub,req.params.id,req.body),"Refund submitted",201));
const reconcile=asyncHandler(async(req,res)=>success(res,await paymentService.reconcileFailedEvents(req.body?.limit),"Payment events reconciled"));
module.exports={products,createProduct,updateProduct,coupons,createCoupon,updateCoupon,orders,payments,analytics,refund,reconcile};
