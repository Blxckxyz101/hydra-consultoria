import { Router, type IRouter } from "express";
import healthRouter from "./health";
import attacksRouter from "./attacks";
import methodsRouter from "./methods";
import checkRouter from "./check";
import analyzeRouter from "./analyze";
import proxiesRouter from "./proxies";
import originFinderRouter from "./origin-finder";
import clusterRouter from "./cluster";
import eventsRouter from "./events";
import imageRouter from "./image";
import trackerRouter from "./tracker";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(attacksRouter);
router.use(methodsRouter);
router.use(checkRouter);
router.use(analyzeRouter);
router.use(proxiesRouter);
router.use(originFinderRouter);
router.use(clusterRouter);
router.use(imageRouter);
router.use(trackerRouter);

export default router;
