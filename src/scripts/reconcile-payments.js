const migrate = require("../db/migrate");
const pool = require("../db/pool");
const payments = require("../modules/payments/payment.service");

async function run() {
  await migrate();
  const result = await payments.reconcileFailedEvents(process.argv[2]);
  console.log(JSON.stringify(result));
}

run()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
