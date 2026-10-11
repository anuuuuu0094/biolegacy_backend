const router=require("express").Router();
const controller=require("./student.controller");
const validate=require("../../middleware/validate");
const {authenticate,optionalAuthenticate,authorize}=require("../../middleware/auth");
const {idParams}=require("./student.validation");
router.get("/:id",optionalAuthenticate,validate(idParams,"params"),controller.testDetail);
router.get("/:id/leaderboard",validate(idParams,"params"),controller.leaderboard);
router.post("/:id/start",authenticate,authorize("STUDENT"),validate(idParams,"params"),controller.start);
module.exports=router;
