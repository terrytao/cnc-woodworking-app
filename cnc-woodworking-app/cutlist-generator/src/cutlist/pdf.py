"""HTML -> PDF via WeasyPrint."""

from __future__ import annotations

from pathlib import Path


def html_to_pdf(html_path: str | Path, pdf_path: str | Path) -> None:
    """Render an HTML file to PDF using WeasyPrint.

    The HTML is read from disk (not from a string) so that relative
    references (e.g. inline CSS embedded via <style>) and base URL
    resolution behave predictably.
    """
    # Imported lazily so the module loads quickly when only the
    # HTML render path is exercised in tests.
    from weasyprint import HTML

    h = Path(html_path)
    p = Path(pdf_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    HTML(filename=str(h)).write_pdf(str(p))
