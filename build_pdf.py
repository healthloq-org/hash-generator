import markdown
import pathlib

md_text = pathlib.Path("TECHNICAL_IMPLEMENTATION_GUIDE.md").read_text(encoding="utf-8")

# Convert with tables extension
html_body = markdown.markdown(md_text, extensions=["tables", "fenced_code"])

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page {{ margin: 2.2cm 2.4cm; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: #1a1a1a;
    max-width: 100%;
  }}
  h1 {{
    font-size: 22pt;
    font-weight: 700;
    color: #0d4f8c;
    margin-top: 0;
    margin-bottom: 4pt;
    border-bottom: 2px solid #0d4f8c;
    padding-bottom: 8pt;
  }}
  h2 {{
    font-size: 15pt;
    font-weight: 700;
    color: #0d4f8c;
    margin-top: 28pt;
    margin-bottom: 6pt;
    border-bottom: 1px solid #c8daf0;
    padding-bottom: 4pt;
    page-break-after: avoid;
  }}
  h3 {{
    font-size: 11.5pt;
    font-weight: 700;
    color: #1a3a5c;
    margin-top: 18pt;
    margin-bottom: 4pt;
    page-break-after: avoid;
  }}
  p {{
    margin: 0 0 8pt 0;
    orphans: 3;
    widows: 3;
  }}
  ul, ol {{
    margin: 4pt 0 8pt 0;
    padding-left: 22pt;
  }}
  li {{
    margin-bottom: 3pt;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 10pt 0 14pt 0;
    font-size: 9.5pt;
    page-break-inside: avoid;
  }}
  th {{
    background: #0d4f8c;
    color: #ffffff;
    padding: 6pt 9pt;
    text-align: left;
    font-weight: 600;
  }}
  td {{
    padding: 5pt 9pt;
    border-bottom: 1px solid #dce8f5;
    vertical-align: top;
  }}
  tr:nth-child(even) td {{
    background: #f4f8fd;
  }}
  code {{
    font-family: 'Cascadia Code', 'Consolas', monospace;
    font-size: 8.5pt;
    background: #f0f4f9;
    padding: 1pt 4pt;
    border-radius: 3px;
    color: #1a3a5c;
  }}
  pre {{
    background: #f0f4f9;
    border-left: 3px solid #0d4f8c;
    padding: 10pt 14pt;
    margin: 8pt 0 12pt 0;
    overflow-x: auto;
    page-break-inside: avoid;
  }}
  pre code {{
    background: none;
    padding: 0;
    font-size: 8pt;
    color: #1a1a1a;
  }}
  blockquote {{
    margin: 8pt 0;
    padding: 6pt 14pt;
    background: #eef4fc;
    border-left: 3px solid #0d4f8c;
    color: #1a3a5c;
    font-style: italic;
  }}
  blockquote p {{ margin: 0; }}
  hr {{
    border: none;
    border-top: 1px solid #c8daf0;
    margin: 20pt 0;
  }}
  strong {{ color: #0d2a4a; }}
  a {{ color: #0d4f8c; text-decoration: none; }}

  /* Cover block */
  .cover {{
    margin-bottom: 30pt;
  }}
  .cover h1 {{
    font-size: 26pt;
    margin-bottom: 6pt;
  }}
  .cover .subtitle {{
    font-size: 13pt;
    color: #4a6f8c;
    margin-bottom: 16pt;
  }}
  .cover .meta {{
    font-size: 9.5pt;
    color: #5a7a9a;
  }}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

out = pathlib.Path("TECHNICAL_IMPLEMENTATION_GUIDE.html")
out.write_text(html, encoding="utf-8")
print(f"HTML written to {out.resolve()}")
