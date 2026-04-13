import { Router, type IRouter } from "express";
import { ATTACK_METHODS } from "../lib/methods";

const router: IRouter = Router();

router.get("/methods", (_req, res): void => {
  res.json(ATTACK_METHODS);
});

export default router;
