import { newProject, newItem } from "../model.js";
import fs from "node:fs/promises";
const p = newProject();
p.pages[0].items = [newItem("square", 100, 100)];
p.pages[0].items[0].background = "#000000";
p.styles.cut.export = false;
const r = await fetch(
  (process.env.TEST_ORIGIN || "http://127.0.0.1:5173") + "/api/pdf",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: p, indices: [0] }),
  },
);
if (!r.ok) throw Error(await r.text());
await fs.writeFile(
  "test-results/calibration.pdf",
  Buffer.from(await r.arrayBuffer()),
);
