import argparse
import json
import os
import sys

import fitz

# Keep edge smoothing on to avoid stair-stepping in vectorized PDF contours.
fitz.TOOLS.set_aa_level(8)


def render_page_sharp(page: fitz.Page, dpi: int) -> bytes:
    scale = dpi / 72.0
    matrix = fitz.Matrix(scale, scale)
    pixmap = page.get_pixmap(
        matrix=matrix,
        alpha=False,
        annots=True,
        colorspace=fitz.csRGB,
    )
    pixmap.set_dpi(dpi, dpi)
    return pixmap.tobytes(output="png")


def convert_pdf_to_png(pdf_path: str, png_out: str, dpi: int, page_index: int) -> dict:
    doc = fitz.open(pdf_path)
    try:
        total_pages = len(doc)
        if total_pages == 0:
            raise ValueError("PDF contains no pages.")
        if page_index < 0 or page_index >= total_pages:
            raise ValueError(
                f"Page {page_index} out of range. PDF has {total_pages} page(s)."
            )

        page = doc.load_page(page_index)
        png_bytes = render_page_sharp(page, dpi)

        os.makedirs(os.path.dirname(png_out) or ".", exist_ok=True)
        with open(png_out, "wb") as handle:
            handle.write(png_bytes)

        return {
            "png": png_out,
            "dpi": dpi,
            "page_index": page_index,
            "total_pages": total_pages,
            "anti_aliasing": "on",
        }
    finally:
        doc.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--png", required=True)
    parser.add_argument("--dpi", type=int, default=600)
    parser.add_argument("--page", type=int, default=0)
    args = parser.parse_args()

    dpi = max(72, min(1152, int(args.dpi)))
    page_index = max(0, int(args.page))

    try:
        result = convert_pdf_to_png(args.pdf, args.png, dpi, page_index)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"PDF processing failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
