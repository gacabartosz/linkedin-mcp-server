import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';

const SLIDE_SIZE = 1080; // LinkedIn carousel standard

async function main() {
  const pdf = await PDFDocument.create();
  
  // Order: Gmail Before → Gmail After → Drive Before → Drive After
  const slides = [
    { path: '/Users/gaca/output/personal/linkedin-mcp/ggmail_dirty.png', label: 'Gmail BEFORE' },
    { path: '/Users/gaca/output/personal/linkedin-mcp/ggmail_nice.png', label: 'Gmail AFTER' },
    { path: '/Users/gaca/output/personal/linkedin-mcp/gdysk_dirty.png', label: 'Drive BEFORE' },
    { path: '/Users/gaca/output/personal/linkedin-mcp/gdysk_nice.png', label: 'Drive AFTER' },
  ];

  for (const slide of slides) {
    const imgBytes = readFileSync(slide.path);
    const img = await pdf.embedPng(imgBytes);
    
    const page = pdf.addPage([SLIDE_SIZE, SLIDE_SIZE]);
    
    // Scale image to fill page while maintaining aspect ratio
    const imgAspect = img.width / img.height;
    let drawW, drawH, drawX, drawY;
    
    if (imgAspect > 1) {
      // Wider than tall — fit to width, center vertically
      drawW = SLIDE_SIZE;
      drawH = SLIDE_SIZE / imgAspect;
      drawX = 0;
      drawY = (SLIDE_SIZE - drawH) / 2;
    } else {
      // Taller than wide — fit to height, center horizontally
      drawH = SLIDE_SIZE;
      drawW = SLIDE_SIZE * imgAspect;
      drawX = (SLIDE_SIZE - drawW) / 2;
      drawY = 0;
    }
    
    page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
  }

  const pdfBytes = await pdf.save();
  const outPath = '/Users/gaca/output/personal/linkedin-mcp/post18-carousel.pdf';
  writeFileSync(outPath, pdfBytes);
  console.log(`Carousel saved: ${outPath} (${(pdfBytes.length / 1024 / 1024).toFixed(1)} MB, ${slides.length} slides)`);
}

main().catch(console.error);
