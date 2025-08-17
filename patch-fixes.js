// fix-express-types.js
import fs from "fs";
import path from "path";

const SRC_DIR = "./src";

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.resolve(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith(".ts")) {
      results.push(file);
    }
  });
  return results;
}

function patchFile(file) {
  let text = fs.readFileSync(file, "utf8");
  let orig = text;

  // Ensure express import includes types
  if (text.includes(`from "express"`) && !text.includes("Request")) {
    text = text.replace(
      /from "express";/,
      `from "express";\nimport type { Request, Response } from "express";`
    );
  }

  // Fix (req, res) =>   to (req: Request, res: Response) =>
  text = text.replace(
    /\(\s*req\s*,\s*res\s*\)\s*=>/g,
    "(req: Request, res: Response) =>"
  );

  if (text !== orig) {
    fs.writeFileSync(file, text, "utf8");
    console.log(`✔ Patched ${file}`);
  }
}

walk(SRC_DIR).forEach(patchFile);

console.log("✅ All express type fixes applied.");

