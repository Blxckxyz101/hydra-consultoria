import { Router, type IRouter } from "express";
import healthRouter from "./health";
import attacksRouter from "./attacks";
import methodsRouter from "./methods";
import checkRouter from "./check";
import analyzeRouter from "./analyze";
import proxiesRouter from "./proxies";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attacksRouter);
router.use(methodsRouter);
router.use(checkRouter);
router.use(analyzeRouter);
router.use(proxiesRouter);

export default router;
