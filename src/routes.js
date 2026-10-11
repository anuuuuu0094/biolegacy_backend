const router = require("express").Router();
const pool = require("./db/pool");
const { success } = require("./utils/apiResponse");
const authRoutes = require("./modules/auth/auth.routes");
const courseRoutes = require("./modules/courses/course.routes");
const enquiryRoutes = require("./modules/enquiries/enquiry.routes");
const blogRoutes = require("./modules/blogs/blog.routes");
const resultRoutes = require("./modules/results/result.routes");
const testSeriesRoutes = require("./modules/testSeries/testSeries.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const siteSettingsRoutes = require("./modules/siteSettings/siteSettings.routes");
const studentRoutes = require("./modules/student/student.routes");
const neetAdminRoutes = require("./modules/neet/admin.routes");
const testRoutes = require("./modules/neet/test.routes");
const attemptRoutes = require("./modules/neet/attempt.routes");
const commerceRoutes = require("./modules/commerce/commerce.routes");
const paymentRoutes = require("./modules/payments/payment.routes");
const adminCommerceRoutes = require("./modules/adminCommerce/adminCommerce.routes");

router.get("/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    success(res, { status: "ok", database: "connected" }, "API is healthy");
  } catch (error) {
    next(error);
  }
});

router.use("/auth", authRoutes);
router.use("/courses", courseRoutes);
router.use("/enquiries", enquiryRoutes);
router.use("/blogs", blogRoutes);
router.use("/results", resultRoutes);
router.use("/test-series", testSeriesRoutes);
router.use("/admin", adminRoutes);
router.use("/admin/test-management", neetAdminRoutes);
router.use("/site-settings", siteSettingsRoutes);
router.use("/student", studentRoutes);
router.use("/tests", testRoutes);
router.use("/attempts", attemptRoutes);
router.use("/commerce", commerceRoutes);
router.use("/payments", paymentRoutes);
router.use("/admin/commerce", adminCommerceRoutes);

module.exports = router;
