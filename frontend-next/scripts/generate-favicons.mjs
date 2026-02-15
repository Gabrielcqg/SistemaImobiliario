import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const appDir = path.join(projectRoot, "src", "app");

const svgPath = path.join(appDir, "icon.svg");
const iconPngPath = path.join(appDir, "icon.png");
const appleIconPath = path.join(appDir, "apple-icon.png");
const faviconIcoPath = path.join(appDir, "favicon.ico");

const generateFavicons = async () => {
  await fs.access(svgPath);
  const svgBuffer = await fs.readFile(svgPath);

  await sharp(svgBuffer, { density: 512 })
    .resize(32, 32, { fit: "contain" })
    .png()
    .toFile(iconPngPath);

  await sharp(svgBuffer, { density: 512 })
    .resize(180, 180, { fit: "contain" })
    .png()
    .toFile(appleIconPath);

  const icoBuffer = await pngToIco(iconPngPath);
  await fs.writeFile(faviconIcoPath, icoBuffer);

  console.log("Favicons generated:");
  console.log(`- ${path.relative(projectRoot, faviconIcoPath)}`);
  console.log(`- ${path.relative(projectRoot, iconPngPath)}`);
  console.log(`- ${path.relative(projectRoot, appleIconPath)}`);
};

generateFavicons().catch((error) => {
  console.error("Failed to generate favicons.");
  console.error(error);
  process.exit(1);
});
