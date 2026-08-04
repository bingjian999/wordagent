---
name: docx-tools
description: >
  Word document operations for Word AI.
  Use when you need to parse text from a .docx file or generate a .docx report
  with headings, paragraphs, and tables.
license: MIT
---

# Word Document Tools

## Usage

- Use `docx_operate` with `operation: "parse"` to extract text from a .docx file
- Use `docx_operate` with `operation: "generate"` to create a .docx from structured content

## Parse Example

```json
{
  "operation": "parse",
  "filePath": "report.docx"
}
```

Returns extracted text, HTML, and character count.

## Generate Example

```json
{
  "operation": "generate",
  "filePath": "output.docx",
  "title": "Q1 Financial Report",
  "paragraphs": [
    { "text": "Revenue Summary", "heading": "Heading1" },
    { "text": "Total revenue: ¥1,234,567" },
    { "text": "Growth: 15.3%", "bold": true }
  ],
  "tables": [
    {
      "rows": [
        ["Quarter", "Revenue", "Cost"],
        ["Q1", "1,234,567", "987,654"],
        ["Q2", "1,500,000", "1,100,000"]
      ],
      "headerRow": true
    }
  ]
}
```

## Supported Features

### Paragraph Options
- `heading`: Title, Heading1, Heading2, Heading3, normal
- `bold`, `italic`: text formatting
- `alignment`: left, center, right, justify
- `bullet`: bullet list item
- `fontSize`: font size in points (default 11)

### Table Options
- `rows`: array of string arrays (each row is an array of cell texts)
- `headerRow`: first row is bold and shaded (default false)
- `columnWidths`: column widths in percentages (must sum to 100)

### Document Metadata
- `title`: document title at the top
- `creator`: creator name in document properties
- `description`: document description in properties
