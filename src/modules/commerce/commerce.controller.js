const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const products = require("./product.service");
const orders = require("./order.service");

const listProducts = asyncHandler(async (req,res)=>success(res,await products.listActive(req.query,req.user?.sub || null),"Products fetched"));
const getProduct = asyncHandler(async (req,res)=>success(res,await products.getActive(req.params.identifier,req.user?.sub || null),"Product fetched"));
const createOrder = asyncHandler(async (req,res)=>success(res,await orders.create(req.user.sub,req.body),"Checkout prepared",201));
const listOrders = asyncHandler(async (req,res)=>success(res,await orders.listForUser(req.user.sub),"Orders fetched"));
const getOrder = asyncHandler(async (req,res)=>success(res,await orders.getForUser(req.user.sub,req.params.id),"Order fetched"));

module.exports = { listProducts, getProduct, createOrder, listOrders, getOrder };
