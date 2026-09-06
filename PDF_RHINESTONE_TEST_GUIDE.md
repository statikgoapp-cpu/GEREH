# PDF Rhinestone Circle Detection - Test & Verification Guide

## Problem Statement
- **Symptom**: Single circle output (instead of 220 expected stones)
- **Root Causes Fixed**:
  1. Fallback regex path: transforms NOT applied (PDF->SVG coordinates wrong by 60px+)
  2. Cheerio path: circles filtered too aggressively (ellipses rejected, paths ignored)
  3. Morphological operations: closeIters=2 fragmenting dense patterns

## Code Changes Applied

### 1. Fallback Regex Path Enhancement (pdf-hybrid-processor.ts)
- **Before**: Regex extraction ignored `<g transform>` attributes
- **After**: New `extractTransformFromGroup()` function captures transform matrix from SVG groups
- **Impact**: If Cheerio parser fails, transforms are now applied to coordinates (60px error prevented)

### 2. Cheerio Path Loosened Filters (pdf-svg-parser.ts)
- **Before**: minCircularity 0.88+ for ellipses (too strict)
- **After**: minCircularity 0.82+ for ellipses (PDF vectorization artifacts tolerated)
- **Impact**: More ellipses & paths recognized as circles

### 3. Morphological Operations Reduced (image-worker.ts)
- **Before**: closeIters=2 for large stones
- **After**: closeIters=1 for large stones
- **Impact**: Stone fragmentation reduced

### 4. Clustering & Quality Filters Tightened (earlier commit)
- Config: minCircularity 0.62, clusterDistance 0.4mm
- filterBlobsByQuality: strictMode support
- Result: Noise reduced, dense patterns preserved

---

## Test Strategy (From User Specification)

### Level 1: Basic Validation (Quick Check)
**File**: Any PDF with known stone pattern
**Steps**:
1. Process PDF via UI or API
2. Check output report:
   - Circle count should be ≈ expected ± 5
   - NOT 1 or very low count
3. Open SVG in browser - visually verify circles placed correctly

**Expected**: Circles distributed across pattern, NOT collapsed to single point

---

### Level 2: Known-Size Calibration Test (Measurement Validation)

**Setup**: Create/use a test PDF with:
- Single large circle: 10mm diameter
- Multiple small circles: 2mm diameter each
- Pattern total: 50-100 circles in known grid

**Steps**:
1. Process with specific DPI (e.g., 300 DPI):
   ```bash
   curl -X POST http://localhost:3000/api/patterns/create \
     -F "file=@test-grid-50-stones.pdf" \
     -F "category=rhinestone" \
     -F "targetVectorDiameterMm=3.2"
   ```
2. Inspect output report:
   - Total circle count = expected
   - Diameter distribution: Most near 3.2mm (SS12)
   - No single giant circle (= merged/transformed error)

**Expected Output** (example):
```json
{
  "circles": 50,
  "avgDiameterMm": 3.2,
  "minDiameterMm": 2.8,
  "maxDiameterMm": 3.6,
  "productionReady": true
}
```

**Diagnostic Output** (check server logs):
```
[PDF Extract] Circles: found=50, extracted=50 (minCirc=0.85)
[PDF Extract] Ellipses: found=2, extracted=2 (minCirc=0.82)
[PDF Shape Extraction] TOTAL: 50 shapes (circles: 48, ellipses: 2)
[PDF Transform] Applied transforms to 50 shapes
```

---

### Level 3: Transform Correctness Test (Coordinate Validation)

**Theory**: If transform is wrong, circles appear offset or scaled incorrectly

**Manual Test**:
1. Create PDF with:
   - 4 circles at exact corners of 100mm × 100mm boundary
   - Center circle at (50, 50)
2. Process PDF
3. Check generated SVG or DXF:
   - Expected: 5 circles at (0, 0), (100, 0), (0, 100), (100, 100), (50, 50)
   - **Bad**: If corners are at (1000, 1000) or wrong scale = transform bug

**Regex Fallback Trigger** (to test new transform code):
1. Create malformed PDF/SVG that breaks Cheerio parser
2. Manually inject `<g transform="translate(10,20) scale(2,2)">` around circles
3. Process
4. Verify circles are offset by (10,20) and scaled by 2×
   - **Before Fix**: Would output original coordinates (untransformed)
   - **After Fix**: Would output transformed coordinates

---

### Level 4: DPI Consistency Tests

**Problem**: Different DPI values cause different clustering/filtering

**Test Matrix**:
```
DPI     | Recommended | Test Case
--------|-------------|-------------------
72      | No          | Web/screen (may fail)
96      | No          | Windows screen default
150     | Marginal    | Draft print
300     | YES (prod)  | Production (expected)
600     | Advanced    | High-precision
1200    | Advanced    | Ultra-high precision
```

**Steps for DPI=300, 600, 1200**:
1. Same PDF, process with each DPI
2. Expected: Stone count stable (±1-2 due to rounding)
3. Check logs:
   ```
   [PDF SVG Canvas] pxPerMm: X (Y DPI)
   [PDF Transform] Applied transforms to N shapes
   ```
4. Verify:
   - At 300 DPI: pxPerMm ≈ 11.81
   - At 600 DPI: pxPerMm ≈ 23.62
   - At 1200 DPI: pxPerMm ≈ 47.24

**Expected**: Output circle count should NOT drastically change

---

### Level 5: Dense Pattern Test (220-Stone Case)

**Scenario**: Original failing case

**Setup**:
1. Find or recreate 220-stone rhinestone design
2. Convert PDF with known properties (sizes, spacing)

**Processing**:
```bash
node -e "
const worker = require('./dist/image-worker.cjs');
const opts = {
  category: 'rhinestone',
  targetVectorDiameterMm: 3.2,
  stoneSensitivity: 50,
  threshold: 128,
  autoPrecision: true
};
// Process 220-stone test pattern
"
```

**Validation Checks**:
- ✅ Circle count: 215-225 (220 ± 5)
- ✅ No single circle (= merge bug NOT fixed)
- ✅ Diameter distribution bell curve around 3.2mm
- ✅ Log shows: no "Fallback Extraction" (good Cheerio parsing) OR fallback with transforms applied
- ✅ No warnings about "very few stones extracted"

**Debug Logs to Check**:
```
[PDF Extract] Circles: found=220, extracted=≥210
[PDF Shape Extraction] TOTAL: ≥210 shapes
[PDF Transform] Applied transforms to ≥210 shapes
```

**Red Flags**:
```
[PDF Shape Extraction] TOTAL: 1 shapes  ❌ MERGED ERROR
[PDF Vector Extraction Fallback] Extracted 1 stones  ❌ TRANSFORM IGNORED
[PDF Extract] Circles: found=220, extracted=<200  ❌ OVER-FILTERING
```

---

### Level 6: Cross-Platform Validation

**Issue**: Different PDF->SVG tools (Poppler versions) may produce different output

**Test Different Poppler Versions**:
```bash
# Check installed pdftocairo version
pdftocairo -v

# Test on Ubuntu 22.04 (e.g., via Docker)
docker run -i ubuntu:22.04 pdftocairo -v

# Test on Ubuntu 24.04
docker run -i ubuntu:24.04 pdftocairo -v
```

**Process Same PDF on Each**:
1. Compare generated SVG files
2. Check for differences:
   - Transform attributes present/absent?
   - Circle counts match?
   - Coordinate ranges similar?

**Expected**: Code handles both old & new Poppler gracefully

---

## Quick Verification Checklist

Run this after applying fixes:

- [ ] **Build Compiles**: `npm run build` → no errors
- [ ] **Simple PDF**: 
  - Create 20-circle test pattern
  - Process → expect ~20 stones (not 1)
- [ ] **Logs Show Transforms**:
  - Look for `[PDF Transform] Applied transforms to X shapes`
  - OR `[PDF Vector Extraction Fallback] Extracted X stones` (with transformed coords)
- [ ] **220-Stone Test**:
  - Process known design
  - Expect 215-225 circles (not 1, not 220 duplicates)
- [ ] **Density Safety**:
  - Process very dense pattern (1000+ stones)
  - Should not crash, handle gracefully
- [ ] **Error Messages Clear**:
  - If PDF has no circles: clear error message
  - If DPI wrong: logged but doesn't crash

---

## Debugging Commands

### View Generated Logs
```bash
# Start server with verbose logging
RHINESTONE_DEBUG=1 npm start

# Or check stored logs
tail -f server/logs/pattern-*.log
```

### Inspect SVG Output
```bash
# Extract SVG from processing temp directory
file=$(ls -t public/processed/*.svg | head -1)
open "$file"  # macOS
wslview "$file"  # WSL
```

### Test API Directly
```bash
# Check if transform extraction works
curl -X POST http://localhost:3000/api/patterns/create \
  -F "file=@test.pdf" \
  -F "category=rhinestone" \
  -F "debug=true"  # If supported
```

---

## Summary: Expected Results After Fix

| Test | Before Fix | After Fix |
|------|-----------|-----------|
| 220-stone pattern | 1 circle | 215-225 circles |
| Logs show transforms applied | ❌ No | ✅ Yes |
| Fallback regex path works | ❌ No transforms | ✅ With transforms |
| Dense patterns cluster correctly | ❌ All merge | ✅ Preserve separation |
| DPI 300/600/1200 consistency | ❌ Varies | ✅ Stable ± 2 |

---

## References

- Transform Fix: `server/pdf-hybrid-processor.ts` - new `extractTransformFromGroup()`
- Cheerio Fix: `server/pdf-svg-parser.ts` - `extractAllCircularShapes()` minCircularity adjusted
- Morphology Fix: `server/image-worker.ts` - `closeIters` reduced for PDF
- Config: `server/pdf-hybrid-config.ts` - PDF-specific thresholds
