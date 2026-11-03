import express from "express";
import hrHiringSmsGateway from "../services/hrHiringSmsGateway";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ success: true, data: hrHiringSmsGateway.snapshot() });
});

router.put("/", (req, res) => {
  const mode = req.body?.mode;
  if (mode !== "success" && mode !== "failure") {
    return res.status(400).json({
      success: false,
      error: "حالت درگاه آزمایشی باید موفق یا ناموفق باشد.",
    });
  }
  const data = hrHiringSmsGateway.configureTestAdapter(
    mode,
    req.body?.reset === true,
  );
  return res.json({ success: true, data });
});

export default router;
