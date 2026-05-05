"""CLI entrypoint: cutlist <input.json> <out_dir>."""

from __future__ import annotations

import sys
from pathlib import Path

from .load import load_cutlist
from .pdf import html_to_pdf
from .render import render_html


def _project_title_from_path(p: Path) -> str:
    stem = p.stem
    # "coffee_table_cutlist" -> "Coffee Table"
    cleaned = stem.replace("_cutlist", "").replace("-cutlist", "")
    cleaned = cleaned.replace("_", " ").replace("-", " ").strip()
    return cleaned.title() if cleaned else "Cut List"


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 2:
        print(
            "usage: python -m cutlist <input.json> <out_dir>",
            file=sys.stderr,
        )
        return 2

    input_path = Path(args[0])
    out_dir = Path(args[1])
    out_dir.mkdir(parents=True, exist_ok=True)

    cutlist = load_cutlist(input_path)
    html = render_html(
        cutlist,
        project_title=_project_title_from_path(input_path),
    )

    html_path = out_dir / "cutlist.html"
    pdf_path = out_dir / "cutlist.pdf"

    html_path.write_text(html, encoding="utf-8")
    html_to_pdf(html_path, pdf_path)

    print(f"wrote {html_path}  ({html_path.stat().st_size:,} bytes)")
    print(f"wrote {pdf_path}   ({pdf_path.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
