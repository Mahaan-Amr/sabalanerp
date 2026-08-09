from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import unicodedata
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
from pypdf import PdfReader

A4_POINTS = (595.28, 841.89)
FORBIDDEN = (
    "مانده مشتری",
    "سوابق پرداخت",
    "سپیدار",
    "امضا",
    "مهر",
    "تأیید راننده",
    "تأیید گیرنده",
)


def resolve_pdf_object(value):
    return value.get_object() if hasattr(value, "get_object") else value


def has_embedded_font(reader: PdfReader) -> bool:
    for page in reader.pages:
        resources = resolve_pdf_object(page.get("/Resources", {}))
        fonts = resolve_pdf_object(resources.get("/Font", {}))
        for font_ref in fonts.values():
            font = resolve_pdf_object(font_ref)
            descriptor_ref = font.get("/FontDescriptor")
            if descriptor_ref:
                descriptor = resolve_pdf_object(descriptor_ref)
                if any(descriptor.get(key) for key in ("/FontFile", "/FontFile2", "/FontFile3")):
                    return True
            descendants = resolve_pdf_object(font.get("/DescendantFonts", []))
            for descendant_ref in descendants:
                descendant = resolve_pdf_object(descendant_ref)
                descriptor_ref = descendant.get("/FontDescriptor")
                if descriptor_ref:
                    descriptor = resolve_pdf_object(descriptor_ref)
                    if any(descriptor.get(key) for key in ("/FontFile", "/FontFile2", "/FontFile3")):
                        return True
    return False


def has_image(reader: PdfReader) -> bool:
    for page in reader.pages:
        resources = resolve_pdf_object(page.get("/Resources", {}))
        xobjects = resolve_pdf_object(resources.get("/XObject", {}))
        if any(resolve_pdf_object(item).get("/Subtype") == "/Image" for item in xobjects.values()):
            return True
    return False


def render_pages(pdf_path: Path, target_prefix: Path) -> list[Path]:
    bundled = Path(os.environ.get("USERPROFILE", "")) / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"
    command = str(bundled) if bundled.exists() else (shutil.which("pdftoppm") or shutil.which("pdftoppm.cmd"))
    if not command:
        raise AssertionError("Poppler pdftoppm is required for dispatch PDF visual QA")
    result = subprocess.run([command, "-png", "-r", "144", str(pdf_path), str(target_prefix)], capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"pdftoppm failed for {pdf_path.name}: {result.stderr}")
    return sorted(target_prefix.parent.glob(f"{target_prefix.name}-*.png"))


def assert_page_edges_clear(image_path: Path) -> None:
    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    edge = Image.new("RGB", image.size, "white")
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle((0, 0, width - 1, 5), fill=255)
    draw.rectangle((0, height - 6, width - 1, height - 1), fill=255)
    draw.rectangle((0, 0, 5, height - 1), fill=255)
    draw.rectangle((width - 6, 0, width - 1, height - 1), fill=255)
    diff = ImageChops.difference(image, edge)
    assert diff.getbbox() is None or ImageChops.multiply(diff, Image.merge("RGB", (mask, mask, mask))).getbbox() is None, f"content reaches page edge: {image_path.name}"


def compare_or_update(image_path: Path, baseline_path: Path, update: bool) -> None:
    if update:
        shutil.copyfile(image_path, baseline_path)
        return
    assert baseline_path.exists(), f"missing visual baseline: {baseline_path.name}; run with --update-baselines after review"
    actual = Image.open(image_path).convert("RGB")
    expected = Image.open(baseline_path).convert("RGB")
    assert actual.size == expected.size, f"baseline dimensions changed: {baseline_path.name}"
    diff = ImageChops.difference(actual, expected)
    histogram = diff.convert("L").histogram()
    changed = sum(histogram[1:])
    ratio = changed / (actual.width * actual.height)
    assert ratio <= 0.005, f"visual regression {baseline_path.name}: {ratio:.3%} pixels changed"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--baseline-dir", required=True, type=Path)
    parser.add_argument("--update-baselines", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    rendered_images: list[Path] = []
    for document in manifest["documents"]:
        pdf_path = Path(document["pdfPath"])
        reader = PdfReader(pdf_path)
        assert len(reader.pages) == document["expectedPages"], f"{document['name']}: expected {document['expectedPages']} pages, got {len(reader.pages)}"
        for page in reader.pages:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            assert abs(width - A4_POINTS[0]) < 1.0 and abs(height - A4_POINTS[1]) < 1.0, f"{document['name']}: page is not A4"
        assert has_embedded_font(reader), f"{document['name']}: no embedded font found"
        assert has_image(reader), f"{document['name']}: official logo image is missing"
        page_text = [unicodedata.normalize("NFKC", (page.extract_text() or "").replace("\x00", "")) for page in reader.pages]
        combined_text = "\n".join(page_text)
        assert "سبلان" in combined_text, f"{document['name']}: Persian RTL text is not extractable"
        assert not any(term in combined_text for term in FORBIDDEN), f"{document['name']}: forbidden content found"
        if document["kind"] in ("WAYBILL", "STATEMENT"):
            assert all("شرح محصول" in text for text in page_text), f"{document['name']}: table heading does not repeat"
        if document["kind"] == "STATEMENT":
            assert "جمع کل محموله" in page_text[-1], f"{document['name']}: total missing on final page"
            assert all("جمع کل محموله" not in text for text in page_text[:-1]), f"{document['name']}: total appears before final page"
        page_images = render_pages(pdf_path, pdf_path.with_suffix(""))
        assert len(page_images) == len(reader.pages)
        for index, image_path in enumerate(page_images, start=1):
            assert_page_edges_clear(image_path)
            baseline_path = args.baseline_dir / f"{document['name']}-page-{index}.png"
            compare_or_update(image_path, baseline_path, args.update_baselines)
            rendered_images.append(image_path)

    print_both_dir = args.manifest.parent / "print-both-ordered"
    assert sorted(item.name for item in print_both_dir.glob("*.pdf")) == manifest["printBoth"], "print-both must hand off waybill then statement as separate PDFs"

    thumbnails = []
    for image_path in rendered_images:
        image = Image.open(image_path).convert("RGB")
        image.thumbnail((360, 510))
        thumbnails.append((image_path.stem, image.copy()))
    columns = 4
    cell_width, cell_height = 390, 560
    rows = (len(thumbnails) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "#eef2f1")
    draw = ImageDraw.Draw(sheet)
    for index, (label, image) in enumerate(thumbnails):
        x = (index % columns) * cell_width + 15
        y = (index // columns) * cell_height + 30
        sheet.paste(image, (x, y))
        draw.text((x, 8 + (index // columns) * cell_height), label, fill="#17212b")
    sheet.save(args.manifest.parent / "contact-sheet.png")
    print(f"Verified {len(manifest['documents'])} dispatch PDFs and {len(rendered_images)} rendered pages.")


if __name__ == "__main__":
    main()
