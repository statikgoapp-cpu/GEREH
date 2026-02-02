import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import multer from "multer";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import express from "express";

const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  }),
});

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Ensure output directory exists
if (!fs.existsSync("public/processed")) {
  fs.mkdirSync("public/processed", { recursive: true });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Serve uploaded files and processed files
  app.use("/uploads", express.static("uploads"));
  app.use("/processed", express.static("public/processed"));

  app.get(api.patterns.list.path, async (req, res) => {
    const patterns = await storage.listPatterns();
    res.json(patterns);
  });

  app.get(api.patterns.get.path, async (req, res) => {
    const pattern = await storage.getPattern(Number(req.params.id));
    if (!pattern) {
      return res.status(404).json({ message: "Pattern not found" });
    }
    res.json(pattern);
  });

  app.post(api.patterns.create.path, upload.single("image"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    const pattern = await storage.createPattern({
      imageUrl: `/uploads/${req.file.filename}`,
    });

    // Process image in background
    processImage(pattern.id, req.file.path);

    res.status(201).json(pattern);
  });

  return httpServer;
}

async function processImage(patternId: number, inputPath: string) {
  try {
    await storage.updatePatternStatus(patternId, "processing");

    const filename = path.basename(inputPath, path.extname(inputPath));
    const outputSvgPath = path.join("public/processed", `${filename}.svg`);
    const outputDxfPath = path.join("public/processed", `${filename}.dxf`);

    // Using potrace command line tool
    // -b svg : backend svg
    // -b dxf : backend dxf
    // Potrace typically takes PNM/BMP. We might need to convert JPG/PNG to BMP first.
    // Ideally we use ImageMagick 'convert' but let's see if potrace supports it directly or if we need a pipe.
    // Potrace reads bitmaps.
    // We can use a simple BMP converter if needed, but often systems have 'convert' (imagemagick).
    // Let's assume we might need to convert.
    // For now, let's try direct potrace, if it fails we might need 'convert' (ImageMagick).
    // Safest bet: Use 'convert' to make a BMP, then potrace.
    // I will add imagemagick to system packages too.

    // Command: convert input.jpg input.bmp && potrace input.bmp -s -o output.svg
    
    // We can execute: `potrace ${inputPath} -s -o ${outputSvgPath}` if input is bmp/pnm.
    // Since input is jpg, we need to convert.
    // Let's rely on 'convert' being available if we install imagemagick.
    
    // Convert to BMP first (temporary)
    const bmpPath = path.join("uploads", `${filename}.bmp`);
    
    // Convert command
    // "magick" or "convert" depending on version. nixpkgs 'imagemagick' usually gives 'convert'.
    exec(`convert "${inputPath}" "${bmpPath}"`, (err) => {
      if (err) {
        console.error("Conversion error:", err);
        storage.updatePatternStatus(patternId, "failed");
        return;
      }

      // Potrace to SVG
      exec(`potrace "${bmpPath}" -s -o "${outputSvgPath}"`, (err2) => {
        if (err2) {
          console.error("Potrace SVG error:", err2);
          storage.updatePatternStatus(patternId, "failed");
          return;
        }

        // Potrace to DXF
        exec(`potrace "${bmpPath}" -b dxf -o "${outputDxfPath}"`, (err3) => {
          if (err3) {
             console.error("Potrace DXF error:", err3);
             // Even if DXF fails, we have SVG?
          }

          // Cleanup BMP
          fs.unlink(bmpPath, () => {});

          storage.updatePatternStatus(
            patternId, 
            "completed", 
            `/processed/${filename}.svg`, 
            `/processed/${filename}.dxf`
          );
        });
      });
    });

  } catch (error) {
    console.error("Processing error:", error);
    await storage.updatePatternStatus(patternId, "failed");
  }
}
