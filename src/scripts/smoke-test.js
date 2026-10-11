require("../app");

const modules = [
  "../modules/auth/auth.routes",
  "../modules/courses/course.routes",
  "../modules/enquiries/enquiry.routes",
  "../modules/blogs/blog.routes",
  "../modules/results/result.routes",
  "../modules/testSeries/testSeries.routes",
  "../modules/admin/admin.routes",
  "../modules/siteSettings/siteSettings.routes",
  "../modules/student/student.routes",
  "../modules/neet/admin.routes",
  "../modules/neet/test.routes",
  "../modules/neet/attempt.routes",
  "../modules/neet/engines/scoringEngine",
  "../modules/neet/engines/blueprintEngine",
];

for (const modulePath of modules) {
  require(modulePath);
}

console.log("Backend smoke test passed");
